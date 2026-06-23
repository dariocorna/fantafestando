import mongoose from "mongoose";
import { expect, test } from "@playwright/test";
import {
    configureCashPos,
    createAndActivateEvent,
    createCategoryAndProducts,
    localPrinterIp,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";

async function getProductId(eventName: string, productName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB non disponibile");

    const event = await db.collection("events").findOne({ name: eventName });
    const product = await db.collection("products").findOne({ eventId: event?._id, name: productName });
    if (!product?._id) throw new Error(`Prodotto ${productName} non trovato`);

    return String(product._id);
}

test.describe("POS card quantity controls", () => {
    test("mostra la quantita in card e consente decremento con tasto destro e tastiera", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `POS Card Qty ${suffix}`;
        const printerName = `Cashier ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `Banco ${suffix}`;
        const productName = `Panino ${suffix}`;

        try {
            await createAndActivateEvent(page, eventName);
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName);
            await createCategoryAndProducts(page, categoryName, [
                { name: productName, price: "5.00" },
            ]);
            const productId = await getProductId(eventName, productName);

            await openPosAndSelectDevice(page, posName);

            const productCard = page.getByTestId(`pos-product-${productId}`);
            const productQuantity = page.getByTestId(`pos-product-quantity-${productId}`);

            await productCard.click();
            await expect(productQuantity).toContainText("1");
            await expect(page.getByText("1 x 5.00 €")).toBeVisible();

            await productCard.click();
            await expect(productQuantity).toContainText("2");
            await expect(page.getByText("2 x 5.00 €")).toBeVisible();

            await productCard.click({ button: "right" });
            await expect(productQuantity).toContainText("1");
            await expect(page.getByText("1 x 5.00 €")).toBeVisible();

            await productCard.click({ button: "right" });
            await expect(productQuantity).toHaveCount(0);
            await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible();

            await productCard.focus();
            await page.keyboard.press("Enter");
            await expect(productQuantity).toContainText("1");

            await page.keyboard.press("-");
            await expect(productQuantity).toHaveCount(0);
            await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible();
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
