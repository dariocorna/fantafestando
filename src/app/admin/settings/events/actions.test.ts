import { beforeEach, describe, expect, test, vi } from "vitest";
import sift from "sift";

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

    const paid = { status: "PAID", sumupCheckoutId: "checkout-1" };
    const printed = { ...paid, sumupPrintCompletedAt: new Date() };
    const paymentStates: Array<[string, Record<string, unknown>, boolean]> = [
        ["settled and printed", printed, true],
        ["pending checkout", { status: "PENDING", sumupCheckoutId: "checkout-1" }, false],
        ["incomplete print", paid, false],
        ["null print marker", { ...paid, sumupPrintCompletedAt: null }, false],
        ["unresolved recovery", { status: "CANCELLED", sumupRecoveryCancelledAt: new Date() }, false],
        ["storno in progress", { ...printed, stornoMeta: { status: "IN_PROGRESS" } }, false],
        ["failed refund", { ...printed, stornoMeta: { status: "FAILED", refundStatus: "FAILED" } }, false],
        ["refunded with failed stock restore", { ...printed, stornoMeta: { status: "FAILED", refundStatus: "DONE" } }, false]
    ];

    describe.each([
        ["archive", archiveEventAction],
        ["delete", deleteEventAction]
    ] as const)("SumUp guard for event %s", (operation, action) => {
        test.each(paymentStates)("handles %s", async (_state, order, archiveAllowed) => {
            mocks.orderExists.mockImplementation(async (query) => sift(query)({ eventId: "event-4", ...order }));
            const formData = new FormData();
            formData.set("eventId", "event-4");

            const result = await action(formData);

            expect(mocks.orderExists).toHaveBeenCalledTimes(1);
            expect(mocks.orderExists).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-4" }));
            if (operation === "archive" && archiveAllowed) {
                expect(result).toBeUndefined();
                expect(mocks.archiveEvent).toHaveBeenCalledWith(
                    { _id: "event-4", "sumupOperationClaim.token": "event-claim-1" },
                    { $set: { archived: true, active: false }, $unset: { sumupOperationClaim: 1 } }
                );
            } else {
                expect(result).toEqual({ error: operation === "archive"
                    ? "Operazione bloccata: la festa contiene pagamenti, stampe o storni SumUp ancora da completare."
                    : "Operazione bloccata: la festa contiene pagamenti SumUp in attesa o non ancora rimborsati."
                });
                expect(mocks.archiveEvent).not.toHaveBeenCalled();
                expect(mocks.releaseSumUpEventOperation).toHaveBeenCalledWith("event-4", "event-claim-1");
            }
            expect(mocks.deleteEvent).not.toHaveBeenCalled();
            expect(mocks.deleteOrders).not.toHaveBeenCalled();
        });
    });
});
