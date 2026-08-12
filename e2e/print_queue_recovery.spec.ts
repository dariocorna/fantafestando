import { expect, test } from "@playwright/test";
import Category from "../src/models/Category";
import Order from "../src/models/Order";
import Peripheral from "../src/models/Peripheral";
import PosDevice from "../src/models/PosDevice";
import Printer from "../src/models/Printer";
import PrintJob from "../src/models/PrintJob";
import Product from "../src/models/Product";
import {
    createActiveEventDirect,
    deleteEvent,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    setAdminEventContextCookie,
    uniqueSuffix,
} from "./utils/fixtures";

interface KitchenPrintJob {
    _id: { toString(): string } | string;
    orderId?: { toString(): string } | string;
    status: "QUEUED" | "HELD" | "SENT" | "FAILED";
}

test.describe("Print Queue Recovery", () => {
    test("resumes the same held kitchen jobs without duplicates when the printer returns", async ({ page }) => {
        const suffix = uniqueSuffix();
        const eventName = `Print Queue ${suffix}`;
        const cashierPrinterName = `Queue Cashier ${suffix}`;
        const kitchenPrinterName = `Queue Kitchen ${suffix}`;
        const cashBoxName = `Queue CashBox ${suffix}`;
        const posName = `Queue POS ${suffix}`;
        const categoryName = `Queue Category ${suffix}`;
        const productName = `Queue Product ${suffix}`;
        const shortName = `QUEUE-${suffix.slice(-4)}`;

        try {
            const { eventId } = await createActiveEventDirect(eventName);
            await setAdminEventContextCookie(page, eventId);

            const cashierPrinter = await Printer.create({
                eventId,
                name: cashierPrinterName,
                ip: "127.0.0.1",
                port: 19100,
                type: "CASHIER",
                isVirtual: false,
            });
            const kitchenPrinter = await Printer.create({
                eventId,
                name: kitchenPrinterName,
                ip: "127.0.0.1",
                port: 19199,
                type: "KITCHEN",
                isVirtual: false,
            });
            const cashBox = await Peripheral.create({
                eventId,
                name: cashBoxName,
                type: "CASH_BOX",
                config: {},
            });
            await PosDevice.create({
                eventId,
                name: posName,
                printerId: cashierPrinter._id,
                cashBoxId: cashBox._id,
            });
            const category = await Category.create({
                eventId,
                name: categoryName,
                uiColor: "#ea580c",
                printOrder: 0,
                printerId: kitchenPrinter._id,
            });
            await Product.create({
                eventId,
                categoryId: category._id,
                name: productName,
                shortName,
                basePrice: 5,
                stockQuantity: null,
                isSoldOut: false,
                availableDays: [],
                variants: [],
            });

            const listKitchenJobs = () => PrintJob.find({
                eventId,
                printerId: kitchenPrinter._id,
                source: "ORDER",
                printType: "KITCHEN_ORDER",
                "document.items.name": shortName,
            })
                .sort({ createdAt: 1, _id: 1 })
                .select("_id orderId status")
                .lean() as unknown as Promise<KitchenPrintJob[]>;

            await openPosAndSelectDevice(page, posName);
            await openCashSessionIfRequired(page);

            await page.locator("button").filter({ hasText: shortName }).first().click();
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
            const firstCheckout = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
            await firstCheckout.getByRole("button", { name: "CONFERMA", exact: true }).click();
            const printErrorDialog = page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i });
            // The synchronous path deliberately exhausts its bounded hardware
            // retries before offering the persistent queue action.
            await expect(printErrorDialog).toBeVisible({ timeout: 15_000 });
            await expect(firstCheckout).toBeHidden();
            await expect.poll(async () => (await listKitchenJobs()).map((job) => job.status)).toEqual(["FAILED"]);
            const failedJobId = (await listKitchenJobs())[0]._id.toString();
            await expect.poll(() => Order.countDocuments({ eventId, status: "PAID" })).toBe(1);

            await printErrorDialog
                .getByRole("button", { name: `Prosegui e lascia in coda — ${kitchenPrinterName}`, exact: true })
                .click();
            const queuedDialog = page.getByRole("dialog", { name: "Stampe lasciate in coda" });
            await expect(queuedDialog).toBeVisible();
            await expect(queuedDialog).toContainText("Puoi proseguire con il prossimo ordine");

            // Freeze only after the cashier action has acquired and released
            // the real lease. This keeps the two-job UI count deterministic
            // without changing the semantics of FAILED -> HELD.
            await Printer.updateOne(
                { _id: kitchenPrinter._id },
                {
                    $set: {
                        printQueueLeaseToken: `e2e-${suffix}`,
                        printQueueLeaseExpiresAt: new Date(Date.now() + 60_000),
                    },
                },
            );
            await expect.poll(async () => (await listKitchenJobs()).map((job) => job.status)).toEqual(["HELD"]);
            expect((await listKitchenJobs())[0]._id.toString()).toBe(failedJobId);
            await queuedDialog.getByRole("button", { name: "OK", exact: true }).click();

            await page.locator("button").filter({ hasText: shortName }).first().click();
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
            const secondCheckout = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
            await secondCheckout.getByRole("button", { name: "CONFERMA", exact: true }).click();
            await expect(secondCheckout).toBeHidden();
            await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible();
            await expect(page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i })).toHaveCount(0);

            await expect.poll(() => Order.countDocuments({ eventId, status: "PAID" })).toBe(2);
            await expect.poll(async () => (await listKitchenJobs()).map((job) => job.status)).toEqual(["HELD", "HELD"]);
            const heldJobs = await listKitchenJobs();
            const heldJobIds = heldJobs.map((job) => job._id.toString());
            const heldOrderIds = heldJobs.map((job) => job.orderId?.toString());
            expect(heldOrderIds.every(Boolean)).toBe(true);
            expect(new Set(heldOrderIds).size).toBe(2);

            await page.goto("/admin/settings/hardware");
            await page.getByRole("tab", { name: "Monitor Stampa" }).click();
            const heldQueues = page.getByTestId("held-print-queues");
            await expect(heldQueues).toContainText(`${kitchenPrinterName} · 2 stampe`);
            const heldJobsLoaded = page.waitForResponse((response) => {
                const url = new URL(response.url());
                return url.pathname === "/api/admin/print-jobs"
                    && url.searchParams.get("status") === "HELD"
                    && response.ok();
            });
            await page.getByRole("combobox", { name: "Filtro Stato Stampa" }).click();
            await page.getByRole("option", { name: "In attesa stampante" }).click();
            await heldJobsLoaded;
            await expect(page.getByText("IN ATTESA", { exact: true })).toHaveCount(2);

            await Printer.updateOne(
                { _id: kitchenPrinter._id },
                {
                    $set: { port: 19101 },
                    $unset: { printQueueLeaseToken: 1, printQueueLeaseExpiresAt: 1 },
                },
            );
            await expect.poll(async () => (await listKitchenJobs()).map((job) => job.status)).toEqual(["SENT", "SENT"]);
            const sentJobs = await listKitchenJobs();
            expect(sentJobs.map((job) => job._id.toString())).toEqual(heldJobIds);

            await expect.poll(async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=40");
                const payload = await response.json() as { heldQueues?: Array<{ printerId: string | null; count: number }> };
                return payload.heldQueues?.find((queue) => queue.printerId === kitchenPrinter._id.toString())?.count || 0;
            }).toBe(0);
            await page.getByRole("button", { name: "Aggiorna", exact: true }).click();
            await expect(heldQueues).toHaveCount(0);
        } finally {
            await deleteEvent(page, eventName);
        }
    });
});
