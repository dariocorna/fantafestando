import { beforeEach, describe, expect, test, vi } from "vitest";

const models = vi.hoisted(() => {
    const collection = () => ({ find: vi.fn(), create: vi.fn(), deleteMany: vi.fn() });
    return {
        event: { findById: vi.fn(), create: vi.fn(), findByIdAndDelete: vi.fn() },
        printer: collection(), peripheral: collection(), pos: collection(),
        category: collection(), ingredient: collection(), product: collection(),
        history: { deleteMany: vi.fn() }
    };
});

vi.mock("../action-context", () => ({ requireAdminAuthorization: async () => null }));
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/models/Event", () => ({ default: models.event }));
vi.mock("@/models/Category", () => ({ default: models.category }));
vi.mock("@/models/Product", () => ({ default: models.product }));
vi.mock("@/models/Ingredient", () => ({ default: models.ingredient }));
vi.mock("@/models/Printer", () => ({ default: models.printer }));
vi.mock("@/models/Peripheral", () => ({ default: models.peripheral }));
vi.mock("@/models/PosDevice", () => ({ default: models.pos }));
vi.mock("@/models/PrintJob", () => ({ default: models.history }));
vi.mock("@/models/CashSession", () => ({ default: models.history }));
vi.mock("@/models/Order", () => ({ default: models.history }));
vi.mock("@/models/OrderCounter", () => ({ default: models.history }));

import { cloneEventAction } from "./actions";

function clone() {
    const data = new FormData();
    data.set("sourceEventId", "source");
    data.set("newName", "Clone");
    return cloneEventAction(data);
}

const legacyProduct = { _id: "old-product", categoryId: "old-category", name: "Bibita", basePrice: 2 };

describe("clone event catalog", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        for (const model of [models.printer, models.peripheral, models.pos, models.product, models.ingredient]) {
            model.find.mockReturnValue({ lean: async () => [] });
        }
        models.event.findById.mockReturnValue({ lean: async () => ({ _id: "source" }) });
        models.category.find.mockReturnValue({ lean: async () => [{ _id: "old-category", name: "Bar" }] });
        models.category.create.mockResolvedValue({ _id: "new-category" });
    });

    test("uses legacy defaults, derives sold out from tracked stock and resets untracked sold out", async () => {
        models.product.find.mockReturnValue({ lean: async () => [
            { ...legacyProduct, isSoldOut: true },
            { ...legacyProduct, _id: "tracked", stockQuantity: 0 }
        ] });
        await expect(clone()).resolves.toEqual({ success: true });
        expect(models.product.create.mock.calls[0][0]).toMatchObject({
            categoryId: "new-category", kind: "STANDARD", salesChannels: ["POS", "MENU"],
            volunteerPrice: null, isSoldOut: false, stockQuantity: null, availableOnlyInMenus: false,
            splitKitchenPrintPerUnit: false, variants: [], recipeItems: [], menuComponents: [], menuChoiceGroups: []
        });
        expect(models.product.create.mock.calls[1][0]).toMatchObject({ isSoldOut: true, stockQuantity: 0 });
    });

    test("resolves a forward product reference even when the menu is copied first", async () => {
        const component = { productId: legacyProduct._id, quantity: 2 };
        models.product.find.mockReturnValue({ lean: async () => [
            { ...legacyProduct, _id: "menu", kind: "FIXED_MENU", menuComponents: [component] },
            legacyProduct
        ] });
        await expect(clone()).resolves.toEqual({ success: true });
        const [menu, item] = models.product.create.mock.calls.map(([document]) => document);
        expect(menu.menuComponents).toEqual([{ productId: item._id, quantity: 2 }]);
        expect(String(item._id)).not.toBe(legacyProduct._id);
    });

    test.each([
        ["categoria", { categoryId: "foreign" }],
        ["ingrediente", { recipeItems: [{ ingredientId: "foreign", quantity: 1 }] }],
        ["componente", { menuComponents: [{ productId: "foreign", quantity: 1 }] }],
        ["opzione", { menuChoiceGroups: [{ options: [{ productId: null, quantity: 1 }] }] }]
    ])("rejects an unresolved %s and removes only the incomplete clone", async (reference, fields) => {
        models.product.find.mockReturnValue({ lean: async () => [{ ...legacyProduct, ...fields }] });
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect(await clone()).toEqual({ error: expect.stringContaining(`${reference} mancante`) });
        } finally {
            errorLog.mockRestore();
        }
        const eventId = String(models.category.create.mock.calls[0][0].eventId);
        expect(eventId).not.toBe("source");
        expect(models.category.deleteMany).toHaveBeenCalledWith({ eventId });
        expect(models.event.create).not.toHaveBeenCalled();
    });
});
