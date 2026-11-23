import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Binary } from "bson";
import mongoose from "mongoose";
import { getThermalContentWidth } from "@/lib/easter-egg-config";

const {
    dbConnectMock,
    printJobFindOneAndUpdateMock,
    printJobFindOneMock,
    printJobUpdateOneMock,
    printJobExistsMock,
    orderFindOneMock,
    buildPrintQueueLeaseMock,
    claimKitchenPrinterQueueLeaseMock,
    releaseKitchenPrinterQueueLeaseMock,
    completeSumUpPrintIntentsForSentJobMock,
    claimSumUpEventOperationMock,
    releaseSumUpEventOperationMock,
    ensureEventOperationOwnedMock,
    stopEventOperationHeartbeatMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobFindOneAndUpdateMock: vi.fn(),
    printJobFindOneMock: vi.fn(),
    printJobUpdateOneMock: vi.fn(),
    printJobExistsMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    buildPrintQueueLeaseMock: vi.fn(),
    claimKitchenPrinterQueueLeaseMock: vi.fn(),
    releaseKitchenPrinterQueueLeaseMock: vi.fn(),
    completeSumUpPrintIntentsForSentJobMock: vi.fn(),
    claimSumUpEventOperationMock: vi.fn(),
    releaseSumUpEventOperationMock: vi.fn(),
    ensureEventOperationOwnedMock: vi.fn(),
    stopEventOperationHeartbeatMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/PrintJob", () => ({
    default: {
        findOneAndUpdate: printJobFindOneAndUpdateMock,
        findOne: printJobFindOneMock,
        updateOne: printJobUpdateOneMock,
        exists: printJobExistsMock
    }
}));

vi.mock("@/lib/print-queue", () => ({
    buildPrintQueueLease: buildPrintQueueLeaseMock,
    claimKitchenPrinterQueueLease: claimKitchenPrinterQueueLeaseMock,
    refreshKitchenPrinterQueueLease: vi.fn(),
    releaseKitchenPrinterQueueLease: releaseKitchenPrinterQueueLeaseMock
}));
vi.mock("@/lib/sumup-print-routing", () => ({
    completeSumUpPrintIntentsForSentJob: completeSumUpPrintIntentsForSentJobMock,
    completeSumUpPrintIntentsIfSent: vi.fn()
}));
vi.mock("@/lib/sumup-event-operation", () => ({
    claimSumUpEventOperation: claimSumUpEventOperationMock,
    releaseSumUpEventOperation: releaseSumUpEventOperationMock,
    startSumUpEventOperationHeartbeat: () => ({
        ensureOwned: ensureEventOperationOwnedMock,
        stop: stopEventOperationHeartbeatMock
    })
}));

vi.mock("@/models/Order", () => ({
    default: {
        findOne: orderFindOneMock
    }
}));
vi.mock("@/models/Product", () => ({ default: {} }));
vi.mock("@/models/Category", () => ({ default: {} }));
vi.mock("@/models/PosDevice", () => ({ default: {} }));

import { PrinterService } from "@/lib/printer";

function mockFindOneJob(job: unknown) {
    printJobFindOneAndUpdateMock.mockReturnValue({
        populate: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(job)
        })
    });
}

function recoverableKitchenJob() {
    return {
        _id: { toString: () => "job-kitchen" },
        eventId: { toString: () => "evt-1" },
        source: "ORDER",
        printType: "KITCHEN_ORDER",
        queueRecoverable: true,
        copies: 1,
        printerId: {
            _id: "printer-kitchen",
            ip: "printer-emulator",
            port: 19101,
            isVirtual: false
        },
        document: {
            schemaVersion: 2,
            printType: "KITCHEN_ORDER",
            title: "Comanda reparto",
            items: [{ name: "Panino", qty: 1 }]
        }
    };
}

describe("PrinterService.retryPrintJobById", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildPrintQueueLeaseMock.mockReturnValue({
            token: "lease-token",
            expiresAt: new Date("2026-08-12T10:00:00.000Z")
        });
        claimKitchenPrinterQueueLeaseMock.mockResolvedValue(true);
        releaseKitchenPrinterQueueLeaseMock.mockResolvedValue(undefined);
        completeSumUpPrintIntentsForSentJobMock.mockResolvedValue(false);
        claimSumUpEventOperationMock.mockResolvedValue("event-operation-1");
        releaseSumUpEventOperationMock.mockResolvedValue(undefined);
        ensureEventOperationOwnedMock.mockResolvedValue(true);
        printJobExistsMock.mockResolvedValue(false);
        printJobUpdateOneMock.mockReset().mockResolvedValue({ matchedCount: 1 });
        orderFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        });
    });

    test("registers the Printer model required by populate", () => {
        expect(mongoose.models.Printer).toBeDefined();
    });

    test("returns validation error when ids are missing", async () => {
        const result = await PrinterService.retryPrintJobById("", "");
        expect(result).toEqual({ success: false, error: "Parametri mancanti" });
    });

    test("returns not found when print job does not exist", async () => {
        mockFindOneJob(null);

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: false, error: "Job non disponibile o già acquisito" });
    });

    test("retries legacy cash session summaries without losing their document", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            source: "CASH_SESSION",
            printType: "CASH_SESSION_SUMMARY",
            copies: 1,
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            document: {
                kind: "CASH_SESSION_SUMMARY",
                sessionId: "session-12345678",
                items: [{ name: "Panino", quantity: 2, lineTotal: 10 }],
                totals: { totaleIncassi: "10.00 EUR" }
            }
        });
        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({
            success: true,
            rawCapturePath: "/tmp/receipt.raw",
            automaticRetryCount: 1
        });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: true });
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            printType: "CASH_SESSION_SUMMARY",
            document: expect.objectContaining({
                printType: "CASH_SESSION_SUMMARY",
                items: [expect.objectContaining({ name: "Panino", qty: 2, lineTotal: 10 })]
            })
        }));
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "SENT",
                    rawCapturePath: "/tmp/receipt.raw",
                    automaticRetryCount: 1
                },
                $unset: { errorMessage: 1, retryClaimedAt: 1 }
            }
        );
    });

    test("retries a failed order print and returns success", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            eventId: { toString: () => "evt-1" },
            source: "ORDER",
            printType: "MANUAL_TEST",
            copies: 2,
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            isVirtual: false,
            printerId: {
                _id: "printer-1",
                ip: "printer-emulator",
                port: 19100,
                isVirtual: false
            },
            document: {
                schemaVersion: 2,
                printType: "MANUAL_TEST",
                copyLabel: "COPIA TEST",
                title: "Ricevuta Demo",
                orderId: "order-1",
                shortCode: "D-12345",
                items: [{ qty: 1, name: "Panino" }],
                totals: [{ label: "TOTALE", value: "5.00 EUR" }]
            }
        });

        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: true, automaticRetryCount: 0 });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            printType: "MANUAL_TEST",
            copies: 2,
            document: expect.objectContaining({ title: "Ricevuta Demo", copyLabel: "COPIA TEST", orderId: "order-1", shortCode: "D-12345" })
        }));
        expect(result).toEqual({ success: true });
        expect(completeSumUpPrintIntentsForSentJobMock).not.toHaveBeenCalled();
        expect(printJobFindOneAndUpdateMock).toHaveBeenCalledWith(
            { _id: "job-1", eventId: "evt-1", status: "FAILED" },
            { $set: {
                status: "QUEUED",
                retryClaimedAt: expect.any(Date),
                errorMessage: "Reinvio in corso: verifica la stampa prima di riprovare"
            } },
            { returnDocument: "after" }
        );
    });

    test("retries a recoverable kitchen print while holding the printer queue lease", async () => {
        mockFindOneJob(recoverableKitchenJob());
        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: true, automaticRetryCount: 0 });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

        expect(result).toEqual({ success: true });
        expect(claimKitchenPrinterQueueLeaseMock).toHaveBeenCalledWith(
            "printer-kitchen",
            "lease-token",
            new Date("2026-08-12T10:00:00.000Z")
        );
        expect(dispatchSpy).toHaveBeenCalledOnce();
        expect(releaseKitchenPrinterQueueLeaseMock).toHaveBeenCalledWith("printer-kitchen", "lease-token");
    });

    test("returns a recoverable kitchen retry to failed when the printer lease is busy", async () => {
        const job = recoverableKitchenJob();
        mockFindOneJob(job);
        claimKitchenPrinterQueueLeaseMock.mockResolvedValue(false);
        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        );

        const result = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

        const retryClaimedAt = printJobFindOneAndUpdateMock.mock.calls[0][1].$set.retryClaimedAt;
        const error = "La stampante sta già inviando una comanda. Riprova tra poco.";
        expect(result).toEqual({ success: false, error });
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: job._id, eventId: "evt-1", status: "QUEUED", retryClaimedAt },
            { $set: { status: "FAILED", errorMessage: error }, $unset: { retryClaimedAt: 1 } }
        );
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(releaseKitchenPrinterQueueLeaseMock).not.toHaveBeenCalled();
    });

    test("does not let a recoverable kitchen retry bypass an existing held queue", async () => {
        const job = recoverableKitchenJob();
        mockFindOneJob(job);
        printJobExistsMock.mockResolvedValue(true);
        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        );

        const result = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

        const retryClaimedAt = printJobFindOneAndUpdateMock.mock.calls[0][1].$set.retryClaimedAt;
        const error = "Ci sono già stampe reparto in coda. Attendi il completamento prima di riprovare.";
        expect(result).toEqual({ success: false, error });
        expect(printJobExistsMock).toHaveBeenCalledWith(expect.objectContaining({
            eventId: "evt-1",
            printerId: "printer-kitchen",
            queueRecoverable: true,
            status: { $in: ["HELD", "QUEUED"] },
            heldSince: { $exists: true }
        }));
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: job._id, eventId: "evt-1", status: "QUEUED", retryClaimedAt },
            { $set: { status: "FAILED", errorMessage: error }, $unset: { retryClaimedAt: 1 } }
        );
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(releaseKitchenPrinterQueueLeaseMock).toHaveBeenCalledWith("printer-kitchen", "lease-token");
    });

    test("releases the printer queue lease when a recoverable kitchen retry is interrupted", async () => {
        mockFindOneJob(recoverableKitchenJob());
        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockRejectedValue(new Error("render failed"));

        const result = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

        expect(result).toEqual({ success: false, error: "Reinvio stampa interrotto" });
        expect(releaseKitchenPrinterQueueLeaseMock).toHaveBeenCalledWith("printer-kitchen", "lease-token");
    });

    test("returns unexpectedly interrupted retries to FAILED", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            source: "ORDER",
            printType: "MANUAL_TEST",
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            document: { title: "Ricevuta Demo", items: [] }
        });
        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockRejectedValue(new Error("render failed"));

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        const retryClaimedAt = printJobFindOneAndUpdateMock.mock.calls[0][1].$set.retryClaimedAt;

        expect(result).toEqual({ success: false, error: "Reinvio stampa interrotto" });
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1", eventId: "evt-1", status: "QUEUED", retryClaimedAt },
            {
                $set: { status: "FAILED", errorMessage: "Reinvio stampa interrotto" },
                $unset: { retryClaimedAt: 1 }
            }
        );
    });

    test("returns a claimed job to FAILED when populate fails", async () => {
        printJobFindOneAndUpdateMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockRejectedValue(new Error("populate failed"))
            })
        });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        const retryClaimedAt = printJobFindOneAndUpdateMock.mock.calls[0][1].$set.retryClaimedAt;

        expect(result).toEqual({ success: false, error: "Reinvio stampa interrotto" });
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1", eventId: "evt-1", status: "QUEUED", retryClaimedAt },
            {
                $set: { status: "FAILED", errorMessage: "Reinvio stampa interrotto" },
                $unset: { retryClaimedAt: 1 }
            }
        );
    });

    test("retries legacy print documents with object totals", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-legacy" },
            source: "ORDER",
            printType: "CUSTOMER_ORDER",
            copies: 1,
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            document: {
                kind: "COMANDA",
                title: "Comanda Cliente",
                shortCode: "123",
                customerName: "Mario",
                tableNumber: "A1",
                items: [{ name: "Panino", quantity: 2, notes: "No salsa" }],
                totals: { totale: "10.00 EUR" }
            }
        });

        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: true, automaticRetryCount: 0 });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-legacy");
        expect(result).toEqual({ success: true });
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            printType: "CUSTOMER_ORDER",
            document: expect.objectContaining({ title: "Comanda Cliente", shortCode: "123", customerName: "Mario", tableNumber: "A1", totals: [{ label: "TOTALE", value: "10.00 EUR", emphasis: "strong" }] })
        }));
    });

    test("returns retry failure when print dispatch fails", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            source: "ORDER",
            printType: "MANUAL_TEST",
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            document: {
                title: "Ricevuta Demo",
                orderId: "order-1",
                items: [{ name: "Panino", quantity: 1 }]
            }
        });

        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: false, errorMessage: "Printer not reachable", automaticRetryCount: 0 });
        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: false, error: "Invio stampa fallito" });
    });

    test("dispatches a queue-owned kitchen job without mutating its status", async () => {
        printJobFindOneMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    printerId: {
                        ip: "printer-emulator",
                        port: 19101,
                        type: "KITCHEN",
                        isVirtual: false
                    },
                    copies: 1,
                    document: {
                        schemaVersion: 2,
                        printType: "KITCHEN_ORDER",
                        title: "Comanda reparto",
                        copyLabel: "CUCINA",
                        items: [{ name: "Panino", qty: 1 }],
                        totals: []
                    }
                })
            })
        });
        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: true, rawCapturePath: "/tmp/kitchen.raw", automaticRetryCount: 0 });

        await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1")).resolves.toEqual({
            success: true,
            rawCapturePath: "/tmp/kitchen.raw",
            automaticRetryCount: 0
        });
        expect(printJobFindOneMock).toHaveBeenCalledWith(expect.objectContaining({
            _id: "job-1",
            eventId: "evt-1",
            status: "QUEUED",
            printType: "KITCHEN_ORDER",
            queueRecoverable: true,
            queueClaimToken: { $exists: true }
        }));
        expect(printJobUpdateOneMock).not.toHaveBeenCalled();
        expect(claimSumUpEventOperationMock).not.toHaveBeenCalled();
    });

    describe("failed SumUp jobs", () => {
        const job = {
            ...recoverableKitchenJob(), printType: "CUSTOMER_ORDER", orderId: "order-1",
            idempotencyKey: "SUMUP_CALLBACK:order-1:customer"
        };
        const dispatchService = PrinterService as unknown as {
            dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown>;
        };

        beforeEach(() => {
            mockFindOneJob(job);
            orderFindOneMock.mockReturnValue({ select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ status: "PAID" })
            }) });
            vi.spyOn(dispatchService, "dispatchPrintDocumentWithAutomaticRetry").mockResolvedValue({
                success: true, automaticRetryCount: 0
            });
        });
        afterEach(() => {
            vi.mocked(dispatchService.dispatchPrintDocumentWithAutomaticRetry).mockRestore();
        });

        test.each(["CUSTOMER_ORDER", "KITCHEN_ORDER"])("leaves %s failed while storno owns the event claim", async (printType) => {
            mockFindOneJob({ ...job, printType });
            claimSumUpEventOperationMock.mockResolvedValue(null);

            await expect(PrinterService.retryPrintJobById("evt-1", "job-kitchen"))
                .resolves.toMatchObject({ success: false });
            expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).not.toHaveBeenCalled();
            expect(orderFindOneMock).not.toHaveBeenCalled();
            expect(printJobUpdateOneMock).toHaveBeenLastCalledWith(
                expect.objectContaining({ eventId: "evt-1", status: "QUEUED", retryClaimedAt: expect.any(Date) }),
                { $set: { status: "FAILED", errorMessage: expect.any(String) }, $unset: { retryClaimedAt: 1 } }
            );
        });

        test.each([
            { status: "CANCELLED" },
            { status: "PAID", stornoMeta: { refundStatus: "DONE" } },
            { status: "PAID", stornoMeta: { status: "IN_PROGRESS" } },
            { status: "PAID", stornoMeta: { status: "FAILED", refundStatus: "FAILED" } }
        ])("does not retry an order in state %j", async (order) => {
            orderFindOneMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(order) }) });

            await expect(PrinterService.retryPrintJobById("evt-1", "job-kitchen"))
                .resolves.toMatchObject({ success: false });
            expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).not.toHaveBeenCalled();
            expect(printJobUpdateOneMock).toHaveBeenLastCalledWith(
                expect.objectContaining({ status: "QUEUED", retryClaimedAt: expect.any(Date) }),
                { $set: { status: "FAILED", errorMessage: expect.any(String) }, $unset: { retryClaimedAt: 1 } }
            );
            expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("evt-1", "event-operation-1");
        });

        test.each(["CUSTOMER_ORDER", "KITCHEN_ORDER"])("holds the event claim while retrying a valid %s", async (printType) => {
            mockFindOneJob({ ...job, printType });
            vi.mocked(dispatchService.dispatchPrintDocumentWithAutomaticRetry).mockImplementationOnce(async () => {
                expect(claimSumUpEventOperationMock).toHaveBeenCalledWith("evt-1");
                expect(ensureEventOperationOwnedMock).toHaveBeenCalled();
                expect(releaseSumUpEventOperationMock).not.toHaveBeenCalled();
                return { success: true, automaticRetryCount: 0 };
            });

            await expect(PrinterService.retryPrintJobById("evt-1", "job-kitchen"))
                .resolves.toMatchObject({ success: true });
            expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).toHaveBeenCalledOnce();
            expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce();
            expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("evt-1", "event-operation-1");
        });

        test.each(["completion", "marker cleanup"])("preserves physical success and a retry marker after %s fails", async (failure) => {
            printJobUpdateOneMock.mockResolvedValue({ matchedCount: 1 });
            if (failure === "completion") {
                completeSumUpPrintIntentsForSentJobMock.mockRejectedValueOnce(new Error("metadata failure"));
            } else {
                printJobUpdateOneMock.mockResolvedValueOnce({ matchedCount: 1 }).mockRejectedValueOnce(new Error("metadata failure"));
            }

            await expect(PrinterService.retryPrintJobById("evt-1", "job-kitchen"))
                .resolves.toEqual({ success: true });

            expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).toHaveBeenCalledOnce();
            expect(printJobUpdateOneMock.mock.calls[0][1]).toMatchObject({
                $set: { status: "SENT" }, $unset: { errorMessage: 1 }
            });
            expect(printJobUpdateOneMock.mock.calls[0][1].$unset).not.toHaveProperty("retryClaimedAt");
            expect(printJobUpdateOneMock).toHaveBeenCalledTimes(failure === "completion" ? 1 : 2);
            expect(printJobUpdateOneMock.mock.calls.some(([, update]) => update.$set?.status === "FAILED")).toBe(false);
        });

        test("reports an unrecorded physical print and prevents an immediate second dispatch", async () => {
            const stored: Record<string, unknown> = { ...job, status: "FAILED" };
            printJobFindOneAndUpdateMock.mockImplementation((filter, update) => {
                const matched = stored.status === filter.status;
                if (matched) Object.assign(stored, update.$set);
                return { populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(matched ? stored : null) }) };
            });
            printJobUpdateOneMock.mockImplementation(async (filter, update) => {
                if (update.$set?.status === "SENT") throw new Error("SENT persistence failed");
                if (filter.status && filter.status !== stored.status) return { matchedCount: 0 };
                Object.assign(stored, update.$set);
                for (const key of Object.keys(update.$unset || {})) delete stored[key];
                return { matchedCount: 1 };
            });

            const firstResult = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");
            const secondResult = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

            expect(firstResult).toEqual({
                success: false,
                error: "Stampa inviata ma non registrata: verifica la stampa prima di riprovare",
                requiresPrintVerification: true
            });
            expect(secondResult).toMatchObject({ success: false });
            expect(stored).toMatchObject({
                status: "QUEUED",
                retryClaimedAt: expect.any(Date),
                errorMessage: "Reinvio in corso: verifica la stampa prima di riprovare"
            });
            expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).toHaveBeenCalledOnce();
            expect(completeSumUpPrintIntentsForSentJobMock).not.toHaveBeenCalled();
            expect(printJobUpdateOneMock.mock.calls.some(([, update]) => update.$set?.status === "FAILED")).toBe(false);
        });

        test("does not dispatch after losing the event claim during order validation", async () => {
            orderFindOneMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockImplementation(async () => {
                ensureEventOperationOwnedMock.mockResolvedValue(false);
                return { status: "PAID" };
            }) }) });

            await expect(PrinterService.retryPrintJobById("evt-1", "job-kitchen"))
                .resolves.toMatchObject({ success: false });
            expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).not.toHaveBeenCalled();
            expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce();
            expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("evt-1", "event-operation-1");
        });
    });

    describe("queued SumUp jobs", () => {
        const dispatchService = PrinterService as unknown as {
            dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown>;
            enqueueJobForDestination: (destination: string, task: () => Promise<unknown>) => Promise<unknown>;
        };

        beforeEach(() => {
            const job = recoverableKitchenJob();
            printJobFindOneMock.mockReturnValue({ populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    ...job, orderId: "order-1", idempotencyKey: "SUMUP_CALLBACK:order-1:kitchen",
                    printerId: { ...job.printerId, type: "KITCHEN" }
                })
            }) });
            orderFindOneMock.mockReturnValue({ select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ status: "PAID" })
            }) });
            vi.spyOn(dispatchService, "dispatchPrintDocumentWithAutomaticRetry").mockResolvedValue({
                success: true, automaticRetryCount: 0
            });
        });
        afterEach(() => {
            vi.mocked(dispatchService.dispatchPrintDocumentWithAutomaticRetry).mockRestore();
        });

        test("holds the job while another event operation owns the claim", async () => {
            claimSumUpEventOperationMock.mockResolvedValue(null);
            await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1"))
                .resolves.toMatchObject({ success: false, recoverable: true });
            expect(orderFindOneMock).not.toHaveBeenCalled();
            expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).not.toHaveBeenCalled();
        });

        test.each([
            [null, false],
            [{ status: "CANCELLED" }, false],
            [{ status: "PAID", stornoMeta: { refundStatus: "DONE", status: "FAILED" } }, false],
            [{ status: "PAID", stornoMeta: { status: "IN_PROGRESS" } }, true],
            [{ status: "PAID", stornoMeta: { status: "FAILED", refundStatus: "FAILED" } }, true]
        ])("does not dispatch an order in state %j", async (order, recoverable) => {
            orderFindOneMock.mockReturnValue({ select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(order)
            }) });
            await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1"))
                .resolves.toMatchObject({ success: false, recoverable });
            expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).not.toHaveBeenCalled();
            expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce();
            expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("evt-1", "event-operation-1");
        });

        test("checks ownership after waiting in the destination queue", async () => {
            const enqueue = vi.spyOn(dispatchService, "enqueueJobForDestination")
                .mockImplementationOnce(async (_destination, task) => {
                    ensureEventOperationOwnedMock.mockResolvedValue(false);
                    return task();
                });
            try {
                await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1"))
                    .resolves.toMatchObject({ success: false, recoverable: true });
                expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry).not.toHaveBeenCalled();
                expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("evt-1", "event-operation-1");
            } finally {
                enqueue.mockRestore();
            }
        });

        test("keeps the event claim through dispatch and releases it afterwards", async () => {
            vi.mocked(dispatchService.dispatchPrintDocumentWithAutomaticRetry).mockImplementationOnce(async () => {
                expect(claimSumUpEventOperationMock).toHaveBeenCalledWith("evt-1");
                expect(orderFindOneMock).toHaveBeenCalledWith({ _id: "order-1", eventId: "evt-1" });
                expect(ensureEventOperationOwnedMock).toHaveBeenCalled();
                expect(releaseSumUpEventOperationMock).not.toHaveBeenCalled();
                return { success: true, automaticRetryCount: 0 };
            });
            await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1"))
                .resolves.toMatchObject({ success: true });
            expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce();
            expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("evt-1", "event-operation-1");
        });

        test.each(["order lookup", "claim release"])("handles %s failure without an incorrect dispatch outcome", async (stage) => {
            const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
            if (stage === "order lookup") {
                orderFindOneMock.mockReturnValue({ select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockRejectedValue(new Error("database unavailable"))
                }) });
            } else {
                releaseSumUpEventOperationMock.mockRejectedValueOnce(new Error("database unavailable"));
            }
            try {
                await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1"))
                    .resolves.toMatchObject(stage === "order lookup"
                        ? { success: false, recoverable: true } : { success: true });
                expect(dispatchService.dispatchPrintDocumentWithAutomaticRetry)
                    .toHaveBeenCalledTimes(stage === "order lookup" ? 0 : 1);
                expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce();
                expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("evt-1", "event-operation-1");
            } finally {
                errorLog.mockRestore();
            }
        });
    });

    test("classifies physical dispatch failures as recoverable for the queue", async () => {
        printJobFindOneMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    printerId: { ip: "printer-emulator", port: 19101, type: "KITCHEN" },
                    copies: 1,
                    document: { title: "Comanda reparto", items: [] }
                })
            })
        });
        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: false, errorMessage: "Printer not reachable", automaticRetryCount: 5 });

        await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1")).resolves.toEqual({
            success: false,
            recoverable: true,
            error: "Printer not reachable",
            automaticRetryCount: 5
        });
    });

    test.each([false, true])("retries the stored raster unless the SumUp lease is lost (lostLease=%s)", async (lostLease) => {
        const rasterWidth = getThermalContentWidth();
        mockFindOneJob({
            _id: { toString: () => "job-raster" },
            eventId: { toString: () => "evt-1" },
            orderId: { toString: () => "order-1" },
            idempotencyKey: lostLease ? "SUMUP_CALLBACK:order-1:easter-egg" : undefined,
            source: "ORDER",
            printType: "EASTER_EGG_IMAGE",
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            printerId: {
                _id: "printer-1",
                ip: "printer-emulator",
                port: 19100,
                isVirtual: false
            },
            document: {
                title: "Easter Egg Cliente"
            }
        });
        orderFindOneMock.mockReturnValue({
            select: vi.fn().mockImplementation((fields: string) => ({
                lean: vi.fn().mockImplementation(async () => {
                    if (lostLease && fields === "easterEggAttachment") ensureEventOperationOwnedMock.mockResolvedValue(false);
                    return {
                        status: "PAID",
                        easterEggAttachment: {
                            rasterWidth,
                            rasterHeight: 20,
                            rasterData: new Binary(Buffer.alloc((rasterWidth / 8) * 20, 0xaa))
                        }
                    };
                })
            }))
        });

        const printRasterSpy = vi.spyOn(
            PrinterService as unknown as { dispatchRasterImageWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchRasterImageWithAutomaticRetry"
        ).mockResolvedValue({ success: true, automaticRetryCount: 0 });
        const result = await PrinterService.retryPrintJobById("evt-1", "job-raster");

        if (lostLease) {
            expect(result).toMatchObject({ success: false });
            expect(printRasterSpy).not.toHaveBeenCalled();
            expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("evt-1", "event-operation-1");
            printRasterSpy.mockRestore();
            return;
        }
        expect(result).toEqual({ success: true });
        expect(printRasterSpy).toHaveBeenCalledWith(expect.objectContaining({
            raster: expect.objectContaining({
                width: rasterWidth,
                height: 20
            }),
            copies: 1
        }));
        printRasterSpy.mockRestore();
    });
});
