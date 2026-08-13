import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    dbConnect: vi.fn(),
    revalidatePath: vi.fn(),
    orderExists: vi.fn(),
    claimSumUpEventOperation: vi.fn(),
    releaseSumUpEventOperation: vi.fn(),
    deletePrintJobs: vi.fn(),
    deleteCashSessions: vi.fn(),
    deleteOrders: vi.fn(),
    deleteOrderCounters: vi.fn(),
    deletePosDevices: vi.fn(),
    deletePeripherals: vi.fn(),
    deletePrinters: vi.fn(),
    deleteProducts: vi.fn(),
    deleteIngredients: vi.fn(),
    deleteCategories: vi.fn(),
    deleteEvent: vi.fn(),
    archiveEvent: vi.fn(),
}));

vi.mock("../action-context", () => ({
    requireAdminAuthorization: mocks.authorize,
}));

vi.mock("@/lib/mongoose", () => ({ default: mocks.dbConnect }));
vi.mock("@/lib/sumup-event-operation", () => ({
    claimSumUpEventOperation: mocks.claimSumUpEventOperation,
    releaseSumUpEventOperation: mocks.releaseSumUpEventOperation
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/models/PrintJob", () => ({ default: { deleteMany: mocks.deletePrintJobs } }));
vi.mock("@/models/CashSession", () => ({ default: { deleteMany: mocks.deleteCashSessions } }));
vi.mock("@/models/Order", () => ({ default: { deleteMany: mocks.deleteOrders, exists: mocks.orderExists } }));
vi.mock("@/models/OrderCounter", () => ({ default: { deleteMany: mocks.deleteOrderCounters } }));
vi.mock("@/models/PosDevice", () => ({ default: { deleteMany: mocks.deletePosDevices } }));
vi.mock("@/models/Peripheral", () => ({ default: { deleteMany: mocks.deletePeripherals } }));
vi.mock("@/models/Printer", () => ({ default: { deleteMany: mocks.deletePrinters } }));
vi.mock("@/models/Product", () => ({ default: { deleteMany: mocks.deleteProducts } }));
vi.mock("@/models/Ingredient", () => ({ default: { deleteMany: mocks.deleteIngredients } }));
vi.mock("@/models/Category", () => ({ default: { deleteMany: mocks.deleteCategories } }));
vi.mock("@/models/Event", () => ({
    default: {
        findOneAndDelete: mocks.deleteEvent,
        findOneAndUpdate: mocks.archiveEvent,
    }
}));

import { archiveEventAction, deleteEventAction } from "./actions";

describe("event lifecycle actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockResolvedValue(null);
        mocks.dbConnect.mockResolvedValue(undefined);
        mocks.orderExists.mockResolvedValue(false);
        mocks.claimSumUpEventOperation.mockResolvedValue("event-claim-1");
        mocks.archiveEvent.mockImplementation((_filter, _update, options) => options
            ? { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: "event-1" }) }) }
            : Promise.resolve({ _id: "event-1" }));
    });

    test("preserves the complete event deletion cascade", async () => {
        const formData = new FormData();
        formData.set("eventId", "event-1");

        await deleteEventAction(formData);

        const scope = { eventId: "event-1" };
        expect(mocks.archiveEvent).toHaveBeenCalledWith(
            { _id: "event-1", "sumupOperationClaim.token": "event-claim-1" },
            { $set: { archived: true, active: false } },
            { returnDocument: "after" }
        );
        expect(mocks.deletePrintJobs).toHaveBeenCalledWith(scope);
        expect(mocks.deleteCashSessions).toHaveBeenCalledWith(scope);
        expect(mocks.deleteOrders).toHaveBeenCalledWith(scope);
        expect(mocks.deleteOrderCounters).toHaveBeenCalledWith(scope);
        expect(mocks.deletePosDevices).toHaveBeenCalledWith(scope);
        expect(mocks.deletePeripherals).toHaveBeenCalledWith(scope);
        expect(mocks.deletePrinters).toHaveBeenCalledWith(scope);
        expect(mocks.deleteProducts).toHaveBeenCalledWith(scope);
        expect(mocks.deleteIngredients).toHaveBeenCalledWith(scope);
        expect(mocks.deleteCategories).toHaveBeenCalledWith(scope);
        expect(mocks.deleteEvent).toHaveBeenCalledWith({
            _id: "event-1",
            "sumupOperationClaim.token": "event-claim-1"
        });
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings/events");
    });

    test("archives and deactivates the selected event", async () => {
        const formData = new FormData();
        formData.set("eventId", "event-2");

        await archiveEventAction(formData);

        expect(mocks.archiveEvent).toHaveBeenCalledWith(
            { _id: "event-2", "sumupOperationClaim.token": "event-claim-1" },
            { $set: { archived: true, active: false }, $unset: { sumupOperationClaim: 1 } }
        );
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings/events");
    });

    test("does not mutate data when authorization fails", async () => {
        mocks.authorize.mockResolvedValue({ error: "Non autorizzato" });
        const formData = new FormData();
        formData.set("eventId", "event-3");

        await deleteEventAction(formData);

        expect(mocks.dbConnect).not.toHaveBeenCalled();
        expect(mocks.deleteEvent).not.toHaveBeenCalled();
    });

    test.each([
        ["archive", archiveEventAction],
        ["delete", deleteEventAction]
    ] as const)("blocks event %s while SumUp payments are unresolved", async (_operation, action) => {
        mocks.orderExists.mockResolvedValue(true);
        const formData = new FormData();
        formData.set("eventId", "event-4");

        await expect(action(formData)).resolves.toEqual({
            error: expect.stringMatching(/pagamenti SumUp in attesa o non ancora rimborsati/i)
        });

        expect(mocks.orderExists).toHaveBeenCalledWith({
            eventId: "event-4",
            $or: [
                {
                    status: "PENDING",
                    sumupCheckoutId: { $exists: true, $nin: [null, ""] }
                },
                {
                    status: "PAID",
                    $or: [
                        { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                        { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                    ]
                },
                {
                    status: "CANCELLED",
                    sumupRecoveryCancelledAt: { $exists: true, $ne: null },
                    sumupRecoveryResolvedAt: { $exists: false },
                    "stornoMeta.refundStatus": { $ne: "DONE" }
                }
            ]
        });
        expect(mocks.archiveEvent).not.toHaveBeenCalled();
        expect(mocks.deleteEvent).not.toHaveBeenCalled();
        expect(mocks.deleteOrders).not.toHaveBeenCalled();
    });
});
