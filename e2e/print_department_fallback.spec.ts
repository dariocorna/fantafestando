import { expect, test } from "@playwright/test";
import mongoose from "mongoose";
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
            footerLines?: string[];
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

test.describe("Print Department Fallback", () => {
    test("keeps department slips separated on cashier fallback when no kitchen printer is configured", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Print Fallback ${suffix}`;
        const cashierPrinterName = `Cashier ${suffix}`;
        const kitchenPrinterName = `Kitchen ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const kitchenCategoryName = `Griglia ${suffix}`;
        const fallbackCategoryName = `Friggitoria ${suffix}`;
        const kitchenProductName = `Costine ${suffix}`;
        const fallbackProductName = `Patatine ${suffix}`;
        const kitchenShortName = `GF${suffix.slice(-4)}`;
        const fallbackShortName = `FF${suffix.slice(-4)}`;

        try {
            await createAndActivateEvent(page, eventName);
            await ensureDbConnection();
            const db = mongoose.connection.db;

            const event = await db.collection("events").findOne({ name: eventName });
            if (!event?._id) {
                throw new Error(`Evento di test non trovato: ${eventName}`);
            }

            const eventId = event._id;
            const cashierPrinterId = new mongoose.Types.ObjectId();
            const kitchenPrinterId = new mongoose.Types.ObjectId();
            const cashBoxId = new mongoose.Types.ObjectId();
            const posDeviceId = new mongoose.Types.ObjectId();
            const kitchenCategoryId = new mongoose.Types.ObjectId();
            const fallbackCategoryId = new mongoose.Types.ObjectId();

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

            await db.collection("categories").insertMany([
                {
                    _id: kitchenCategoryId,
                    eventId,
                    name: kitchenCategoryName,
                    uiColor: "#f97316",
                    printOrder: 0,
                    printerId: kitchenPrinterId,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                {
                    _id: fallbackCategoryId,
                    eventId,
                    name: fallbackCategoryName,
                    uiColor: "#0f766e",
                    printOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            ]);

            await db.collection("products").insertMany([
                {
                    _id: new mongoose.Types.ObjectId(),
                    eventId,
                    categoryId: kitchenCategoryId,
                    name: kitchenProductName,
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
                    categoryId: fallbackCategoryId,
                    name: fallbackProductName,
                    shortName: fallbackShortName,
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
                { name: fallbackShortName, quantity: 1 }
            ]);

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
                    && sameItems(job, [kitchenShortName, fallbackShortName])
                );

                const kitchenDepartmentCopy = jobs.filter((job) =>
                    job.printType === "KITCHEN_ORDER"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19101
                    && sameItems(job, [kitchenShortName])
                );

                const fallbackDepartmentCopy = jobs.filter((job) =>
                    job.printType === "KITCHEN_ORDER"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19100
                    && sameItems(job, [fallbackShortName])
                    && (job.document?.footerLines || []).some((line) => line.includes("REPARTO:"))
                );

                const customerKitchenCopy = jobs.filter((job) =>
                    job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19100
                    && sameItems(job, [kitchenShortName])
                );

                const customerFallbackCopy = jobs.filter((job) =>
                    job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === "127.0.0.1"
                    && job.destinationPort === 19100
                    && sameItems(job, [fallbackShortName])
                    && (job.document?.footerLines || []).some((line) => line.includes("REPARTO:"))
                );

                if (
                    cashierSummary.length !== 1
                    || kitchenDepartmentCopy.length !== 1
                    || fallbackDepartmentCopy.length !== 1
                    || customerKitchenCopy.length !== 1
                    || customerFallbackCopy.length !== 1
                ) {
                    return null;
                }

                return {
                    cashierSummary,
                    kitchenDepartmentCopy,
                    fallbackDepartmentCopy,
                    customerKitchenCopy,
                    customerFallbackCopy
                };
            };

            await expect.poll(async () => Boolean(await findMatchedJobs()), {
                timeout: 30000
            }).toBe(true);

            const matchedJobs = await findMatchedJobs();
            expect(matchedJobs).not.toBeNull();
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
