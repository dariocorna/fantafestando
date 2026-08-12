import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    requireContextEventId: vi.fn(),
    resolveEventScope: vi.fn(),
    dbConnect: vi.fn(),
    revalidatePath: vi.fn(),
    orderExists: vi.fn(),
    peripheralExists: vi.fn(),
    peripheralFindOne: vi.fn(),
    posDeviceFindOne: vi.fn(),
    posDeviceFindOneAndDelete: vi.fn(),
    posDeviceFindOneAndUpdate: vi.fn(),
    printerFindOne: vi.fn()
}));

vi.mock("../action-context", () => ({
    requireAdminAuthorization: mocks.authorize,
    requireContextEventId: mocks.requireContextEventId,
    resolveEventScope: mocks.resolveEventScope
}));
vi.mock("@/lib/mongoose", () => ({ default: mocks.dbConnect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/models/Order", () => ({ default: { exists: mocks.orderExists } }));
vi.mock("@/models/Peripheral", () => ({
    default: {
        exists: mocks.peripheralExists,
        findOne: mocks.peripheralFindOne
    }
}));
vi.mock("@/models/PosDevice", () => ({
    default: {
        findOne: mocks.posDeviceFindOne,
        findOneAndDelete: mocks.posDeviceFindOneAndDelete,
        findOneAndUpdate: mocks.posDeviceFindOneAndUpdate
    }
}));
vi.mock("@/models/Printer", () => ({ default: { findOne: mocks.printerFindOne } }));

import { deletePosDeviceAction, updatePosDeviceAction } from "./actions";

function queryResult(value: unknown) {
    return {
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(value)
        })
    };
}

function posDeviceForm(overrides: Record<string, string> = {}) {
    const formData = new FormData();
    const fields = {
        id: "pos-1",
        eventId: "event-1",
        name: "Cassa 1",
        printerId: "printer-1",
        paymentTerminalId: "terminal-1",
        cashBoxId: "none",
        ...overrides
    };
    Object.entries(fields).forEach(([key, value]) => formData.set(key, value));
    return formData;
}

function legacySumUpRefundQuery() {
    return {
        eventId: "event-1",
        posDeviceId: "pos-1",
        "sumupRefundCredentials.apiKey": { $in: [null, ""] },
        "stornoMeta.refundStatus": { $ne: "DONE" },
        $or: [
            {
                status: "PAID",
                $or: [
                    { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                    { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                ]
            },
            {
                status: "CANCELLED",
                sumupLateSuccessDetectedAt: { $exists: true, $ne: null }
            }
        ]
    };
}

describe("pending SumUp checkout hardware guards", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockResolvedValue(null);
        mocks.requireContextEventId.mockResolvedValue("event-1");
        mocks.resolveEventScope.mockReturnValue({ eventId: "event-1" });
        mocks.dbConnect.mockResolvedValue(undefined);
        mocks.orderExists.mockResolvedValue(false);
        mocks.peripheralExists.mockResolvedValue({ _id: "terminal-1" });
        mocks.peripheralFindOne.mockReturnValue(queryResult({ _id: "peripheral-1" }));
        mocks.posDeviceFindOne.mockReturnValue(queryResult({
            _id: "pos-1",
            printerId: "printer-1",
            paymentTerminalId: "terminal-1"
        }));
        mocks.posDeviceFindOneAndDelete.mockReturnValue(queryResult({ _id: "pos-1" }));
        mocks.posDeviceFindOneAndUpdate.mockReturnValue(queryResult({ _id: "pos-1" }));
        mocks.printerFindOne.mockReturnValue(queryResult({ _id: "printer-1" }));
    });

    test("blocks deleting a POS whose SumUp checkout is pending", async () => {
        mocks.orderExists.mockResolvedValue(true);

        await expect(deletePosDeviceAction(posDeviceForm())).resolves.toEqual({
            error: expect.stringMatching(/ordine SumUp in attesa/i)
        });

        expect(mocks.peripheralExists).toHaveBeenCalledWith({
            _id: "terminal-1",
            eventId: "event-1",
            type: "SUMUP"
        });
        expect(mocks.orderExists).toHaveBeenCalledWith({
            eventId: "event-1",
            status: "PENDING",
            posDeviceId: "pos-1",
            sumupCheckoutId: { $exists: true, $nin: [null, ""] }
        });
        expect(mocks.posDeviceFindOneAndDelete).not.toHaveBeenCalled();
    });

    test("blocks deleting a POS needed for a legacy SumUp refund", async () => {
        mocks.orderExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        await expect(deletePosDeviceAction(posDeviceForm())).resolves.toEqual({
            error: expect.stringMatching(/pagamento SumUp non ancora rimborsato/i)
        });

        expect(mocks.orderExists).toHaveBeenNthCalledWith(2, legacySumUpRefundQuery());
        expect(mocks.posDeviceFindOneAndDelete).not.toHaveBeenCalled();
    });

    test.each(["terminal-2", "none"])(
        "blocks changing or removing the terminal while a SumUp checkout is pending (%s)",
        async (paymentTerminalId) => {
            mocks.orderExists.mockResolvedValue(true);

            await expect(updatePosDeviceAction(posDeviceForm({ paymentTerminalId }))).resolves.toEqual({
                error: expect.stringMatching(/ordine SumUp in attesa/i)
            });

            expect(mocks.orderExists).toHaveBeenCalledWith({
                eventId: "event-1",
                status: "PENDING",
                posDeviceId: "pos-1",
                sumupCheckoutId: { $exists: true, $nin: [null, ""] }
            });
            expect(mocks.posDeviceFindOneAndUpdate).not.toHaveBeenCalled();
        }
    );

    test.each(["terminal-2", "none"])(
        "blocks changing or removing a terminal needed for a legacy SumUp refund (%s)",
        async (paymentTerminalId) => {
            mocks.orderExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

            await expect(updatePosDeviceAction(posDeviceForm({ paymentTerminalId }))).resolves.toEqual({
                error: expect.stringMatching(/pagamento SumUp non ancora rimborsato/i)
            });

            expect(mocks.orderExists).toHaveBeenNthCalledWith(2, legacySumUpRefundQuery());
            expect(mocks.posDeviceFindOneAndUpdate).not.toHaveBeenCalled();
        }
    );

    test("allows changing the name and cash box while keeping the original SumUp terminal", async () => {
        mocks.orderExists.mockResolvedValue(true);

        await expect(updatePosDeviceAction(posDeviceForm({
            name: "Cassa rinominata",
            cashBoxId: "cashbox-2"
        }))).resolves.toEqual({
            success: true
        });

        expect(mocks.peripheralExists).not.toHaveBeenCalled();
        expect(mocks.orderExists).not.toHaveBeenCalled();
        expect(mocks.posDeviceFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: "pos-1", eventId: "event-1" },
            expect.objectContaining({
                name: "Cassa rinominata",
                paymentTerminalId: "terminal-1",
                cashBoxId: "cashbox-2"
            }),
            { returnDocument: "after" }
        );
    });

    test("blocks changing the cashier printer while a SumUp checkout is pending", async () => {
        mocks.orderExists.mockResolvedValue(true);

        await expect(updatePosDeviceAction(posDeviceForm({ printerId: "printer-2" }))).resolves.toEqual({
            error: expect.stringMatching(/ordine SumUp in attesa/i)
        });

        expect(mocks.orderExists).toHaveBeenCalledWith({
            eventId: "event-1",
            status: "PENDING",
            posDeviceId: "pos-1",
            sumupCheckoutId: { $exists: true, $nin: [null, ""] }
        });
        expect(mocks.posDeviceFindOneAndUpdate).not.toHaveBeenCalled();
    });

    test("allows changing only the printer when no SumUp checkout is pending", async () => {
        mocks.orderExists.mockImplementation(async (query: Record<string, unknown>) => (
            "sumupRefundCredentials.apiKey" in query
        ));

        await expect(updatePosDeviceAction(posDeviceForm({ printerId: "printer-2" }))).resolves.toEqual({
            success: true
        });

        expect(mocks.orderExists).toHaveBeenCalledTimes(1);
        expect(mocks.orderExists).toHaveBeenCalledWith({
            eventId: "event-1",
            status: "PENDING",
            posDeviceId: "pos-1",
            sumupCheckoutId: { $exists: true, $nin: [null, ""] }
        });
        expect(mocks.posDeviceFindOneAndUpdate).toHaveBeenCalled();
    });

    test("allows replacing a SumUp terminal when no checkout is pending", async () => {
        await expect(updatePosDeviceAction(posDeviceForm({ paymentTerminalId: "terminal-2" }))).resolves.toEqual({
            success: true
        });

        expect(mocks.orderExists).toHaveBeenCalled();
        expect(mocks.posDeviceFindOneAndUpdate).toHaveBeenCalled();
    });

    test("does not block deleting a POS with a manual electronic terminal", async () => {
        mocks.peripheralExists.mockResolvedValue(null);
        mocks.orderExists.mockResolvedValue(true);

        await expect(deletePosDeviceAction(posDeviceForm())).resolves.toEqual({ success: true });

        expect(mocks.orderExists).not.toHaveBeenCalled();
        expect(mocks.posDeviceFindOneAndDelete).toHaveBeenCalled();
    });
});
