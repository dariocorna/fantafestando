import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    dbConnect: vi.fn(),
    revalidatePath: vi.fn(),
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
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/models/PrintJob", () => ({ default: { deleteMany: mocks.deletePrintJobs } }));
vi.mock("@/models/CashSession", () => ({ default: { deleteMany: mocks.deleteCashSessions } }));
vi.mock("@/models/Order", () => ({ default: { deleteMany: mocks.deleteOrders } }));
vi.mock("@/models/OrderCounter", () => ({ default: { deleteMany: mocks.deleteOrderCounters } }));
vi.mock("@/models/PosDevice", () => ({ default: { deleteMany: mocks.deletePosDevices } }));
vi.mock("@/models/Peripheral", () => ({ default: { deleteMany: mocks.deletePeripherals } }));
vi.mock("@/models/Printer", () => ({ default: { deleteMany: mocks.deletePrinters } }));
vi.mock("@/models/Product", () => ({ default: { deleteMany: mocks.deleteProducts } }));
vi.mock("@/models/Ingredient", () => ({ default: { deleteMany: mocks.deleteIngredients } }));
vi.mock("@/models/Category", () => ({ default: { deleteMany: mocks.deleteCategories } }));
vi.mock("@/models/Event", () => ({
    default: {
        findByIdAndDelete: mocks.deleteEvent,
        findByIdAndUpdate: mocks.archiveEvent,
    }
}));

import { archiveEventAction, deleteEventAction } from "./actions";

describe("event lifecycle actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockResolvedValue(null);
        mocks.dbConnect.mockResolvedValue(undefined);
    });

    test("preserves the complete event deletion cascade", async () => {
        const formData = new FormData();
        formData.set("eventId", "event-1");

        await deleteEventAction(formData);

        const scope = { eventId: "event-1" };
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
        expect(mocks.deleteEvent).toHaveBeenCalledWith("event-1");
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings/events");
    });

    test("archives and deactivates the selected event", async () => {
        const formData = new FormData();
        formData.set("eventId", "event-2");

        await archiveEventAction(formData);

        expect(mocks.archiveEvent).toHaveBeenCalledWith("event-2", {
            archived: true,
            active: false
        });
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
});
