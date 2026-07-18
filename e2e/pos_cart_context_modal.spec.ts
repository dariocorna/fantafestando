import mongoose from "mongoose";
import { expect, test } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    setAdminEventContextCookie,
    uniqueSuffix,
} from "./utils/fixtures";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";

async function seedContextModalEvent(eventName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB non disponibile");

    await db.collection("events").updateMany({ active: true }, { $set: { active: false } });
    const eventId = new mongoose.Types.ObjectId();
    const categoryId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();
    const cipollaId = new mongoose.Types.ObjectId();
    const pastaId = new mongoose.Types.ObjectId();
    const saleId = new mongoose.Types.ObjectId();
    const printerId = new mongoose.Types.ObjectId();
    const cashBoxId = new mongoose.Types.ObjectId();
    const posDeviceId = new mongoose.Types.ObjectId();

    await db.collection("events").insertOne({
        _id: eventId,
        name: eventName,
        active: true,
        archived: false,
        settings: { askName: false, askTable: false },
        predefinedTables: [],
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    await db.collection("ingredients").insertMany([
        { _id: cipollaId, eventId, name: "Cipolla", shortName: "CIPOLLA", active: true },
        { _id: pastaId, eventId, name: "Pasta", shortName: "PASTA", active: true },
        { _id: saleId, eventId, name: "Sale", shortName: "SALE", active: true },
    ]);
    await db.collection("categories").insertOne({
        _id: categoryId,
        eventId,
        name: "Cucina",
        uiColor: "#2563eb",
        printOrder: 0,
    });
    await db.collection("products").insertOne({
        _id: productId,
        eventId,
        categoryId,
        name: "Bardelle",
        shortName: "Bardelle",
        basePrice: 8,
        kind: "STANDARD",
        availableOnlyInMenus: false,
        salesChannels: ["POS", "MENU"],
        splitKitchenPrintPerUnit: false,
        isSoldOut: false,
        stockQuantity: null,
        availableDays: [],
        recipeItems: [
            { ingredientId: cipollaId, quantity: 1 },
            { ingredientId: pastaId, quantity: 1 },
        ],
        menuComponents: [],
        menuChoiceGroups: [],
        variants: [],
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    await db.collection("printers").insertOne({
        _id: printerId,
        eventId,
        name: "Cassa Context",
        ip: "127.0.0.1",
        port: 19107,
        isVirtual: true,
        emulatorSlot: 8,
        type: "CASHIER",
    });
    await db.collection("peripherals").insertOne({
        _id: cashBoxId,
        eventId,
        name: "Cassetta Context",
        type: "CASH_BOX",
        active: true,
    });
    await db.collection("posdevices").insertOne({
        _id: posDeviceId,
        eventId,
        name: "POS Context",
        printerId,
        cashBoxId,
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    return {
        eventId: String(eventId),
        productId: String(productId),
        posName: "POS Context",
    };
}

test.describe("POS modal contesto riga", () => {
    test("personalizza una singola unita, stampa ingredienti e salva note/stampa separata", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato sul POS desktop.");
        test.setTimeout(120000);

        const eventName = `POS Context Modal ${uniqueSuffix()}`;

        try {
            const seeded = await seedContextModalEvent(eventName);
            await ensureAdminAuthenticated(page, "/admin");
            await setAdminEventContextCookie(page, seeded.eventId);
            await openPosAndSelectDevice(page, seeded.posName);
            await openCashSessionIfRequired(page);

            const productCard = page.getByTestId(`pos-product-${seeded.productId}`);
            await productCard.click();
            await productCard.click();
            await productCard.click();
            await expect(page.getByText("3 x 8.00 €")).toBeVisible();

            await page.getByRole("button", { name: "Modifica dettagli Bardelle" }).click();
            const contextDialog = page.getByRole("dialog").filter({ hasText: "Stai modificando 1 unità su 3" });
            await expect(contextDialog).toBeVisible();
            await contextDialog.getByText("CIPOLLA").click();
            await contextDialog.getByText("SALE").click();
            await contextDialog.locator("#cart-context-note").fill("Ben cotte");
            await contextDialog.getByText("Stampa comanda singola per questa unità").click();
            await contextDialog.getByRole("button", { name: /Stampa ingredienti/i }).click();
            await expect(contextDialog.getByText("Ingredienti inviati alla stampante della cassa")).toBeVisible({ timeout: 15000 });
            await contextDialog.getByRole("button", { name: "Applica a 1 unità" }).click();
            await expect(contextDialog).toBeHidden();

            await expect(page.getByText("2 x 8.00 €")).toBeVisible();
            await expect(page.getByText("1 x 8.00 €")).toBeVisible();
            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Senza CIPOLLA · Aggiungi SALE · Ben cotte" })).toHaveCount(1);
            await expect(page.getByText("Comanda singola")).toHaveCount(1);

            await page.getByRole("button", { name: "Modifica dettagli Bardelle" }).last().click();
            const editDialog = page.getByRole("dialog").filter({ hasText: "Stai modificando 1 unità su 1" });
            await expect(editDialog).toBeVisible();
            await editDialog.locator("#cart-context-note").fill("Molto cotte");
            await editDialog.getByRole("button", { name: "Applica a 1 unità" }).click();
            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Senza CIPOLLA · Aggiungi SALE · Molto cotte" })).toHaveCount(1);

            await page.getByRole("button", { name: "Rimuovi Bardelle dal carrello" }).last().click();
            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Molto cotte" })).toHaveCount(0);
            await expect(page.getByText("2 x 8.00 €")).toBeVisible();

            await page.getByRole("button", { name: "Modifica dettagli Bardelle" }).click();
            const finalDialog = page.getByRole("dialog").filter({ hasText: "Stai modificando 1 unità su 2" });
            await finalDialog.locator("#cart-context-note").fill("Poco sale");
            await finalDialog.getByText("Stampa comanda singola per questa unità").click();
            await finalDialog.getByRole("button", { name: "Applica a 1 unità" }).click();
            await expect(finalDialog).toBeHidden();
            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Poco sale" })).toHaveCount(1);
            await expect(page.locator("p").filter({ hasText: "Comanda singola" })).toHaveCount(1);

            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click();
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 });

            await ensureDbConnection();
            const db = mongoose.connection.db;
            if (!db) throw new Error("DB non disponibile");
            const event = await db.collection("events").findOne({ name: eventName });
            const order = await db.collection("orders").findOne({ eventId: event?._id, status: "PAID" });
            expect(order?.cart).toEqual(expect.arrayContaining([
                expect.objectContaining({ quantity: 1, customKitchenNotes: "Poco sale" }),
            ]));
            const contextLine = order?.cart.find((item: { customKitchenNotes?: string }) => item.customKitchenNotes === "Poco sale");
            expect(contextLine?.splitPrintPerUnit).toBe(true);

            const manualPrintJob = await db.collection("printjobs").findOne({ eventId: event?._id, printType: "MANUAL_TEST" });
            expect(manualPrintJob?.document?.items?.[0]?.notes).toContain("Ingredienti: PASTA");
            expect(manualPrintJob?.document?.items?.[0]?.notes).toContain("Aggiunte: SALE");
            expect(manualPrintJob?.document?.items?.[0]?.notes).toContain("Senza: CIPOLLA");

            const orderPrintJobs = await db.collection("printjobs").find({ eventId: event?._id, source: "ORDER" }).toArray();
            expect(orderPrintJobs.some((job) =>
                JSON.stringify(job.document).includes("Poco sale")
            )).toBe(true);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });

    test("una unità personalizzata resta separata da un successivo tap sul prodotto", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato sul POS desktop.");
        test.setTimeout(120000);

        const eventName = `POS Context Merge ${uniqueSuffix()}`;

        try {
            const seeded = await seedContextModalEvent(eventName);
            await ensureAdminAuthenticated(page, "/admin");
            await setAdminEventContextCookie(page, seeded.eventId);
            await openPosAndSelectDevice(page, seeded.posName);
            await openCashSessionIfRequired(page);

            const productCard = page.getByTestId(`pos-product-${seeded.productId}`);
            await productCard.click();
            await expect(page.getByText("1 x 8.00 €")).toBeVisible();

            await page.getByRole("button", { name: "Modifica dettagli Bardelle" }).click();
            const dialog = page.getByRole("dialog").filter({ hasText: "Stai modificando 1 unità su 1" });
            await expect(dialog).toBeVisible();
            await dialog.getByText("CIPOLLA").click();
            await dialog.getByRole("button", { name: "Applica a 1 unità" }).click();
            await expect(dialog).toBeHidden();
            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Senza CIPOLLA" })).toHaveCount(1);

            // Un nuovo tap deve creare una riga normale separata, non incrementare quella personalizzata.
            await productCard.click();
            await expect(page.getByText("1 x 8.00 €")).toHaveCount(2);
            await expect(page.getByText("2 x 8.00 €")).toHaveCount(0);
            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Senza CIPOLLA" })).toHaveCount(1);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });

    test("riaprendo una riga personalizzata la nota non viene duplicata", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato sul POS desktop.");
        test.setTimeout(120000);

        const eventName = `POS Context Redup ${uniqueSuffix()}`;

        try {
            const seeded = await seedContextModalEvent(eventName);
            await ensureAdminAuthenticated(page, "/admin");
            await setAdminEventContextCookie(page, seeded.eventId);
            await openPosAndSelectDevice(page, seeded.posName);
            await openCashSessionIfRequired(page);

            const productCard = page.getByTestId(`pos-product-${seeded.productId}`);
            await productCard.click();
            await expect(page.getByText("1 x 8.00 €")).toBeVisible();

            await page.getByRole("button", { name: "Modifica dettagli Bardelle" }).click();
            const dialog = page.getByRole("dialog").filter({ hasText: "Stai modificando 1 unità su 1" });
            await dialog.getByText("CIPOLLA").click();
            await dialog.getByRole("button", { name: "Applica a 1 unità" }).click();
            await expect(dialog).toBeHidden();
            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Senza CIPOLLA" })).toHaveCount(1);

            // Riaprendo, il campo nota libera deve essere vuoto: la stringa composta non va travasata.
            await page.getByRole("button", { name: "Modifica dettagli Bardelle" }).click();
            const reopen = page.getByRole("dialog").filter({ hasText: "Stai modificando 1 unità su 1" });
            await expect(reopen.locator("#cart-context-note")).toHaveValue("");
            await reopen.getByRole("button", { name: "Applica a 1 unità" }).click();
            await expect(reopen).toBeHidden();

            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Senza CIPOLLA" })).toHaveCount(1);
            await expect(page.locator('[data-testid^="cart-item-notes-"]').filter({ hasText: "Senza CIPOLLA · Senza CIPOLLA" })).toHaveCount(0);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
