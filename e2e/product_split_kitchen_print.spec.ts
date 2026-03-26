import { expect, test } from "@playwright/test";
import mongoose from "mongoose";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    completeCashOrder,
    createAndActivateEvent,
    createCategory,
    createProduct,
    localPrinterIp,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";

interface AdminPrintJobPayload {
    jobs?: Array<{
        status?: string;
        source?: string;
        printType?: string;
        destinationHost?: string;
        destinationPort?: number;
        document?: {
            items?: Array<{ name?: string; qty?: number; quantity?: number }>;
        };
    }>;
}

function extractQuantities(job: NonNullable<AdminPrintJobPayload["jobs"]>[number]) {
    return (job.document?.items || []).map((item) => item.qty ?? item.quantity ?? 0);
}

test.describe("Product split kitchen print", () => {
    test.describe.configure({ timeout: 120000 });

    test("persists the product flag and supports bulk selection actions from catalog", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Product Split UI ${suffix}`;
        const categoryName = `Fritti ${suffix}`;
        const splitProductName = `Patatine ${suffix}`;
        const standardProductName = `Crocchette ${suffix}`;
        const fixedMenuName = `Menu Combo ${suffix}`;

        try {
            await ensureAdminAuthenticated(page, "/admin/catalog");
            await createAndActivateEvent(page, eventName);
            await createCategory(page, categoryName);
            await createProduct(page, categoryName, {
                name: splitProductName,
                shortName: `SP${suffix.slice(-4)}`,
                price: "4.00",
                splitKitchenPrintPerUnit: true
            });
            await createProduct(page, categoryName, {
                name: standardProductName,
                shortName: `ST${suffix.slice(-4)}`,
                price: "5.00"
            });

            await ensureDbConnection();
            const db = mongoose.connection.db;
            if (!db) throw new Error("Connessione Mongo non disponibile.");

            const event = await db.collection("events").findOne({ name: eventName });
            const category = await db.collection("categories").findOne({ eventId: event?._id, name: categoryName });
            const splitProduct = await db.collection("products").findOne({ eventId: event?._id, name: splitProductName });

            if (!event?._id || !category?._id || !splitProduct?._id) {
                throw new Error("Setup E2E incompleto per i prodotti.");
            }

            await db.collection("products").insertOne({
                _id: new mongoose.Types.ObjectId(),
                eventId: event._id,
                categoryId: category._id,
                name: fixedMenuName,
                shortName: `FM${suffix.slice(-4)}`,
                basePrice: 12,
                kind: "FIXED_MENU",
                availableOnlyInMenus: false,
                salesChannels: ["POS", "MENU"],
                splitKitchenPrintPerUnit: false,
                isSoldOut: false,
                stockQuantity: null,
                availableDays: [],
                recipeItems: [],
                menuComponents: [
                    {
                        productId: splitProduct._id,
                        quantity: 1
                    }
                ],
                menuChoiceGroups: [],
                variants: [],
                createdAt: new Date(),
                updatedAt: new Date()
            });

            await page.reload({ waitUntil: "domcontentloaded" });
            await expect(page.getByTestId("product-table-ready")).toHaveText("ready");

            const splitRow = page.getByRole("row").filter({ hasText: splitProductName }).first();
            const standardRow = page.getByRole("row").filter({ hasText: standardProductName }).first();
            const fixedMenuRow = page.getByRole("row").filter({ hasText: fixedMenuName }).first();

            await expect(splitRow).toBeVisible();
            await expect(standardRow).toBeVisible();
            await expect(fixedMenuRow).toBeVisible();
            await expect(fixedMenuRow.getByRole("checkbox")).toBeDisabled();

            await expect.poll(async () => {
                const product = await db.collection("products").findOne({ eventId: event._id, name: splitProductName }) as {
                    splitKitchenPrintPerUnit?: boolean;
                } | null;
                return Boolean(product?.splitKitchenPrintPerUnit);
            }, { timeout: 15000 }).toBe(true);

            await splitRow.getByRole("checkbox").check();
            await expect(page.getByText("1 prodotti selezionati")).toBeVisible();
            await page.getByTestId("product-select-all").click();
            await expect(page.getByText("2 prodotti selezionati")).toBeVisible();

            await page.getByTestId("product-bulk-mode-standard").click();
            await page.getByRole("button", { name: "Conferma", exact: true }).click();

            await expect(page.getByText(/prodotti selezionati/i)).toHaveCount(0);

            await expect.poll(async () => {
                const entries = await db.collection("products")
                    .find({ eventId: event._id, name: { $in: [splitProductName, standardProductName] } })
                    .project({ splitKitchenPrintPerUnit: 1, name: 1 })
                    .toArray() as Array<{ splitKitchenPrintPerUnit?: boolean }>;
                return entries.length === 2 && entries.every((entry) => entry.splitKitchenPrintPerUnit === false);
            }, { timeout: 15000 }).toBe(true);

            await splitRow.getByRole("checkbox").check();
            await page.getByTestId("product-clear-selection").click();
            await expect(page.getByText(/prodotti selezionati/i)).toHaveCount(0);

            await splitRow.getByRole("checkbox").check();
            await page.getByTestId("product-select-all").click();
            await page.getByTestId("product-bulk-mode-split").click();
            await page.getByRole("button", { name: "Conferma", exact: true }).click();

            await expect(page.getByText(/prodotti selezionati/i)).toHaveCount(0);

            await expect.poll(async () => {
                const entries = await db.collection("products")
                    .find({ eventId: event._id, name: { $in: [splitProductName, standardProductName] } })
                    .project({ splitKitchenPrintPerUnit: 1, name: 1 })
                    .toArray() as Array<{ splitKitchenPrintPerUnit?: boolean }>;
                return entries.length === 2 && entries.every((entry) => entry.splitKitchenPrintPerUnit === true);
            }, { timeout: 15000 }).toBe(true);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });

    test("prints separate kitchen and customer jobs for each unit when the product flag is active", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Product Split Print ${suffix}`;
        const cashierPrinterName = `Cashier ${suffix}`;
        const kitchenPrinterName = `Kitchen ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `Friggitoria ${suffix}`;
        const productName = `Patatine ${suffix}`;
        const productShortName = `PS${suffix.slice(-4)}`;

        try {
            await ensureAdminAuthenticated(page, "/admin");
            await createAndActivateEvent(page, eventName);
            await ensureDbConnection();
            const db = mongoose.connection.db;
            if (!db) throw new Error("Connessione Mongo non disponibile.");

            const event = await db.collection("events").findOne({ name: eventName });
            if (!event?._id) throw new Error(`Evento di test non trovato: ${eventName}`);

            const eventId = event._id;
            const cashierPrinterId = new mongoose.Types.ObjectId();
            const kitchenPrinterId = new mongoose.Types.ObjectId();
            const cashBoxId = new mongoose.Types.ObjectId();
            const posDeviceId = new mongoose.Types.ObjectId();
            const categoryId = new mongoose.Types.ObjectId();

            await db.collection("printers").insertMany([
                {
                    _id: cashierPrinterId,
                    eventId,
                    name: cashierPrinterName,
                    ip: localPrinterIp(),
                    port: 19100,
                    type: "CASHIER",
                    isVirtual: false,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                {
                    _id: kitchenPrinterId,
                    eventId,
                    name: kitchenPrinterName,
                    ip: localPrinterIp(),
                    port: 19101,
                    type: "KITCHEN",
                    isVirtual: false,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            ]);

            await db.collection("peripherals").insertOne({
                _id: cashBoxId,
                eventId,
                name: cashBoxName,
                type: "CASH_BOX",
                config: {},
                createdAt: new Date(),
                updatedAt: new Date()
            });

            await db.collection("posdevices").insertOne({
                _id: posDeviceId,
                eventId,
                name: posName,
                printerId: cashierPrinterId,
                cashBoxId,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            await db.collection("categories").insertOne({
                _id: categoryId,
                eventId,
                name: categoryName,
                uiColor: "#f97316",
                printOrder: 0,
                printerId: kitchenPrinterId,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            await db.collection("products").insertOne({
                _id: new mongoose.Types.ObjectId(),
                eventId,
                categoryId,
                name: productName,
                shortName: productShortName,
                basePrice: 4,
                kind: "STANDARD",
                availableOnlyInMenus: false,
                salesChannels: ["POS", "MENU"],
                splitKitchenPrintPerUnit: true,
                isSoldOut: false,
                stockQuantity: null,
                availableDays: [],
                recipeItems: [],
                menuComponents: [],
                menuChoiceGroups: [],
                variants: [],
                createdAt: new Date(),
                updatedAt: new Date()
            });

            await openPosAndSelectDevice(page, posName);
            await openCashSessionIfRequired(page);
            await completeCashOrder(page, [{ name: productShortName, quantity: 3 }]);

            const findMatchedJobs = async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=20");
                if (!response.ok()) return null;

                const payload = await response.json() as AdminPrintJobPayload;
                const jobs = (payload.jobs || []).filter((job) =>
                    job.source === "ORDER"
                    && job.status === "SENT"
                );

                const cashierSummary = jobs.filter((job) =>
                    job.printType === "CASHIER_SUMMARY"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19100
                    && extractQuantities(job).length === 1
                    && extractQuantities(job)[0] === 3
                );

                const kitchenJobs = jobs.filter((job) =>
                    job.printType === "KITCHEN_ORDER"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19101
                    && extractQuantities(job).length === 1
                    && extractQuantities(job)[0] === 1
                );

                const customerJobs = jobs.filter((job) =>
                    job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19100
                    && extractQuantities(job).length === 1
                    && extractQuantities(job)[0] === 1
                );

                if (cashierSummary.length !== 1 || kitchenJobs.length !== 3 || customerJobs.length !== 3) {
                    return null;
                }

                return {
                    cashierSummary,
                    kitchenJobs,
                    customerJobs
                };
            };

            await expect.poll(async () => Boolean(await findMatchedJobs()), {
                timeout: 30000
            }).toBe(true);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
