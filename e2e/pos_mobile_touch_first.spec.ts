import mongoose from "mongoose";
import { expect, test, type Page } from "@playwright/test";
import {
    configureCashPos,
    createAndActivateEvent,
    createCategoryAndProducts,
    dismissFeedbackModal,
    localPrinterIp,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";

async function expectNoHorizontalOverflow(page: Page) {
    const metrics = await page.evaluate(() => {
        const html = document.documentElement;
        const body = document.body;

        return {
            htmlScrollWidth: html.scrollWidth,
            htmlClientWidth: html.clientWidth,
            bodyScrollWidth: body?.scrollWidth ?? 0,
            bodyClientWidth: body?.clientWidth ?? 0,
        };
    });

    expect(metrics.htmlScrollWidth).toBeLessThanOrEqual(metrics.htmlClientWidth + 1);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
}

async function enableQuickDiscountPreset(eventName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB non disponibile");

    await db.collection("events").updateOne(
        { name: eventName },
        {
            $set: {
                "settings.quickDiscountPresets": [
                    { label: "Promo 20%", type: "PERCENT", value: 20 }
                ]
            }
        }
    );
}

async function createPendingOrder(eventName: string, productName: string, pickupNumber: number, customerName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB non disponibile");

    const event = await db.collection("events").findOne({ name: eventName });
    const product = await db.collection("products").findOne({ eventId: event?._id, name: productName });
    if (!event?._id || !product?._id) {
        throw new Error("Evento o prodotto non trovato per seed ordine pendente");
    }

    await db.collection("orders").insertOne({
        eventId: event._id,
        pickupNumber,
        status: "PENDING",
        customer: { name: customerName },
        totalAmount: Number(product.basePrice ?? 0),
        discountApplied: 0,
        cart: [{
            productId: product._id,
            snapshotName: product.name,
            quantity: 1,
            productKind: "STANDARD",
            unitBasePrice: Number(product.basePrice ?? 0),
            lineTotal: Number(product.basePrice ?? 0),
            selectedOptions: []
        }],
        paymentMethod: "CASH",
        createdAt: new Date(),
        updatedAt: new Date(),
    });
}

async function getProductId(eventName: string, productName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB non disponibile");

    const event = await db.collection("events").findOne({ name: eventName });
    const product = await db.collection("products").findOne({ eventId: event?._id, name: productName });
    if (!product?._id) throw new Error(`Prodotto ${productName} non trovato`);

    return String(product._id);
}

async function openCashSessionMobile(page: Page, openingFloatAmount = "0") {
    await page.getByRole("button", { name: /Cassa chiusa|Cassa aperta/i }).click();
    await page.getByRole("button", { name: /Apri Cassa/i }).click();
    const openDialog = page.getByRole("dialog").filter({ hasText: /Apertura Cassa/i });
    await expect(openDialog).toBeVisible();
    await openDialog.locator("#opening-float-amount").fill(openingFloatAmount);
    await openDialog.getByRole("button", { name: "APRI CASSA", exact: true }).click();
    await expect(openDialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /Cassa aperta/i })).toBeVisible({ timeout: 15000 });
}

test.describe("POS mobile touch-first", () => {
    test.describe.configure({ mode: "serial" });

    test("usa il POS da smartphone con catalogo, sconti, carrello e checkout senza overflow", async ({ page, isMobile }) => {
        test.skip(!isMobile, "Scenario dedicato al progetto Mobile Chrome.");
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `POS Mobile ${suffix}`;
        const printerName = `Cashier ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `Snack ${suffix}`;
        const burgerName = `Burger ${suffix}`;
        const friesName = `Fries ${suffix}`;

        try {
            await createAndActivateEvent(page, eventName);
            await enableQuickDiscountPreset(eventName);
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName);
            await createCategoryAndProducts(page, categoryName, [
                { name: burgerName, price: "8.00" },
                { name: friesName, price: "4.00" },
            ]);

            await openPosAndSelectDevice(page, posName);
            await expect(page.getByTestId("pos-mobile-catalog")).toBeVisible({ timeout: 15000 });
            await expectNoHorizontalOverflow(page);

            await openCashSessionMobile(page);

            const burgerId = await getProductId(eventName, burgerName);
            const burgerCard = page.getByTestId(`pos-product-${burgerId}`);
            const burgerQuantity = page.getByTestId(`pos-product-quantity-${burgerId}`);
            const burgerDecrement = page.getByTestId(`pos-product-decrement-${burgerId}`);

            await burgerCard.click();
            await expect(burgerQuantity).toContainText(/Nel carrello:\s*1/i);
            await burgerCard.click();
            await expect(burgerQuantity).toContainText(/Nel carrello:\s*2/i);
            await burgerDecrement.click();
            await expect(burgerQuantity).toContainText(/Nel carrello:\s*1/i);

            await page.getByRole("button", { name: new RegExp(friesName) }).click();

            await page.getByRole("button", { name: /Prezzi e sconti/i }).click();
            await expect(page.getByTestId("pos-mobile-discount-presets")).toBeVisible();
            const discountDialog = page.getByRole("dialog", { name: /Prezzi e sconti/i });
            const volunteerPricing = discountDialog.getByLabel("Modalità volontari");
            await expect(volunteerPricing).toBeVisible();
            await volunteerPricing.check();
            await page.keyboard.press("Escape");
            await expect(page.getByRole("button", { name: /Prezzi volontari attivi/i })).toBeVisible();
            await page.getByRole("button", { name: /Prezzi volontari attivi/i }).click();
            await discountDialog.getByLabel("Modalità volontari").uncheck();
            const discountPreset = discountDialog.getByRole("button", { name: /Promo 20%/i });
            await discountPreset.focus();
            await page.keyboard.press("Enter");

            await page.getByTestId("pos-mobile-cart-bar").click();
            const cartSheetDialog = page.getByRole("dialog", { name: /Carrello/i });
            const cartSheet = page.getByTestId("pos-mobile-cart-sheet");
            await expect(cartSheetDialog).toBeVisible();
            await expect(cartSheet).toBeVisible();
            await expect(cartSheet.getByText(burgerName)).toBeVisible();
            await expect(cartSheet.getByText(friesName)).toBeVisible();
            await expect(cartSheet.getByText(/Sconto Promo 20%/i)).toBeVisible();
            await expect(cartSheetDialog.getByLabel("Modalità volontari")).toHaveCount(0);

            await cartSheetDialog.getByRole("button", { name: "PAGA ORA", exact: true }).click();
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
            await expect(checkoutDialog).toBeVisible();
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click();
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 });
            await dismissFeedbackModal(page);

            await expect(page.getByTestId("pos-mobile-cart-bar")).toContainText(/Carrello vuoto/i);
            await expectNoHorizontalOverflow(page);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });

    test("carica ordini pendenti da sheet pendenti e da codice su viewport mobile", async ({ page, isMobile }) => {
        test.skip(!isMobile, "Scenario dedicato al progetto Mobile Chrome.");
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `POS Mobile Pending ${suffix}`;
        const printerName = `Cashier ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `Panini ${suffix}`;
        const productName = `Toast ${suffix}`;

        try {
            await createAndActivateEvent(page, eventName);
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName);
            await createCategoryAndProducts(page, categoryName, [
                { name: productName, price: "6.50" },
            ]);

            await createPendingOrder(eventName, productName, 21, "Mario");
            await createPendingOrder(eventName, productName, 22, "Luigi");

            await openPosAndSelectDevice(page, posName);

            await page.getByRole("button", { name: /Pendenti/i }).click();
            const pendingSheet = page.getByTestId("pos-mobile-pending-sheet");
            await expect(pendingSheet).toBeVisible();
            await expect(pendingSheet.getByText("21", { exact: true })).toBeVisible();
            await pendingSheet.getByRole("button", { name: /^Ordine 21\b/ }).click();
            await expect(page.getByText(/Ordine caricato: codice 21/i)).toBeVisible({ timeout: 15000 });

            await page.getByTestId("pos-mobile-cart-bar").click();
            const cartSheet = page.getByTestId("pos-mobile-cart-sheet");
            await expect(cartSheet.getByText(productName)).toBeVisible();
            await cartSheet.getByTitle("Rimuovi ordine caricato").click();
            await page.getByRole("dialog", { name: /Carrello/i }).getByRole("button", { name: /Close/i }).click();

            await page.getByRole("button", { name: /Codice/i }).click();
            await page.locator("#order-code").fill("22");
            await page.getByRole("button", { name: "Carica", exact: true }).click();
            const replaceCartDialog = page.getByRole("dialog", { name: /Sostituire il carrello corrente/i });
            await expect(replaceCartDialog).toBeVisible();
            await replaceCartDialog.getByRole("button", { name: "SOSTITUISCI", exact: true }).click();
            await expect(page.getByText(/Ordine caricato: codice 22/i)).toBeVisible({ timeout: 15000 });
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
