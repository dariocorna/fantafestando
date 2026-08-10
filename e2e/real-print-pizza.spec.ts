import { expect, test, type Page } from "@playwright/test";
import { getPizzaBarcodeValue } from "@/lib/pizza-barcode";
import { ensureAdminAuthenticated } from "./utils/auth";
import { cleanupEventArtifactsByName } from "./utils/db";
import {
    configureCashPos,
    createAndActivateEvent,
    createCategory,
    createProduct,
    dismissFeedbackModal,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";

interface PrintJobsPayload {
    jobs?: Array<{
        status?: string;
        source?: string;
        printType?: string;
        destinationHost?: string;
        destinationPort?: number;
        document?: {
            orderId?: string;
            pizzaNumber?: number;
            pizzaBarcodeValue?: string;
        };
    }>;
}

function parsePort(value: string | undefined, fallback: number): number {
    const normalized = Number.parseInt((value || "").trim(), 10);
    return Number.isInteger(normalized) && normalized > 0 && normalized <= 65535
        ? normalized
        : fallback;
}

function readTrimmedEnv(name: string): string {
    return (process.env[name] || "").trim();
}

async function createWebOrderAndGetOrderData(
    page: Page,
    items: Array<{ name: string; quantity: number }>
) {
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("menu-brand-shell")).toBeVisible({ timeout: 20000 });

    const setupResult = await page.evaluate(async (orderItems: Array<{ name: string; quantity: number }>) => {
        const response = await fetch("/api/pos/init?channel=menu");
        const data = await response.json();
        type MenuProductPayload = {
            _id: string;
            name: string;
            basePrice: number;
            categoryId?: string;
            kind?: string;
        };

        const productsByName = new Map<string, MenuProductPayload>(
            (data.products || []).map((product: MenuProductPayload) => [product.name, product])
        );

        const normalizedItems = orderItems.map((entry) => {
            const product = productsByName.get(entry.name);
            if (!product) {
                throw new Error(`Missing product ${entry.name}`);
            }

            return {
                lineId: `${product._id}-${entry.name}`,
                _id: product._id,
                name: product.name,
                basePrice: product.basePrice,
                quantity: entry.quantity,
                categoryId: product.categoryId,
                kind: product.kind || "STANDARD",
            };
        });

        if (!data.event?._id) {
            return { success: false };
        }

        localStorage.setItem("osg_eventId", data.event._id);
        localStorage.setItem("osg_cart", JSON.stringify({
            eventId: data.event._id,
            items: normalizedItems,
        }));
        return { success: true };
    }, items);

    expect(setupResult.success).toBeTruthy();

    await page.reload();
    await page.getByRole("button", { name: /Vedi Carrello/i }).click();
    await expect(page.getByTestId("menu-submit-order")).toBeVisible();
    await page.getByTestId("menu-submit-order").click();

    await expect(page).toHaveURL(/\/menu\/success\?code=/, { timeout: 20000 });
    const currentUrl = new URL(page.url());
    const code = currentUrl.searchParams.get("code");
    const orderId = currentUrl.searchParams.get("orderId");
    const accessToken = currentUrl.searchParams.get("token");
    expect(code).toBeTruthy();
    expect(orderId).toBeTruthy();
    expect(accessToken).toBeTruthy();

    return {
        code: code as string,
        orderId: orderId as string,
        accessToken: accessToken as string
    };
}

test.describe("Real Pizza Printing", () => {
    test.describe.configure({ timeout: 120000 });

    test("prints the pizza customer copy on a real cashier printer", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const enabled = readTrimmedEnv("ENABLE_REAL_PRINT_TESTS") === "1";
        const cashierHost = readTrimmedEnv("REAL_PRINT_CASHIER_HOST");
        const cashierPort = parsePort(process.env.REAL_PRINT_CASHIER_PORT, 9100);

        test.skip(!enabled, "Suite reale disabilitata: imposta ENABLE_REAL_PRINT_TESTS=1.");
        test.skip(!cashierHost, "Suite reale disabilitata: imposta REAL_PRINT_CASHIER_HOST.");

        const suffix = uniqueSuffix();
        const eventName = `Real Pizza Customer ${suffix}`;
        const cashierPrinterName = `Real Pizza Cashier ${suffix}`;
        const cashBoxName = `Real Pizza CashBox ${suffix}`;
        const posName = `Real Pizza POS ${suffix}`;
        const pizzaCategoryName = `Pizze ${suffix}`;
        const pizzaProductName = `Margherita ${suffix}`;
        const pizzaShortName = `PZ${suffix.slice(-4)}`;

        await ensureAdminAuthenticated(page, "/admin");

        try {
            await createAndActivateEvent(page, eventName);
            await configureCashPos(
                page,
                cashierPrinterName,
                cashierHost,
                cashBoxName,
                posName,
                { printerPort: String(cashierPort) }
            );
            await createCategory(page, pizzaCategoryName, {
                pizzaFlowEnabled: true,
                pizzaBarcodeEnabled: true
            });
            await createProduct(page, pizzaCategoryName, {
                name: pizzaProductName,
                shortName: pizzaShortName,
                price: "8.00"
            });

            const { code, orderId, accessToken } = await createWebOrderAndGetOrderData(page, [
                { name: pizzaProductName, quantity: 1 }
            ]);

            const summaryResponse = await page.request.get(
                `/api/public/orders/${orderId}/summary?code=${encodeURIComponent(accessToken)}`
            );
            expect(summaryResponse.ok()).toBe(true);
            const summaryPayload = await summaryResponse.json() as { summary?: { dishTickets?: Array<{ pizzaNumber: number }> } };
            const pizzaNumber = summaryPayload.summary?.dishTickets?.[0]?.pizzaNumber;
            expect(pizzaNumber).toBeTruthy();
            if (!pizzaNumber) throw new Error("Numero piatto mancante");

            await openPosAndSelectDevice(page, posName);
            await openCashSessionIfRequired(page);
            await page.getByRole("button", { name: "Codice", exact: true }).click();
            const pendingDialog = page.getByRole("dialog").filter({ hasText: /Carica ordine da codice/i }).first();
            await expect(pendingDialog).toBeVisible();
            await pendingDialog.getByRole("textbox").fill(code);
            await pendingDialog.getByRole("button", { name: "Carica", exact: true }).click();

            await expect(page.getByText(new RegExp(`^Codice ${code}$`, "i"))).toBeVisible({ timeout: 15000 });
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i }).first();
            await expect(checkoutDialog).toBeVisible();
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click();
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 });
            await dismissFeedbackModal(page);

            await expect.poll(async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=20");
                if (!response.ok()) return null;
                const payload = await response.json() as PrintJobsPayload;
                return (payload.jobs || []).find((job) =>
                    job.source === "ORDER"
                    && job.status === "SENT"
                    && job.printType === "CUSTOMER_ORDER"
                    && job.destinationHost === cashierHost
                    && job.destinationPort === cashierPort
                    && job.document?.orderId === orderId
                ) || null;
            }, {
                timeout: 30000
            }).not.toBeNull();

            const jobsResponse = await page.request.get("/api/admin/print-jobs?limit=20");
            const jobsPayload = await jobsResponse.json() as PrintJobsPayload;
            const customerJob = (jobsPayload.jobs || []).find((job) =>
                job.source === "ORDER"
                && job.status === "SENT"
                && job.printType === "CUSTOMER_ORDER"
                && job.destinationHost === cashierHost
                && job.destinationPort === cashierPort
                && job.document?.orderId === orderId
            );

            expect(customerJob?.document?.pizzaNumber).toBe(pizzaNumber);
            expect(customerJob?.document?.pizzaBarcodeValue).toBe(getPizzaBarcodeValue(pizzaNumber));
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
