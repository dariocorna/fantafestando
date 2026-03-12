import { expect, test } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import { cleanupEventArtifactsByName } from "./utils/db";
import {
    closeCashSession,
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

type PrinterLedMap = Record<string, string>;
type PrinterInfoMap = Record<string, string>;
type OrderItem = { name: string; quantity: number };

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

function parsePrinterLedMap(html: string): PrinterLedMap {
    const result: PrinterLedMap = {};
    const pattern = /Led\("([01])","([^"]+)"\)/g;

    let match = pattern.exec(html);
    while (match) {
        result[match[2]] = match[1];
        match = pattern.exec(html);
    }

    return result;
}

function parsePrinterInfoMap(html: string): PrinterInfoMap {
    const result: PrinterInfoMap = {};
    const pattern = /Tab\("([^"]+)","([^"]*)"\)/g;

    let match = pattern.exec(html);
    while (match) {
        result[match[1]] = match[2];
        match = pattern.exec(html);
    }

    return result;
}

async function expectPrinterWebStatusHealthy(
    page: import("@playwright/test").Page,
    printerLabel: string,
    host: string
) {
    const [statusResponse, infoResponse] = await Promise.all([
        page.request.get(`http://${host}/status.htm`),
        page.request.get(`http://${host}/info.htm`)
    ]);

    expect(statusResponse.ok(), `${printerLabel}: status.htm non raggiungibile`).toBe(true);
    expect(infoResponse.ok(), `${printerLabel}: info.htm non raggiungibile`).toBe(true);

    const [statusHtml, infoHtml] = await Promise.all([
        statusResponse.text(),
        infoResponse.text()
    ]);

    const ledMap = parsePrinterLedMap(statusHtml);
    const infoMap = parsePrinterInfoMap(infoHtml);

    expect(ledMap["Cutter Error"], `${printerLabel}: cutter error attivo`).toBe("0");
    expect(ledMap["Paper Jam"], `${printerLabel}: paper jam attivo`).toBe("0");
    expect(ledMap["Cover Open"], `${printerLabel}: cover open attivo`).toBe("0");
    expect(ledMap["Over Temperature Error"], `${printerLabel}: over temperature attivo`).toBe("0");
    expect(ledMap["Supply Voltage Error"], `${printerLabel}: supply voltage error attivo`).toBe("0");
    expect(infoMap["Cutter Test:"], `${printerLabel}: cutter test non OK`).toBe("OK");
}

function buildDeterministicOrderPlan(
    entries: Array<{ name: string; price: number }>,
    orderCount: number
): { orders: OrderItem[][]; expectedCashTotal: number } {
    const orders: OrderItem[][] = [];
    let expectedCashTotal = 0;

    for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
        const itemCount = 1 + (orderIndex % 3);
        const orderItems: OrderItem[] = [];

        for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
            const product = entries[(orderIndex + itemIndex) % entries.length];
            const quantity = 1 + ((orderIndex + itemIndex) % 2);
            orderItems.push({ name: product.name, quantity });
            expectedCashTotal += product.price * quantity;
        }

        orders.push(orderItems);
    }

    return {
        orders,
        expectedCashTotal: Number(expectedCashTotal.toFixed(2))
    };
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
            for (let index = 0; index < 5; index += 1) {
                await completeCashOrder(page, [
                    { name: kitchenShortName, quantity: 1 },
                    { name: pickupShortName, quantity: 1 }
                ]);
            }

            const findMatchedJobs = async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=100");
                if (!response.ok()) return null;

                const payload = await response.json() as AdminPrintJobPayload;
                const jobs = (payload.jobs || []).filter((job) =>
                    job.source === "ORDER"
                    && job.status === "SENT"
                );

                const cashierSummary = jobs.filter((job) =>
                    job.printType === "CASHIER_SUMMARY"
                    && job.destinationHost === realPrint.cashierHost
                    && job.destinationPort === realPrint.cashierPort
                    && sameItems(job, [kitchenShortName, pickupShortName])
                );

                const kitchenOrder = jobs.filter((job) =>
                    job.printType === "KITCHEN_ORDER"
                    && job.destinationHost === realPrint.kitchenHost
                    && job.destinationPort === realPrint.kitchenPort
                    && sameItems(job, [kitchenShortName])
                );

                const customerKitchenCopy = jobs.filter((job) =>
                    job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === realPrint.cashierHost
                    && job.destinationPort === realPrint.cashierPort
                    && sameItems(job, [kitchenShortName])
                );

                const customerPickupCopy = jobs.filter((job) =>
                    job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === realPrint.cashierHost
                    && job.destinationPort === realPrint.cashierPort
                    && sameItems(job, [pickupShortName])
                );

                if (
                    cashierSummary.length !== 5
                    || kitchenOrder.length !== 5
                    || customerKitchenCopy.length !== 5
                    || customerPickupCopy.length !== 5
                ) {
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

            await expectPrinterWebStatusHealthy(page, "Kitchen printer", realPrint.kitchenHost);
            await expectPrinterWebStatusHealthy(page, "Cashier printer", realPrint.cashierHost);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });

    test("stress test real printers with 50 orders and cash session closing summary", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");
        test.setTimeout(300000);

        const realPrint = getRealPrintConfig();
        test.skip(!realPrint.stressEnabled, realPrint.stressSkipReason);

        const suffix = uniqueSuffix();
        const eventName = `Real Print Stress Event ${suffix}`;
        const cashierPrinterName = `Real Stress Cashier ${suffix}`;
        const kitchenPrinterName = `Real Stress Kitchen ${suffix}`;
        const cashBoxName = `Real Stress CashBox ${suffix}`;
        const posName = `Real Stress POS ${suffix}`;
        const kitchenCategoryName = `Stress Kitchen Cat ${suffix}`;
        const pickupCategoryName = `Stress Pickup Cat ${suffix}`;
        const kitchenProducts = [
            { name: `Lasagne ${suffix}`, shortName: `SL${suffix.slice(-3)}`, price: 7.00 },
            { name: `Polenta ${suffix}`, shortName: `SP${suffix.slice(-3)}`, price: 8.00 },
            { name: `Costine ${suffix}`, shortName: `SC${suffix.slice(-3)}`, price: 9.00 }
        ];
        const pickupProducts = [
            { name: `Pane ${suffix}`, shortName: `SB${suffix.slice(-3)}`, price: 4.00 },
            { name: `Acqua ${suffix}`, shortName: `SA${suffix.slice(-3)}`, price: 2.00 }
        ];
        const openingFloatAmount = 100;
        const orderPlan = buildDeterministicOrderPlan(
            [
                ...kitchenProducts.map((product) => ({ name: product.shortName, price: product.price })),
                ...pickupProducts.map((product) => ({ name: product.shortName, price: product.price }))
            ],
            50
        );
        const expectedClosingCash = Number((openingFloatAmount + orderPlan.expectedCashTotal).toFixed(2));

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
            for (const product of kitchenProducts) {
                await createProduct(page, kitchenCategoryName, {
                    name: product.name,
                    shortName: product.shortName,
                    price: product.price.toFixed(2)
                });
            }

            await createCategory(page, pickupCategoryName);
            for (const product of pickupProducts) {
                await createProduct(page, pickupCategoryName, {
                    name: product.name,
                    shortName: product.shortName,
                    price: product.price.toFixed(2)
                });
            }

            await openPosAndSelectDevice(page, posName);
            await openCashSessionIfRequired(page, openingFloatAmount.toFixed(2));

            for (const order of orderPlan.orders) {
                await completeCashOrder(page, order);
            }

            await closeCashSession(page, expectedClosingCash.toFixed(2));

            const expectedOrderPrintJobs = orderPlan.orders.reduce((sum, order) => {
                const hasKitchenItems = order.some((item) => kitchenProducts.some((product) => product.shortName === item.name));
                const hasPickupItems = order.some((item) => pickupProducts.some((product) => product.shortName === item.name));
                return sum + 1 + (hasKitchenItems ? 1 : 0) + (hasKitchenItems ? 1 : 0) + (hasPickupItems ? 1 : 0);
            }, 0);

            const findMatchedJobs = async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=250");
                if (!response.ok()) return null;

                const payload = await response.json() as AdminPrintJobPayload;
                const jobs = payload.jobs || [];
                const sentOrderJobs = jobs.filter((job) => job.source === "ORDER" && job.status === "SENT");
                const closingJobs = jobs.filter((job) =>
                    job.source === "CASH_SESSION"
                    && job.status === "SENT"
                    && job.printType === "CASH_SESSION_SUMMARY"
                    && job.destinationHost === realPrint.cashierHost
                    && job.destinationPort === realPrint.cashierPort
                );

                const closingJobHasItems = (closingJobs[0]?.document?.items || []).length > 0;

                if (sentOrderJobs.length < expectedOrderPrintJobs || closingJobs.length !== 1 || !closingJobHasItems) {
                    return null;
                }

                return {
                    sentOrderJobs,
                    closingJobs
                };
            };

            await expect.poll(async () => Boolean(await findMatchedJobs()), {
                timeout: Math.max(realPrint.timeoutMs, 120000)
            }).toBe(true);

            const matchedJobs = await findMatchedJobs();
            expect(matchedJobs).not.toBeNull();

            await expectPrinterWebStatusHealthy(page, "Kitchen printer", realPrint.kitchenHost);
            await expectPrinterWebStatusHealthy(page, "Cashier printer", realPrint.cashierHost);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
