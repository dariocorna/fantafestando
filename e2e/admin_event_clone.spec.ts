import { expect, test } from "@playwright/test";
import Category from "../src/models/Category";
import Event from "../src/models/Event";
import Ingredient from "../src/models/Ingredient";
import Product from "../src/models/Product";
import { ensureAdminAuthenticated } from "./utils/auth";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";
import { uniqueSuffix } from "./utils/fixtures";

test("clona il catalogo con ricette, opzioni e vincoli di vendita della festa", async ({ page }) => {
    const token = uniqueSuffix();
    const sourceName = `E2E festa sorgente ${token}`;
    const cloneName = `E2E festa clonata ${token}`;
    await ensureDbConnection();
    try {
        const source = await Event.create({ name: sourceName });
        const category = await Category.create({
            eventId: source._id, name: "Cucina", uiColor: "#223344", printOrder: 4,
            printKitchenCopyAtCashier: true, pizzaFlowEnabled: true, pizzaBarcodeEnabled: true
        });
        const ingredient = await Ingredient.create({ eventId: source._id, name: "Patate", stockQuantity: 16 });
        const item = await Product.create({
            eventId: source._id, categoryId: category._id, name: "Contorno", basePrice: 4,
            volunteerPrice: 3, salesChannels: ["POS"], availableOnlyInMenus: true, splitKitchenPrintPerUnit: true,
            stockQuantity: 8, recipeItems: [{ ingredientId: ingredient._id, quantity: 2 }]
        });
        const option = await Product.create({
            eventId: source._id, categoryId: category._id, name: "Bibita", basePrice: 2, salesChannels: ["POS"]
        });
        const menu = await Product.create({
            eventId: source._id, categoryId: category._id, name: "Menu festa", basePrice: 8, kind: "FIXED_MENU",
            menuComponents: [{ productId: item._id, quantity: 2 }],
            menuChoiceGroups: [{ id: "bere", name: "Bevanda", minSelections: 1, maxSelections: 1,
                options: [{ productId: option._id, quantity: 1 }] }]
        });

        await ensureAdminAuthenticated(page, "/admin/settings/events");
        const row = page.locator("div.p-4.border").filter({ has: page.getByRole("heading", { name: sourceName, exact: true }) });
        await row.getByRole("button", { name: "Clona", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Nome Nuova Festa").fill(cloneName);
        await dialog.getByRole("button", { name: "Clona Festa", exact: true }).click();
        await expect(page.getByRole("heading", { name: cloneName, exact: true })).toBeVisible();

        const copy = await Event.findOne({ name: cloneName }).orFail();
        const scope = { eventId: copy._id };
        const [copiedCategory, copiedIngredient, copiedItem, copiedOption, copiedMenu] = await Promise.all([
            Category.findOne({ ...scope, name: category.name }).orFail(),
            Ingredient.findOne({ ...scope, name: ingredient.name }).orFail(),
            Product.findOne({ ...scope, name: item.name }).orFail(),
            Product.findOne({ ...scope, name: option.name }).orFail(),
            Product.findOne({ ...scope, name: menu.name }).orFail()
        ]);
        expect(copy.active).toBe(false);
        expect(String(copiedCategory._id)).not.toBe(String(category._id));
        expect(String(copiedIngredient._id)).not.toBe(String(ingredient._id));
        expect(String(copiedItem._id)).not.toBe(String(item._id));
        expect(String(copiedOption._id)).not.toBe(String(option._id));
        expect(copiedCategory.toObject()).toMatchObject({
            printOrder: 4, printKitchenCopyAtCashier: true, pizzaFlowEnabled: true, pizzaBarcodeEnabled: true
        });
        expect(copiedIngredient.stockQuantity).toBe(16);
        expect(copiedItem.toObject()).toMatchObject({
            volunteerPrice: 3, salesChannels: ["POS"], availableOnlyInMenus: true,
            splitKitchenPrintPerUnit: true, stockQuantity: 8,
            recipeItems: [{ ingredientId: copiedIngredient._id, quantity: 2 }]
        });
        expect(copiedMenu.toObject()).toMatchObject({
            kind: "FIXED_MENU", categoryId: copiedCategory._id,
            menuComponents: [{ productId: copiedItem._id, quantity: 2 }],
            menuChoiceGroups: [{ id: "bere", name: "Bevanda", minSelections: 1, maxSelections: 1,
                options: [{ productId: copiedOption._id, quantity: 1 }] }]
        });
    } finally {
        await Promise.all([sourceName, cloneName].map(cleanupEventArtifactsByName));
    }
});
