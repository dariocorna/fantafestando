import { expect, test, type Page } from "@playwright/test";
import Category from "@/models/Category";
import Ingredient from "@/models/Ingredient";
import Peripheral from "@/models/Peripheral";
import PosDevice from "@/models/PosDevice";
import Printer from "@/models/Printer";
import Product from "@/models/Product";
import {
    createActiveEventDirect,
    deleteEvent,
    dismissFeedbackModal,
    localPrinterIp,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    setAdminEventContextCookie,
    uniqueSuffix,
} from "./utils/fixtures";

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

        const { eventId } = await createActiveEventDirect(eventName);
        createdEvents.push(eventName);
        await setAdminEventContextCookie(page, eventId);

        const [printer, cashBox, category, potatoes, fish] = await Promise.all([
            Printer.create({
                eventId,
                name: printerName,
                ip: localPrinterIp(),
                port: 19100,
                isVirtual: false,
                type: "CASHIER",
            }),
            Peripheral.create({
                eventId,
                name: cashBoxName,
                type: "CASH_BOX",
                config: {},
            }),
            Category.create({
                eventId,
                name: categoryName,
                uiColor: "#2563eb",
                printOrder: 0,
            }),
            Ingredient.create({ eventId, name: ingredientPotatoes, stockQuantity: 5 }),
            Ingredient.create({ eventId, name: ingredientFish, stockQuantity: 2 }),
        ]);

        await Promise.all([
            PosDevice.create({
                eventId,
                name: posName,
                printerId: printer._id,
                cashBoxId: cashBox._id,
            }),
            Product.insertMany([
                {
                    eventId,
                    categoryId: category._id,
                    name: fishProduct,
                    basePrice: 8,
                    recipeItems: [
                        { ingredientId: fish._id, quantity: 1 },
                        { ingredientId: potatoes._id, quantity: 1 },
                    ],
                },
                {
                    eventId,
                    categoryId: category._id,
                    name: sideProduct,
                    basePrice: 3,
                    recipeItems: [{ ingredientId: potatoes._id, quantity: 2 }],
                },
                {
                    eventId,
                    categoryId: category._id,
                    name: legacyProduct,
                    basePrice: 2,
                },
            ]),
        ]);

        const firstOrderCode = await createWebOrderAndGetCode(page, [
            { name: fishProduct, quantity: 1 },
            { name: legacyProduct, quantity: 1 },
        ]);
        await createWebOrderAndGetCode(page, [
            { name: sideProduct, quantity: 1 },
        ]);

        await openPosAndSelectDevice(page, posName);
        await openCashSessionIfRequired(page);

        await page.getByRole("button", { name: "Codice", exact: true }).click();
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

        await page.getByRole("button", { name: "Codice", exact: true }).click();
        await expect(pendingDialog).toBeVisible();
        await expect(pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: ingredientFish })).toHaveCount(0);
        await expect(pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: legacyProduct })).toHaveCount(0);
        await expect(pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: ingredientPotatoes }).first()).toContainText("2");
        await expect(pendingDialog.locator('[data-testid^="pending-ingredient-card-"]').filter({ hasText: ingredientPotatoes }).first()).toContainText("Residuo stimato: 2");

        await expect(pendingDialog.getByText(ingredientPotatoes)).toBeVisible();
    });
});
