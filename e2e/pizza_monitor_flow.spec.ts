import { expect, test, type Page } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    configureCashPos,
    createAndActivateEvent,
    createCategory,
    createPrinter,
    createProduct,
    deleteEvent,
    dismissFeedbackModal,
    localPrinterIp,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures";

interface PrintJobsPayload {
    jobs?: Array<{
        printType?: string;
        document?: {
            orderId?: string;
            pizzaNumber?: number;
            pizzaBarcodeValue?: string;
        };
    }>;
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
    expect(code).toBeTruthy();
    expect(orderId).toBeTruthy();

    return {
        code: code as string,
        orderId: orderId as string
    };
}

test.describe.serial("Pizza monitor flow", () => {
    const createdEvents: string[] = [];

    test.afterEach(async ({ page }) => {
        const eventName = createdEvents.pop();
        if (!eventName) return;
        await deleteEvent(page, eventName);
    });

    test("assegna il numero pizza, stampa il barcode reparto e aggiorna console e monitor", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");
        test.setTimeout(120000);

        const suffix = uniqueSuffix();
        const eventName = `Pizza Flow ${suffix}`;
        const cashierPrinterName = `Cashier ${suffix}`;
        const kitchenPrinterName = `Forno ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const pizzaCategoryName = `Pizze ${suffix}`;
        const drinkCategoryName = `Bar ${suffix}`;
        const pizzaProductName = `Margherita ${suffix}`;
        const drinkProductName = `Cola ${suffix}`;
        const pizzaShortName = `PZ${suffix.slice(-4)}`;

        await ensureAdminAuthenticated(page, "/admin");
        await createAndActivateEvent(page, eventName);
        createdEvents.push(eventName);
        await configureCashPos(page, cashierPrinterName, localPrinterIp(), cashBoxName, posName);
        await createPrinter(page, kitchenPrinterName, localPrinterIp(), {
            printerType: "KITCHEN",
            printerPort: "19101"
        });
        await createCategory(page, pizzaCategoryName, {
            kitchenPrinterName,
            pizzaFlowEnabled: true
        });
        await createCategory(page, drinkCategoryName);
        await createProduct(page, pizzaCategoryName, {
            name: pizzaProductName,
            shortName: pizzaShortName,
            price: "8.00"
        });
        await createProduct(page, drinkCategoryName, {
            name: drinkProductName,
            price: "3.00"
        });

        const { code, orderId } = await createWebOrderAndGetOrderData(page, [
            { name: pizzaProductName, quantity: 1 },
            { name: drinkProductName, quantity: 1 }
        ]);

        const summaryResponse = await page.request.get(`/api/public/orders/${orderId}/summary?code=${encodeURIComponent(code)}`);
        expect(summaryResponse.ok()).toBe(true);
        const summaryPayload = await summaryResponse.json() as { summary?: { pizzaNumber?: number } };
        const pizzaNumber = summaryPayload.summary?.pizzaNumber;
        expect(pizzaNumber).toBeTruthy();

        await expect(page.getByTestId("menu-success-pizza-card")).toBeVisible();
        await expect(page.getByTestId("menu-success-pizza-number")).toHaveText(String(pizzaNumber));
        await expect(page.getByTestId("menu-success-general-order-code")).toHaveText(code);

        await page.goto("/pizza-console");
        await expect(page.getByText(/Nessuna pizza in coda/i)).toBeVisible({ timeout: 15000 });

        await openPosAndSelectDevice(page, posName);
        await openCashSessionIfRequired(page);
        await page.getByRole("button", { name: /Carica ordine da codice/i }).click();
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
            if (!response.ok()) return 0;
            const payload = await response.json() as PrintJobsPayload;
            return (payload.jobs || []).filter((job) => job.document?.orderId === orderId).length;
        }, { timeout: 20000 }).toBeGreaterThanOrEqual(3);

        const printJobsResponse = await page.request.get("/api/admin/print-jobs?limit=20");
        const printJobsPayload = await printJobsResponse.json() as PrintJobsPayload;
        const orderJobs = (printJobsPayload.jobs || []).filter((job) => job.document?.orderId === orderId);
        const kitchenJob = orderJobs.find((job) => job.printType === "KITCHEN_ORDER");
        const cashierJob = orderJobs.find((job) => job.printType === "CASHIER_SUMMARY");
        const customerJob = orderJobs.find((job) => job.printType === "CUSTOMER_ORDER");

        expect(kitchenJob?.document?.pizzaNumber).toBe(pizzaNumber);
        expect(kitchenJob?.document?.pizzaBarcodeValue).toBe(`PZ:${orderId}`);
        expect(cashierJob?.document?.pizzaNumber).toBe(pizzaNumber);
        expect(cashierJob?.document?.pizzaBarcodeValue).toBeUndefined();
        expect(customerJob?.document?.pizzaNumber).toBe(pizzaNumber);
        expect(customerJob?.document?.pizzaBarcodeValue).toBeUndefined();

        await page.goto("/pizza-console");
        await expect(page.getByTestId(`pizza-console-queued-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });
        await page.getByTestId("pizza-console-scanner-input").fill(`PZ:${orderId}`);
        await page.getByTestId("pizza-console-scanner-input").press("Enter");

        await expect(page.getByTestId(`pizza-console-ready-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId(`pizza-console-queued-${pizzaNumber}`)).toHaveCount(0);

        await page.goto("/pizza-monitor");
        await expect(page.getByTestId(`pizza-monitor-number-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });
    });
});
