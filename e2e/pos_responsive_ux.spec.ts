import mongoose from "mongoose";
import { expect, test, type Page } from "@playwright/test";
import {
    configureCashPos,
    createAndActivateEvent,
    createCategoryAndProducts,
    localPrinterIp,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";

async function enableQuickDiscountPreset(eventName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB non disponibile");

    await db.collection("events").updateOne(
        { name: eventName },
        {
            $set: {
                "settings.quickDiscountPresets": [
                    { label: "Promo 20%", type: "PERCENT", value: 20 },
                ],
            },
        },
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
            selectedOptions: [],
        }],
        paymentMethod: "CASH",
        createdAt: new Date(),
        updatedAt: new Date(),
    });
}

async function closeVisibleDialog(page: Page, name: RegExp) {
    await page.getByRole("dialog", { name }).getByRole("button", { name: /Close/i }).click();
}

test.describe("POS responsive UX", () => {
    test("usa layout touch su tablet, stepper carrello, sconto non duplicabile e conferma sostituzione ordine", async ({ page, isMobile }) => {
        test.skip(isMobile, "Viewport tablet verificato dal progetto Chromium con dimensioni custom.");
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `POS UX ${suffix}`;
        const printerName = `Cashier ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `Banco ${suffix}`;
        const draftProductName = `Piadina ${suffix}`;
        const pendingProductName = `Toast ${suffix}`;

        try {
            await page.setViewportSize({ width: 820, height: 1180 });
            await createAndActivateEvent(page, eventName);
            await enableQuickDiscountPreset(eventName);
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName);
            await createCategoryAndProducts(page, categoryName, [
                { name: draftProductName, price: "8.00" },
                { name: pendingProductName, price: "6.50" },
            ]);
            await createPendingOrder(eventName, pendingProductName, 31, "Mario");

            await openPosAndSelectDevice(page, posName);
            await expect(page.getByTestId("pos-mobile-catalog")).toBeVisible({ timeout: 15000 });

            await page.getByRole("button", { name: new RegExp(draftProductName) }).click();
            await page.getByTestId("pos-mobile-cart-bar").click();
            const cartSheet = page.getByTestId("pos-mobile-cart-sheet");
            await expect(cartSheet.getByText(draftProductName)).toBeVisible();

            await cartSheet.getByRole("button", { name: new RegExp(`Aumenta quantità ${draftProductName}`) }).click();
            await expect(cartSheet.getByText("2 x 8.00 €")).toBeVisible();
            await cartSheet.getByRole("button", { name: new RegExp(`Diminuisci quantità ${draftProductName}`) }).click();
            await expect(cartSheet.getByText("1 x 8.00 €")).toBeVisible();
            await closeVisibleDialog(page, /Carrello/i);

            await page.getByRole("button", { name: /Sconti/i }).click();
            const firstDiscountButton = page.getByRole("dialog", { name: /Sconti/i }).getByRole("button", { name: /Promo 20%/i });
            await expect(firstDiscountButton).toBeEnabled();
            await firstDiscountButton.focus();
            await page.keyboard.press("Enter");
            await page.getByRole("button", { name: /Sconti/i }).click();
            const discountDialog = page.getByRole("dialog", { name: /Sconti/i });
            const appliedDiscount = discountDialog.getByRole("button", { name: /Promo 20%/i });
            await expect(appliedDiscount).toBeDisabled();
            await expect(appliedDiscount).toContainText(/Applicato/i);
            await closeVisibleDialog(page, /Sconti/i);

            await page.getByRole("button", { name: /Pendenti/i }).click();
            const pendingSheet = page.getByTestId("pos-mobile-pending-sheet");
            await expect(pendingSheet.getByText("31")).toBeVisible();
            await pendingSheet.getByRole("button", { name: /31/ }).click();
            const confirmDialog = page.getByRole("dialog", { name: /Sostituire il carrello corrente/i });
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.getByRole("button", { name: "ANNULLA", exact: true }).click();
            await closeVisibleDialog(page, /Ordini pendenti/i);

            await page.getByTestId("pos-mobile-cart-bar").click();
            await expect(cartSheet.getByText(draftProductName)).toBeVisible();
            await expect(cartSheet.getByText(pendingProductName)).toHaveCount(0);
            await closeVisibleDialog(page, /Carrello/i);

            await page.getByRole("button", { name: /Pendenti/i }).click();
            await expect(pendingSheet.getByText("31")).toBeVisible();
            await pendingSheet.getByRole("button", { name: /31/ }).click();
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.getByRole("button", { name: "SOSTITUISCI", exact: true }).click();
            await expect(page.getByText(/Ordine caricato: codice 31/i)).toBeVisible({ timeout: 15000 });

            await page.getByTestId("pos-mobile-cart-bar").click();
            await expect(cartSheet.getByText(pendingProductName)).toBeVisible();
            await expect(cartSheet.getByText(draftProductName)).toHaveCount(0);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
