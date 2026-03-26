import { expect, test, type Page } from "@playwright/test";
import {
    configureCashPos,
    createAndActivateEvent,
    createCategory,
    deleteEvent,
    dismissFeedbackModal,
    localPrinterIp,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";

async function createIngredient(page: Page, ingredient: {
    name: string;
    shortName?: string;
    stockQuantity?: string;
    active?: boolean;
}) {
    await page.goto("/admin/catalog");
    await page.click("#new-ingredient-btn");
    const dialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Ingrediente/i }).first();
    await expect(dialog).toBeVisible();
    await dialog.locator("#ingredient-name").fill(ingredient.name);
    if (ingredient.shortName) {
        await dialog.locator("#ingredient-short-name").fill(ingredient.shortName);
    }
    if (ingredient.stockQuantity) {
        await dialog.locator("#ingredient-stock-quantity").fill(ingredient.stockQuantity);
    }
    if (ingredient.active === false) {
        await dialog.getByLabel("Ingrediente attivo").uncheck();
    }
    await dialog.getByRole("button", { name: "Salva Ingrediente", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(ingredient.name)).toBeVisible();
}

async function createProductWithRecipe(page: Page, input: {
    categoryName: string;
    name: string;
    price: string;
    recipe?: Array<{ ingredientName: string; quantity: number }>;
}) {
    await page.goto("/admin/catalog");
    await page.click("#new-product-btn");
    const dialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Prodotto/i }).first();
    await expect(dialog).toBeVisible();

    await dialog.locator("#prod-name").fill(input.name);
    await dialog.locator('select[name="categoryId"]').selectOption({ label: input.categoryName });
    await dialog.getByLabel("Prezzo Base (€)").fill(input.price);

    for (const [index, recipeItem] of (input.recipe || []).entries()) {
        await dialog.getByRole("button", { name: "Aggiungi ingrediente", exact: true }).click();
        await dialog.locator(`[aria-label="Ingrediente ricetta ${index + 1}"]`).selectOption({ label: recipeItem.ingredientName });
        await dialog.locator(`[aria-label="Quantità ingrediente ricetta ${index + 1}"]`).fill(String(recipeItem.quantity));
    }

    await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(input.name)).toBeVisible();
}

async function createWebOrderAndGetCode(
    page: Page,
    items: Array<{ name: string; quantity: number }>,
) {
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("menu-brand-shell")).toBeVisible({ timeout: 20000 });

    const setupResult = await page.evaluate(async (orderItems: Array<{ name: string; quantity: number }>) => {
        const response = await fetch("/api/pos/init?channel=menu");
        const data = await response.json();
        type MenuProductPayload = {
            _id: string;
            name: string;
            basePrice: number;
            categoryId?: string;
            kind?: string;
        };

        const productsByName = new Map<string, MenuProductPayload>(
            (data.products || []).map((product: MenuProductPayload) => [
                product.name,
                product
            ])
        );

        const normalizedItems = orderItems.map((entry) => {
            const product = productsByName.get(entry.name);
            if (!product) {
                throw new Error(`Missing product ${entry.name}`);
            }

            return {
                lineId: product._id,
                _id: product._id,
                name: product.name,
                basePrice: product.basePrice,
                quantity: entry.quantity,
                categoryId: product.categoryId,
                kind: product.kind || "STANDARD",
            };
        });

        if (!data.event?._id) {
            return { success: false };
        }

        localStorage.setItem("osg_eventId", data.event._id);
        localStorage.setItem("osg_cart", JSON.stringify({
            eventId: data.event._id,
            items: normalizedItems,
        }));
        return { success: true };
    }, items);

    expect(setupResult.success).toBeTruthy();

    await page.reload();
    await page.getByRole("button", { name: /Vedi Carrello/i }).click();
    await expect(page.getByRole("button", { name: /INVIA ORDINE/i })).toBeVisible();
    await page.getByRole("button", { name: /INVIA ORDINE/i }).click();

    await expect(page).toHaveURL(/\/menu\/success\?code=/, { timeout: 20000 });
    const code = new URL(page.url()).searchParams.get("code");
    expect(code).toBeTruthy();
    return code as string;
}

test.describe.serial("POS - ingredienti in coda", () => {
    const createdEvents: string[] = [];

    test.afterEach(async ({ page }) => {
        const eventName = createdEvents.pop();
        if (!eventName) return;
        await deleteEvent(page, eventName);
    });

    test("mostra la coda ingredienti aggregata e aggiorna il pannello dopo la chiusura di un ordine pendente", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");
        test.setTimeout(120000);

        const suffix = uniqueSuffix();
        const eventName = `Ingredient Queue ${suffix}`;
        const printerName = `Cashier ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `Cucina ${suffix}`;
        const ingredientPotatoes = `Patatine ${suffix}`;
        const ingredientFish = `Pesce ${suffix}`;
        const fishProduct = `Fritto ${suffix}`;
        const sideProduct = `Contorno ${suffix}`;
        const legacyProduct = `Bibita ${suffix}`;

        await createAndActivateEvent(page, eventName);
        createdEvents.push(eventName);
        await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName);
        await createCategory(page, categoryName);
        await createIngredient(page, { name: ingredientPotatoes, stockQuantity: "5" });
        await createIngredient(page, { name: ingredientFish, stockQuantity: "2" });
        await createProductWithRecipe(page, {
            categoryName,
            name: fishProduct,
            price: "8.00",
            recipe: [
                { ingredientName: ingredientFish, quantity: 1 },
                { ingredientName: ingredientPotatoes, quantity: 1 },
            ]
        });
        await createProductWithRecipe(page, {
            categoryName,
            name: sideProduct,
            price: "3.00",
            recipe: [
                { ingredientName: ingredientPotatoes, quantity: 2 },
            ]
        });
        await createProductWithRecipe(page, {
            categoryName,
            name: legacyProduct,
            price: "2.00",
        });

        const firstOrderCode = await createWebOrderAndGetCode(page, [
            { name: fishProduct, quantity: 1 },
            { name: legacyProduct, quantity: 1 },
        ]);
        await createWebOrderAndGetCode(page, [
            { name: sideProduct, quantity: 1 },
        ]);

        await openPosAndSelectDevice(page, posName);
        await openCashSessionIfRequired(page);

        await page.getByRole("button", { name: /Carica ordine da codice/i }).click();
        const pendingDialog = page.getByRole("dialog").filter({ hasText: /Carica ordine da codice/i }).first();
        await expect(pendingDialog).toBeVisible();
        await expect(pendingDialog.getByText(/Ingredienti in coda/i)).toBeVisible();

        const potatoesCard = pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: ingredientPotatoes }).first();
        const fishCard = pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: ingredientFish }).first();
        const legacyCard = pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: legacyProduct }).first();
        await expect(potatoesCard).toContainText("3");
        await expect(potatoesCard).toContainText("Residuo stimato: 2");
        await expect(fishCard).toContainText("1");
        await expect(fishCard).toContainText("Residuo stimato: 1");
        await expect(legacyCard).toContainText("Legacy");
        await expect(legacyCard).toContainText("Scorta non tracciata");
        await expect(legacyCard).toContainText("1");

        await pendingDialog.getByRole("textbox").fill(firstOrderCode);
        await pendingDialog.getByRole("button", { name: "Carica", exact: true }).click();

        await expect(page.getByText(new RegExp(`^Codice ${firstOrderCode}$`, "i"))).toBeVisible({ timeout: 15000 });
        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();

        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i }).first();
        await expect(checkoutDialog).toBeVisible();
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click();
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 });
        await dismissFeedbackModal(page);

        await page.getByRole("button", { name: /Carica ordine da codice/i }).click();
        await expect(pendingDialog).toBeVisible();
        await expect(pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: ingredientFish })).toHaveCount(0);
        await expect(pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: legacyProduct })).toHaveCount(0);
        await expect(pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: ingredientPotatoes }).first()).toContainText("2");
        await expect(pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: ingredientPotatoes }).first()).toContainText("Residuo stimato: 3");

        await expect(pendingDialog.getByText(ingredientPotatoes)).toBeVisible();
    });
});
