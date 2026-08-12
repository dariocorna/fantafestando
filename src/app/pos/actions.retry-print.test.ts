import { beforeEach, describe, expect, test, vi } from "vitest";

const { dbConnectMock, printJobFindMock, printJobUpdateManyMock, orderFindOneMock, productFindOneAndUpdateMock, eventExistsMock, retryPrintJobByIdMock, holdFailedKitchenPrintJobsMock, recoverStaleManualPrintRetryClaimsMock, ensureAuthenticatedSessionMock } = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobFindMock: vi.fn(),
    printJobUpdateManyMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    productFindOneAndUpdateMock: vi.fn(),
    eventExistsMock: vi.fn(),
    retryPrintJobByIdMock: vi.fn(),
    holdFailedKitchenPrintJobsMock: vi.fn(),
    recoverStaleManualPrintRetryClaimsMock: vi.fn(),
    ensureAuthenticatedSessionMock: vi.fn()
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/lib/pos-access", () => ({
    ensurePosAccess: ensureAuthenticatedSessionMock
}));

vi.mock("@/models/PrintJob", () => ({
    default: {
        find: printJobFindMock,
        updateMany: printJobUpdateManyMock
    }
}));

vi.mock("@/lib/printer", () => ({
    PrinterService: {
        retryPrintJobById: retryPrintJobByIdMock
    }
}));

vi.mock("@/lib/print-queue", () => ({
    holdFailedKitchenPrintJobs: holdFailedKitchenPrintJobsMock,
    recoverStaleManualPrintRetryClaims: recoverStaleManualPrintRetryClaimsMock
}));

vi.mock("@/models/Order", () => ({ default: { findOne: orderFindOneMock } }));
vi.mock("@/models/PosDevice", () => ({ default: {} }));
vi.mock("@/models/Product", () => ({ default: { findOneAndUpdate: productFindOneAndUpdateMock } }));
vi.mock("@/models/Event", () => ({ default: { exists: eventExistsMock } }));
vi.mock("@/models/CashSession", () => ({ default: {} }));

import { holdFailedOrderPrintJobs, retryFailedOrderPrintJobs, updatePosStock } from "@/app/pos/actions";

function mockFindFailedJobs(rows: Array<{ _id: string }>) {
    printJobFindMock
        .mockReturnValueOnce({ sort: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(rows) }) }) })
        .mockReturnValue({ sort: vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) }) });
}

describe("retryFailedOrderPrintJobs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAuthenticatedSessionMock.mockResolvedValue({
            ok: true,
            user: { id: "user-1", username: "cashier", role: "CASHIER" }
        });
        orderFindOneMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ eventId: { toString: () => "evt-1" } }) }) });
        printJobUpdateManyMock.mockResolvedValue({ modifiedCount: 0 });
        recoverStaleManualPrintRetryClaimsMock.mockResolvedValue({ recovered: 0 });
    });

    test("returns error when event/order ids are missing", async () => {
        const result = await retryFailedOrderPrintJobs({ orderId: "", jobIds: [] });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toMatch(/Dati mancanti/i);
        }
    });

    test("returns success with zero attempts when there are no failed jobs", async () => {
        mockFindFailedJobs([]);

        const result = await retryFailedOrderPrintJobs({ orderId: "ord-1", jobIds: ["job-1"] });
        expect(dbConnectMock).toHaveBeenCalledTimes(1);
        expect(printJobFindMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            orderId: "ord-1",
            source: "ORDER",
            status: "FAILED",
            _id: { $in: ["job-1"] }
        });
        expect(result).toEqual({
            success: true,
            attempted: 0,
            retried: 0,
            failed: 0,
            failedPrinters: []
        });
        expect(recoverStaleManualPrintRetryClaimsMock).toHaveBeenCalledWith("evt-1", "ord-1");
    });

    test("counts partial retry results", async () => {
        mockFindFailedJobs([{ _id: "job-1" }, { _id: "job-2" }, { _id: "job-3" }]);
        retryPrintJobByIdMock
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: "boom" })
            .mockResolvedValueOnce({ success: true });

        const result = await retryFailedOrderPrintJobs({ orderId: "ord-1", jobIds: ["job-1", "job-2", "job-3"] });
        expect(retryPrintJobByIdMock).toHaveBeenCalledTimes(2);
        expect(retryPrintJobByIdMock).toHaveBeenNthCalledWith(1, "evt-1", "job-1");
        expect(retryPrintJobByIdMock).toHaveBeenNthCalledWith(2, "evt-1", "job-2");
        expect(result).toEqual({
            success: true,
            attempted: 2,
            retried: 1,
            failed: 1,
            failedPrinters: []
        });
    });

    test("offers hold only for queue-recoverable groups backed by a KITCHEN printer", async () => {
        const kitchenPopulateMock = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: "job-kitchen",
                        printerId: { _id: "printer-kitchen", name: "Cucina", type: "KITCHEN" },
                        destinationHost: "10.0.0.10",
                        destinationPort: 9100,
                        queueRecoverable: true
                    },
                    {
                        _id: "job-kitchen-legacy",
                        printerId: { _id: "printer-kitchen-legacy", name: "Cucina legacy", type: "KITCHEN" },
                        destinationHost: "10.0.0.12",
                        destinationPort: 9100,
                        queueRecoverable: false
                    },
                    {
                        _id: "job-cashier",
                        printerId: { _id: "printer-cashier", name: "Cassa", type: "CASHIER" },
                        destinationHost: "10.0.0.11",
                        destinationPort: 9100,
                        queueRecoverable: false
                    }
                ])
            })
        });
        printJobFindMock
            .mockReturnValueOnce({
                sort: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) })
                })
            })
            .mockReturnValueOnce({
                sort: vi.fn().mockReturnValue({ populate: kitchenPopulateMock })
            });

        const result = await retryFailedOrderPrintJobs({ orderId: "ord-1", jobIds: ["missing"] });

        expect(result).toMatchObject({
            success: true,
            failedPrinters: [
                expect.objectContaining({ key: "printer-kitchen", printerType: "KITCHEN", canHold: true }),
                expect.objectContaining({ key: "printer-kitchen-legacy", printerType: "KITCHEN", canHold: false }),
                expect.objectContaining({ key: "printer-cashier", printerType: "CASHIER", canHold: false })
            ]
        });
        expect(kitchenPopulateMock).toHaveBeenCalledWith("printerId", "name ip port type");
    });

    test("returns error when lookup throws", async () => {
        printJobFindMock.mockImplementation(() => {
            throw new Error("db unavailable");
        });

        const result = await retryFailedOrderPrintJobs({ orderId: "ord-1", jobIds: ["job-1"] });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toMatch(/Errore durante il reinvio/i);
        }
    });
});

describe("holdFailedOrderPrintJobs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAuthenticatedSessionMock.mockResolvedValue({
            ok: true,
            user: { id: "user-1", username: "cashier", role: "CASHIER" }
        });
        orderFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ eventId: { toString: () => "evt-1" } })
            })
        });
        holdFailedKitchenPrintJobsMock.mockResolvedValue({ held: 2, busyPrinterIds: [] });
        recoverStaleManualPrintRetryClaimsMock.mockResolvedValue({ recovered: 0 });
        eventExistsMock.mockResolvedValue({ _id: "evt-1" });
        printJobUpdateManyMock.mockResolvedValue({ modifiedCount: 0 });
        printJobFindMock.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) })
                })
            })
        });
    });

    test("requires an authenticated POS session before holding jobs", async () => {
        ensureAuthenticatedSessionMock.mockResolvedValue({ ok: false, status: 401, error: "Autenticazione richiesta" });

        await expect(holdFailedOrderPrintJobs({ orderId: "ord-1", jobIds: ["job-1"] })).resolves.toEqual({
            success: false,
            error: "Autenticazione richiesta"
        });
        expect(orderFindOneMock).not.toHaveBeenCalled();
        expect(holdFailedKitchenPrintJobsMock).not.toHaveBeenCalled();
    });

    test("scopes the request to its paid order and delegates the KITCHEN check to the core", async () => {
        await expect(holdFailedOrderPrintJobs({ orderId: "ord-1", jobIds: ["job-1", "job-2"] })).resolves.toEqual({
            success: true,
            held: 2,
            failedPrinters: []
        });
        expect(orderFindOneMock).toHaveBeenCalledWith({ _id: "ord-1", status: "PAID" });
        expect(holdFailedKitchenPrintJobsMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            orderId: "ord-1",
            jobIds: ["job-1", "job-2"]
        });
        expect(eventExistsMock).toHaveBeenCalledWith({ _id: "evt-1", active: true, archived: { $ne: true } });
    });

    test("does not claim cashier jobs when the core rejects the requested ids", async () => {
        holdFailedKitchenPrintJobsMock.mockResolvedValue({ held: 0, busyPrinterIds: [] });

        await expect(holdFailedOrderPrintJobs({ orderId: "ord-1", jobIds: ["cashier-job"] })).resolves.toMatchObject({
            success: true,
            held: 0
        });
    });

    test("returns an explicit error when the target kitchen printer is busy", async () => {
        holdFailedKitchenPrintJobsMock.mockResolvedValue({ held: 0, busyPrinterIds: ["printer-kitchen"] });

        await expect(holdFailedOrderPrintJobs({ orderId: "ord-1", jobIds: ["job-1"] })).resolves.toEqual({
            success: false,
            error: "La stampante sta già inviando una comanda. Riprova tra poco."
        });
    });

    test("rejects paid orders outside the active event", async () => {
        eventExistsMock.mockResolvedValue(null);

        await expect(holdFailedOrderPrintJobs({ orderId: "ord-old", jobIds: ["job-1"] })).resolves.toEqual({
            success: false,
            error: "Ordine non appartenente alla festa attiva"
        });
        expect(holdFailedKitchenPrintJobsMock).not.toHaveBeenCalled();
    });
});

describe("updatePosStock", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAuthenticatedSessionMock.mockResolvedValue({ ok: true, user: { id: "pos-1", role: "CASHIER" } });
        eventExistsMock.mockResolvedValue({ _id: "evt-1" });
    });

    test("rejects invalid quantities before writing", async () => {
        const result = await updatePosStock({ eventId: "evt-1", productId: "p1", stockQuantity: -1 });
        expect(result).toMatchObject({ success: false, error: "Quantità scorte non valida" });
        expect(productFindOneAndUpdateMock).not.toHaveBeenCalled();
    });

    test("updates a variant through POS access and returns the refreshed stock", async () => {
        productFindOneAndUpdateMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({
            _id: { toString: () => "p1" }, stockQuantity: 8, isSoldOut: false,
            variants: [{ optionName: "Grande", priceVariation: 1, stockQuantity: 3 }]
        }) }) });
        const result = await updatePosStock({ eventId: "evt-1", productId: "p1", variantName: "Grande", stockQuantity: 3 });
        expect(productFindOneAndUpdateMock).toHaveBeenCalledWith(
            { _id: "p1", eventId: "evt-1", "variants.optionName": "Grande" },
            { $set: { "variants.$.stockQuantity": 3 } },
            { returnDocument: "after" }
        );
        expect(result).toMatchObject({ success: true, product: { id: "p1", variants: [{ optionName: "Grande", stockQuantity: 3 }] } });
    });
});
