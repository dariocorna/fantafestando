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
    test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

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
            const productQuantity = page.getByTestId(`pos-product-decrement-${productId}`);
            const initialCardHeight = (await productCard.boundingBox())?.height;

            await productCard.click();
            await expect(productQuantity.locator("span").last()).toHaveText("1");
            await expect(page.getByText("1 x 5.00 €")).toBeVisible();
            const unitPrice = page.locator('[data-testid^="cart-item-unit-price-"]').first();
            const lineTotal = page.locator('[data-testid^="cart-item-total-"]').first();
            const cartQuantity = page.locator('[data-testid^="cart-item-quantity-"]').first();
            expect(await unitPrice.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
            expect(await lineTotal.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18);
            expect(await cartQuantity.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18);

            for (let quantity = 2; quantity <= 10; quantity += 1) await productCard.click();
            await expect(productQuantity.locator("span").last()).toHaveText("10");
            await expect(page.getByText("10 x 5.00 €")).toBeVisible();
            const badgeBox = await productQuantity.boundingBox();
            expect(badgeBox).not.toBeNull();
            expect(badgeBox!.width).toBeGreaterThan(badgeBox!.height);
            expect(await productQuantity.locator("span").last().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18);
            expect((await productCard.boundingBox())?.height).toBe(initialCardHeight);

            for (let quantity = 11; quantity <= 100; quantity += 1) await productCard.click();
            await expect(productQuantity.locator("span").last()).toHaveText("100");
            expect(await productQuantity.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            expect((await productCard.boundingBox())?.height).toBe(initialCardHeight);
            const cartItemBox = await page.locator('[data-testid^="cart-item-row-"]').first().boundingBox();
            const lineTotalBox = await lineTotal.boundingBox();
            const increaseButtonBox = await page.getByRole("button", { name: new RegExp(`Aumenta quantità ${productName}`) }).boundingBox();
            expect(cartItemBox).not.toBeNull();
            expect(lineTotalBox).not.toBeNull();
            expect(increaseButtonBox).not.toBeNull();
            expect(lineTotalBox!.x).toBeGreaterThanOrEqual(cartItemBox!.x);
            expect(increaseButtonBox!.x + increaseButtonBox!.width).toBeLessThanOrEqual(cartItemBox!.x + cartItemBox!.width);

            await productCard.click({ button: "right" });
            await expect(productQuantity.locator("span").last()).toHaveText("99");
            await expect(page.getByText("99 x 5.00 €")).toBeVisible();

            await productCard.focus();
            for (let quantity = 98; quantity >= 0; quantity -= 1) await page.keyboard.press("-");
            await expect(productQuantity).toHaveCount(0);
            await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible();

            await page.keyboard.press("Enter");
            await expect(productQuantity.locator("span").last()).toHaveText("1");
            await page.keyboard.press("-");
            await expect(productQuantity).toHaveCount(0);
            await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible();
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
