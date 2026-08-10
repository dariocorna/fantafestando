import mongoose from "mongoose";
import { expect, test } from "@playwright/test";
import {
    configureCashPos,
    createAndActivateEvent,
    dismissFeedbackModal,
    localPrinterIp,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";

async function getLatestPaidOrder(eventName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB non disponibile");

    const event = await db.collection("events").findOne({ name: eventName });
    if (!event?._id) throw new Error(`Evento ${eventName} non trovato`);

    return db.collection("orders").findOne(
        { eventId: event._id, status: "PAID" },
        { sort: { createdAt: -1 } },
    );
}

async function createPendingVolunteerOrder(eventName: string, productName: string, pickupNumber: number) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB non disponibile");

    const event = await db.collection("events").findOne({ name: eventName });
    const product = await db.collection("products").findOne({ eventId: event?._id, name: productName });
    if (!event?._id || !product?._id) throw new Error("Evento o prodotto non trovato");

    await db.collection("orders").insertOne({
        eventId: event._id,
        pickupNumber,
        status: "PENDING",
        customer: { name: "Mario" },
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

async function createProductWithOptionalVolunteerPrice(
    page: import("@playwright/test").Page,
    categoryName: string,
    productName: string,
    price: string,
    volunteerPrice?: string,
) {
    await page.goto("/admin/catalog");
    await page.click("#new-product-btn");
    const dialog = page.getByRole("dialog", { name: /Aggiungi Prodotto/i });
    await dialog.locator("#prod-name").fill(productName);
    await dialog.locator('input[name="basePrice"]').fill(price);
    if (volunteerPrice) {
        await dialog.locator('input[name="volunteerPrice"]').fill(volunteerPrice);
    }
    await dialog.locator('select[name="categoryId"]').selectOption({ label: categoryName });
    await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
    await expect(page.getByText(productName)).toBeVisible();
}

test.describe("POS volunteer pricing", () => {
    test("applica prezzi volontari da catalogo e salva audit sulla riga ordine", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop Chromium.");
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `POS Volontari ${suffix}`;
        const categoryName = `Banco ${suffix}`;
        const volunteerProductName = `Pasta ${suffix}`;
        const standardProductName = `Acqua ${suffix}`;
        const printerName = `Cashier ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;

        try {
            await createAndActivateEvent(page, eventName);
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName);

            await page.goto("/admin/catalog");
            await page.click("#new-category-btn");
            await page.fill("#cat-name", categoryName);
            await page.getByRole("button", { name: "Salva Categoria", exact: true }).click();
            await expect(page.getByRole("row").filter({ hasText: categoryName }).first()).toBeVisible();

            await createProductWithOptionalVolunteerPrice(page, categoryName, volunteerProductName, "10.00", "7.00");
            await createProductWithOptionalVolunteerPrice(page, categoryName, standardProductName, "5.00");
            await expect(page.getByText(/10\.00 € \/ Vol\. 7\.00 €/)).toBeVisible();

            await openPosAndSelectDevice(page, posName);
            await openCashSessionIfRequired(page);

            const volunteerProductButton = page.getByRole("button", { name: new RegExp(volunteerProductName) }).first();
            await volunteerProductButton.click();
            await volunteerProductButton.click();
            await page.getByRole("button", { name: new RegExp(standardProductName) }).click();
            await expect(page.getByText(/25\.00 €/).first()).toBeVisible();

            const pricingPanel = page.getByTestId("pos-discount-presets");
            await expect(pricingPanel.getByText("Prezzi e sconti", { exact: true })).toBeVisible();
            await expect(pricingPanel.getByLabel("Modalità volontari")).toBeVisible();
            await expect(page.getByTestId("pos-pay-cta").locator("..").getByLabel("Modalità volontari")).toHaveCount(0);
            await page.getByLabel("Modalità volontari").check();
            await expect(page.getByText(/19\.00 €/).first()).toBeVisible();
            await expect(page.getByText(/Prezzi volontari:\s*-6\.00 €/)).toBeVisible();

            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
            await expect(checkoutDialog).toBeVisible();
            await expect(checkoutDialog).toContainText("19.00 €");
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click();
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 });
            await dismissFeedbackModal(page);

            const order = await getLatestPaidOrder(eventName);
            expect(order?.totalAmount).toBe(19);
            expect(order?.discountApplied).toBe(6);
            const volunteerLine = order?.cart.find((item: { snapshotName?: string }) => item.snapshotName === volunteerProductName);
            expect(volunteerLine?.unitBasePrice).toBe(10);
            expect(volunteerLine?.lineTotal).toBe(14);
            expect(volunteerLine?.discountApplied).toBe(6);
            expect(volunteerLine?.discountMeta).toMatchObject({
                type: "FIXED",
                value: 3,
                label: "Volontari",
                baseUnitAmount: 10,
            });
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });

    test("ricalcola un ordine web pendente quando si attiva la modalita volontari", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop Chromium.");
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `POS Vol Pending ${suffix}`;
        const categoryName = `Banco ${suffix}`;
        const productName = `Lasagna ${suffix}`;
        const printerName = `Cashier ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;

        try {
            await createAndActivateEvent(page, eventName);
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName);

            await page.goto("/admin/catalog");
            await page.click("#new-category-btn");
            await page.fill("#cat-name", categoryName);
            await page.getByRole("button", { name: "Salva Categoria", exact: true }).click();
            await expect(page.getByRole("row").filter({ hasText: categoryName }).first()).toBeVisible();
            await createProductWithOptionalVolunteerPrice(page, categoryName, productName, "10.00", "7.00");
            await createPendingVolunteerOrder(eventName, productName, 41);

            await openPosAndSelectDevice(page, posName);
            await openCashSessionIfRequired(page);

            await page.getByRole("button", { name: /Carica ordine da codice/i }).click();
            const loadDialog = page.getByRole("dialog").filter({ hasText: /Carica ordine da codice/i });
            await loadDialog.getByRole("textbox").fill("41");
            await loadDialog.getByRole("button", { name: /Carica/i, exact: true }).click();
            await expect(page.getByText(/^Codice 41$/i)).toBeVisible();
            await expect(page.getByText(/10\.00 €/).first()).toBeVisible();

            await page.getByLabel("Modalità volontari").check();
            await expect(page.getByText(/7\.00 €/).first()).toBeVisible();

            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
            await expect(checkoutDialog).toContainText("7.00 €");
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click();
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 });
            await dismissFeedbackModal(page);

            const order = await getLatestPaidOrder(eventName);
            expect(order?.pickupNumber).toBe(41);
            expect(order?.totalAmount).toBe(7);
            expect(order?.discountApplied).toBe(3);
            expect(order?.cart[0]?.discountMeta).toMatchObject({ label: "Volontari" });
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
