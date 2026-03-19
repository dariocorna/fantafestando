import { expect, test } from "@playwright/test";
import mongoose from "mongoose";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    completeCashOrder,
    createAndActivateEvent,
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
            items?: Array<{ name?: string }>;
        };
    }>;
}

function sameItems(
    job: NonNullable<AdminPrintJobPayload["jobs"]>[number],
    expectedItems: string[]
) {
    const actual = (job.document?.items || [])
        .map((item) => item.name?.trim() || "")
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, "it"));
    const expected = [...expectedItems].sort((left, right) => left.localeCompare(right, "it"));
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

test.describe("Category skip kitchen print", () => {
    test("allows enabling and disabling the category skip flag from admin catalog", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Skip UI ${suffix}`;
        const categoryName = `Servizi ${suffix}`;

        try {
            await ensureAdminAuthenticated(page, "/admin/catalog");
            await createAndActivateEvent(page, eventName);

            await page.goto("/admin/catalog");
            await page.click("#new-category-btn");
            const createDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Categoria/i }).first();
            await createDialog.locator("#cat-name").fill(categoryName);
            await createDialog.locator("#skipKitchenPrint").check();
            await createDialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();
            await expect(createDialog).toBeHidden();

            const categoryRow = page.locator("tr").filter({ hasText: categoryName }).first();
            await expect(categoryRow).toContainText("Non stampare");

            await expect.poll(async () => {
                await ensureDbConnection();
                const db = mongoose.connection.db;
                if (!db) return false;

                const category = await db.collection("categories").findOne({ name: categoryName }) as {
                    skipKitchenPrint?: boolean;
                } | null;

                return Boolean(category?.skipKitchenPrint);
            }, { timeout: 15000 }).toBe(true);

            await categoryRow.getByLabel("Modifica").click();
            const editDialog = page.getByRole("dialog").filter({ hasText: /Modifica Categoria/i }).first();
            await expect(editDialog.locator("#skipKitchenPrint")).toBeChecked();
            await editDialog.locator("#skipKitchenPrint").uncheck();
            await editDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click();
            await expect(editDialog).toBeHidden();

            await expect(categoryRow).toContainText("Standard");
            await expect.poll(async () => {
                await ensureDbConnection();
                const db = mongoose.connection.db;
                if (!db) return false;

                const category = await db.collection("categories").findOne({ name: categoryName }) as {
                    skipKitchenPrint?: boolean;
                } | null;

                return category?.skipKitchenPrint === false;
            }, { timeout: 15000 }).toBe(true);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });

    test("skips kitchen and customer order prints for categories marked as non printable", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Skip Print ${suffix}`;
        const cashierPrinterName = `Cashier ${suffix}`;
        const kitchenPrinterName = `Kitchen ${suffix}`;
        const skippedPrinterName = `Skipped ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const kitchenCategoryName = `Griglia ${suffix}`;
        const skippedCategoryName = `Servizi ${suffix}`;
        const kitchenShortName = `KG${suffix.slice(-4)}`;
        const skippedShortName = `SK${suffix.slice(-4)}`;

        try {
            await ensureAdminAuthenticated(page, "/admin");
            await createAndActivateEvent(page, eventName);
            await ensureDbConnection();
            const db = mongoose.connection.db;
            if (!db) {
                throw new Error("Connessione Mongo non disponibile per il setup E2E.");
            }

            const event = await db.collection("events").findOne({ name: eventName });
            if (!event?._id) {
                throw new Error(`Evento di test non trovato: ${eventName}`);
            }

            const eventId = event._id;
            const cashierPrinterId = new mongoose.Types.ObjectId();
            const kitchenPrinterId = new mongoose.Types.ObjectId();
            const skippedPrinterId = new mongoose.Types.ObjectId();
            const cashBoxId = new mongoose.Types.ObjectId();
            const posDeviceId = new mongoose.Types.ObjectId();
            const kitchenCategoryId = new mongoose.Types.ObjectId();
            const skippedCategoryId = new mongoose.Types.ObjectId();

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
                },
                {
                    _id: skippedPrinterId,
                    eventId,
                    name: skippedPrinterName,
                    ip: localPrinterIp(),
                    port: 19102,
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

            await db.collection("categories").insertMany([
                {
                    _id: kitchenCategoryId,
                    eventId,
                    name: kitchenCategoryName,
                    uiColor: "#f97316",
                    printOrder: 0,
                    printerId: kitchenPrinterId,
                    skipKitchenPrint: false,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                {
                    _id: skippedCategoryId,
                    eventId,
                    name: skippedCategoryName,
                    uiColor: "#0f766e",
                    printOrder: 1,
                    printerId: skippedPrinterId,
                    skipKitchenPrint: true,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            ]);

            await db.collection("products").insertMany([
                {
                    _id: new mongoose.Types.ObjectId(),
                    eventId,
                    categoryId: kitchenCategoryId,
                    name: `Lasagna ${suffix}`,
                    shortName: kitchenShortName,
                    basePrice: 7,
                    isSoldOut: false,
                    stockQuantity: null,
                    availableDays: [],
                    variants: [],
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                {
                    _id: new mongoose.Types.ObjectId(),
                    eventId,
                    categoryId: skippedCategoryId,
                    name: `Gettone ${suffix}`,
                    shortName: skippedShortName,
                    basePrice: 4,
                    isSoldOut: false,
                    stockQuantity: null,
                    availableDays: [],
                    variants: [],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            ]);

            await openPosAndSelectDevice(page, posName);
            await openCashSessionIfRequired(page);

            await completeCashOrder(page, [
                { name: kitchenShortName, quantity: 1 },
                { name: skippedShortName, quantity: 1 }
            ]);

            const findMixedOrderJobs = async () => {
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
                    && sameItems(job, [kitchenShortName, skippedShortName])
                );

                const kitchenDepartmentCopy = jobs.filter((job) =>
                    job.printType === "KITCHEN_ORDER"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19101
                    && sameItems(job, [kitchenShortName])
                );

                const customerKitchenCopy = jobs.filter((job) =>
                    job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19100
                    && sameItems(job, [kitchenShortName])
                );

                const skippedCategoryJobs = jobs.filter((job) =>
                    job.printType !== "CASHIER_SUMMARY"
                    && sameItems(job, [skippedShortName])
                );

                const skippedDestinationJobs = jobs.filter((job) =>
                    job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19102
                );

                if (
                    cashierSummary.length !== 1
                    || kitchenDepartmentCopy.length !== 1
                    || customerKitchenCopy.length !== 1
                    || skippedCategoryJobs.length !== 0
                    || skippedDestinationJobs.length !== 0
                ) {
                    return null;
                }

                return {
                    cashierSummary,
                    kitchenDepartmentCopy,
                    customerKitchenCopy
                };
            };

            await expect.poll(async () => Boolean(await findMixedOrderJobs()), {
                timeout: 30000
            }).toBe(true);

            await db.collection("printjobs").deleteMany({ eventId });

            await completeCashOrder(page, [{ name: skippedShortName, quantity: 1 }]);

            const findOnlySkippedOrderJobs = async () => {
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
                    && sameItems(job, [skippedShortName])
                );

                const extraOrderCopies = jobs.filter((job) =>
                    job.printType === "KITCHEN_ORDER" || job.printType === "CUSTOMER_ORDER"
                );

                if (cashierSummary.length !== 1 || extraOrderCopies.length !== 0) {
                    return null;
                }

                return cashierSummary;
            };

            await expect.poll(async () => Boolean(await findOnlySkippedOrderJobs()), {
                timeout: 30000
            }).toBe(true);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
