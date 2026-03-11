import { expect, test } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import { cleanupEventArtifactsByName } from "./utils/db";
import {
    completeCashOrder,
    configureCashPos,
    createCategory,
    createCategoryWithPrinter,
    createPrinter,
    createProduct,
    createAndActivateEvent,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";
import { getRealPrintConfig } from "./utils/real-print";

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

function extractItemNames(job: NonNullable<AdminPrintJobPayload["jobs"]>[number]): string[] {
    return (job.document?.items || [])
        .map((item) => item.name?.trim() || "")
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, "it"));
}

function sameItems(job: NonNullable<AdminPrintJobPayload["jobs"]>[number], expectedItems: string[]) {
    const actual = extractItemNames(job);
    const expected = [...expectedItems].sort((left, right) => left.localeCompare(right, "it"));
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

test.describe("Real Printing", () => {
    test.describe.configure({ timeout: 120000 });

    test("prints cashier, kitchen and grouped customer copies on real printers", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const realPrint = getRealPrintConfig();
        test.skip(!realPrint.enabled, realPrint.skipReason);

        const suffix = uniqueSuffix();
        const eventName = `Real Print Event ${suffix}`;
        const cashierPrinterName = `Real Cashier ${suffix}`;
        const kitchenPrinterName = `Real Kitchen ${suffix}`;
        const cashBoxName = `Real CashBox ${suffix}`;
        const posName = `Real POS ${suffix}`;
        const kitchenCategoryName = `Kitchen Cat ${suffix}`;
        const pickupCategoryName = `Pickup Cat ${suffix}`;
        const kitchenProductName = `Lasagne ${suffix}`;
        const pickupProductName = `Pane ${suffix}`;
        const kitchenShortName = `RK${suffix.slice(-4)}`;
        const pickupShortName = `RU${suffix.slice(-4)}`;

        await ensureAdminAuthenticated(page, "/admin");

        try {
            await createAndActivateEvent(page, eventName);
            await configureCashPos(
                page,
                cashierPrinterName,
                realPrint.cashierHost,
                cashBoxName,
                posName,
                { printerPort: String(realPrint.cashierPort) }
            );
            await createPrinter(page, kitchenPrinterName, realPrint.kitchenHost, {
                printerType: "KITCHEN",
                printerPort: String(realPrint.kitchenPort)
            });

            await createCategoryWithPrinter(page, kitchenCategoryName, kitchenPrinterName);
            await createProduct(page, kitchenCategoryName, {
                name: kitchenProductName,
                shortName: kitchenShortName,
                price: "7.00"
            });

            await createCategory(page, pickupCategoryName);
            await createProduct(page, pickupCategoryName, {
                name: pickupProductName,
                shortName: pickupShortName,
                price: "4.00"
            });

            await openPosAndSelectDevice(page, posName);
            await openCashSessionIfRequired(page);
            await completeCashOrder(page, [
                { name: kitchenShortName, quantity: 1 },
                { name: pickupShortName, quantity: 1 }
            ]);

            const findMatchedJobs = async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=20");
                if (!response.ok()) return null;

                const payload = await response.json() as AdminPrintJobPayload;
                const jobs = (payload.jobs || []).filter((job) =>
                    job.source === "ORDER"
                    && job.status === "SENT"
                );

                const cashierSummary = jobs.find((job) =>
                    job.printType === "CASHIER_SUMMARY"
                    && job.destinationHost === realPrint.cashierHost
                    && job.destinationPort === realPrint.cashierPort
                    && sameItems(job, [kitchenShortName, pickupShortName])
                );

                const kitchenOrder = jobs.find((job) =>
                    job.printType === "KITCHEN_ORDER"
                    && job.destinationHost === realPrint.kitchenHost
                    && job.destinationPort === realPrint.kitchenPort
                    && sameItems(job, [kitchenShortName])
                );

                const customerKitchenCopy = jobs.find((job) =>
                    job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === realPrint.cashierHost
                    && job.destinationPort === realPrint.cashierPort
                    && sameItems(job, [kitchenShortName])
                );

                const customerPickupCopy = jobs.find((job) =>
                    job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === realPrint.cashierHost
                    && job.destinationPort === realPrint.cashierPort
                    && sameItems(job, [pickupShortName])
                );

                if (!cashierSummary || !kitchenOrder || !customerKitchenCopy || !customerPickupCopy) {
                    return null;
                }

                return {
                    cashierSummary,
                    kitchenOrder,
                    customerKitchenCopy,
                    customerPickupCopy
                };
            };

            await expect.poll(async () => Boolean(await findMatchedJobs()), {
                timeout: realPrint.timeoutMs
            }).toBe(true);

            const matchedJobs = await findMatchedJobs();
            expect(matchedJobs).not.toBeNull();
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
