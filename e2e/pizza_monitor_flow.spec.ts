import { expect, test, type Page } from "@playwright/test";
import { getPizzaBarcodeValue } from "@/lib/pizza-barcode";
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

test.describe.serial("Flusso preparazioni numerate", () => {
    const createdEvents: string[] = [];

    test.afterEach(async ({ page }) => {
        const eventName = createdEvents.pop();
        if (!eventName) return;
        await deleteEvent(page, eventName);
    });

    test("condivide un numero tra pizza e calamari, stampa i reparti e aggiorna console e monitor", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");
        test.setTimeout(120000);

        const suffix = uniqueSuffix();
        const eventName = `Pizza Flow ${suffix}`;
        const cashierPrinterName = `Cashier ${suffix}`;
        const pizzaPrinterName = `Forno ${suffix}`;
        const calamariPrinterName = `Friggitoria ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const pizzaCategoryName = `Pizze ${suffix}`;
        const calamariCategoryName = `Calamari ${suffix}`;
        const pizzaProductName = `Margherita ${suffix}`;
        const calamariProductName = `Calamari fritti ${suffix}`;
        const pizzaShortName = `PZ${suffix.slice(-4)}`;
        const calamariShortName = `CAL${suffix.slice(-4)}`;

        await ensureAdminAuthenticated(page, "/admin");
        await createAndActivateEvent(page, eventName);
        createdEvents.push(eventName);
        await configureCashPos(page, cashierPrinterName, localPrinterIp(), cashBoxName, posName);
        await createPrinter(page, pizzaPrinterName, localPrinterIp(), {
            printerType: "KITCHEN",
            printerPort: "19101"
        });
        await createPrinter(page, calamariPrinterName, localPrinterIp(), {
            printerType: "KITCHEN",
            printerPort: "19102"
        });
        await createCategory(page, pizzaCategoryName, {
            kitchenPrinterName: pizzaPrinterName,
            pizzaFlowEnabled: true
        });
        await createCategory(page, calamariCategoryName, {
            kitchenPrinterName: calamariPrinterName,
            pizzaFlowEnabled: true
        });
        await createProduct(page, pizzaCategoryName, {
            name: pizzaProductName,
            shortName: pizzaShortName,
            price: "8.00"
        });
        await createProduct(page, calamariCategoryName, {
            name: calamariProductName,
            shortName: calamariShortName,
            price: "9.00"
        });

        const { code, orderId, accessToken } = await createWebOrderAndGetOrderData(page, [
            { name: pizzaProductName, quantity: 1 },
            { name: calamariProductName, quantity: 1 }
        ]);

        const summaryResponse = await page.request.get(`/api/public/orders/${orderId}/summary?code=${encodeURIComponent(accessToken)}`);
        expect(summaryResponse.ok()).toBe(true);
        const summaryPayload = await summaryResponse.json() as {
            summary?: { dishTickets?: Array<{ productId: string; productName: string; pizzaNumber: number }> }
        };
        const dishTickets = summaryPayload.summary?.dishTickets || [];
        expect(dishTickets).toHaveLength(2);
        const pizzaTicket = dishTickets.find((ticket) => ticket.productName === pizzaProductName)!;
        const calamariTicket = dishTickets.find((ticket) => ticket.productName === calamariProductName)!;
        expect(pizzaTicket).toBeTruthy();
        expect(calamariTicket).toBeTruthy();
        expect(Math.abs(pizzaTicket.pizzaNumber - calamariTicket.pizzaNumber)).toBe(1);

        await expect(page.getByTestId("menu-success-pizza-card")).toBeVisible();
        await expect(page.getByTestId(`menu-success-dish-ticket-${pizzaTicket.productId}`)).toContainText(`${pizzaProductName}${pizzaTicket.pizzaNumber}`);
        await expect(page.getByTestId(`menu-success-dish-ticket-${calamariTicket.productId}`)).toContainText(`${calamariProductName}${calamariTicket.pizzaNumber}`);
        await expect(page.getByTestId("menu-success-general-order-code")).toHaveText(code);

        await page.goto("/pizza-console");
        await expect(page.getByText("Console preparazioni", { exact: true })).toBeVisible();
        await expect(page.getByText(/Nessun piatto in coda/i)).toBeVisible({ timeout: 15000 });

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
        }, { timeout: 20000 }).toBeGreaterThanOrEqual(5);

        const printJobsResponse = await page.request.get("/api/admin/print-jobs?limit=20");
        const printJobsPayload = await printJobsResponse.json() as PrintJobsPayload;
        const orderJobs = (printJobsPayload.jobs || []).filter((job) => job.document?.orderId === orderId);
        const kitchenJobs = orderJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const cashierJob = orderJobs.find((job) => job.printType === "CASHIER_SUMMARY");
        const customerJobs = orderJobs.filter((job) => job.printType === "CUSTOMER_ORDER");
        const expectedNumbers = dishTickets.map((ticket) => ticket.pizzaNumber).sort((a, b) => a - b);
        const expectedBarcodes = expectedNumbers.map(getPizzaBarcodeValue);

        expect(kitchenJobs).toHaveLength(2);
        expect(kitchenJobs.map((job) => job.document?.pizzaNumber).sort()).toEqual(expectedNumbers);
        expect(kitchenJobs.map((job) => job.document?.pizzaBarcodeValue).sort()).toEqual(expectedBarcodes);
        expect(cashierJob?.document?.pizzaNumber).toBeUndefined();
        expect(cashierJob?.document?.pizzaBarcodeValue).toBeUndefined();
        expect(customerJobs).toHaveLength(2);
        expect(customerJobs.map((job) => job.document?.pizzaNumber).sort()).toEqual(expectedNumbers);
        expect(customerJobs.every((job) => job.document?.pizzaBarcodeValue === undefined)).toBe(true);

        await page.goto("/pizza-console");
        await expect(page.getByTestId(`pizza-console-queued-${pizzaTicket.pizzaNumber}`)).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId(`pizza-console-queued-${calamariTicket.pizzaNumber}`)).toBeVisible();
        await page.getByTestId("pizza-console-scanner-input").fill(getPizzaBarcodeValue(pizzaTicket.pizzaNumber));
        await page.getByTestId("pizza-console-scanner-input").press("Enter");

        await expect(page.getByTestId(`pizza-console-ready-${pizzaTicket.pizzaNumber}`)).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId(`pizza-console-queued-${pizzaTicket.pizzaNumber}`)).toHaveCount(0);
        await expect(page.getByTestId(`pizza-console-queued-${calamariTicket.pizzaNumber}`)).toBeVisible();
        await page.getByTestId("pizza-console-scanner-input").fill(getPizzaBarcodeValue(calamariTicket.pizzaNumber));
        await page.getByTestId("pizza-console-scanner-input").press("Enter");
        await expect(page.getByTestId(`pizza-console-ready-${calamariTicket.pizzaNumber}`)).toBeVisible({ timeout: 15000 });

        await page.goto("/pizza-monitor");
        await expect(page.getByText("Monitor preparazioni", { exact: true })).toBeVisible();
        await expect(page.getByText("Piatto pronto per il ritiro", { exact: true })).toBeVisible();
        await expect(page.getByTestId(`pizza-monitor-number-${pizzaTicket.pizzaNumber}`)).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId(`pizza-monitor-number-${calamariTicket.pizzaNumber}`)).toBeVisible();
    });

    test("permette di rimuovere manualmente ticket in coda e ticket pronti", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");
        test.setTimeout(120000);

        const suffix = uniqueSuffix();
        const eventName = `Pizza Remove ${suffix}`;
        const cashierPrinterName = `Cashier ${suffix}`;
        const kitchenPrinterName = `Forno ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const pizzaCategoryName = `Pizze ${suffix}`;
        const pizzaProductName = `Margherita ${suffix}`;
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
        await createProduct(page, pizzaCategoryName, {
            name: pizzaProductName,
            shortName: pizzaShortName,
            price: "8.00"
        });

        const { code, orderId, accessToken } = await createWebOrderAndGetOrderData(page, [
            { name: pizzaProductName, quantity: 1 }
        ]);

        const summaryResponse = await page.request.get(`/api/public/orders/${orderId}/summary?code=${encodeURIComponent(accessToken)}`);
        expect(summaryResponse.ok()).toBe(true);
        const summaryPayload = await summaryResponse.json() as { summary?: { dishTickets?: Array<{ pizzaNumber: number }> } };
        const pizzaNumber = summaryPayload.summary?.dishTickets?.[0]?.pizzaNumber;
        expect(pizzaNumber).toBeTruthy();
        if (!pizzaNumber) throw new Error("Numero piatto mancante");

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

        await page.goto("/pizza-console");
        await expect(page.getByTestId(`pizza-console-queued-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });
        await page.getByTestId(`pizza-console-remove-queued-${pizzaNumber}`).click();
        await expect(page.getByTestId(`pizza-console-queued-${pizzaNumber}`)).toHaveCount(0);

        await page.getByTestId("pizza-console-scanner-input").fill(getPizzaBarcodeValue(pizzaNumber));
        await page.getByTestId("pizza-console-scanner-input").press("Enter");
        await expect(page.getByTestId(`pizza-console-ready-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });

        await page.goto("/pizza-monitor");
        await expect(page.getByTestId(`pizza-monitor-number-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });

        await page.goto("/pizza-console");
        await page.getByTestId(`pizza-console-remove-ready-${pizzaNumber}`).click();
        await expect(page.getByTestId(`pizza-console-ready-${pizzaNumber}`)).toHaveCount(0);

        await page.goto("/pizza-monitor");
        await expect(page.getByTestId(`pizza-monitor-number-${pizzaNumber}`)).toHaveCount(0);
    });

    test("gestisce il flusso pizza anche senza stampante reparto dedicata", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");
        test.setTimeout(120000);

        const suffix = uniqueSuffix();
        const eventName = `Pizza Cliente ${suffix}`;
        const cashierPrinterName = `Cashier ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const pizzaCategoryName = `Pizze ${suffix}`;
        const pizzaProductName = `Margherita ${suffix}`;
        const pizzaShortName = `PZ${suffix.slice(-4)}`;

        await ensureAdminAuthenticated(page, "/admin");
        await createAndActivateEvent(page, eventName);
        createdEvents.push(eventName);
        await configureCashPos(page, cashierPrinterName, localPrinterIp(), cashBoxName, posName);
        await createCategory(page, pizzaCategoryName, {
            pizzaFlowEnabled: true
        });
        await createProduct(page, pizzaCategoryName, {
            name: pizzaProductName,
            shortName: pizzaShortName,
            price: "8.00"
        });

        const { code, orderId, accessToken } = await createWebOrderAndGetOrderData(page, [
            { name: pizzaProductName, quantity: 1 }
        ]);

        const summaryResponse = await page.request.get(`/api/public/orders/${orderId}/summary?code=${encodeURIComponent(accessToken)}`);
        expect(summaryResponse.ok()).toBe(true);
        const summaryPayload = await summaryResponse.json() as { summary?: { dishTickets?: Array<{ pizzaNumber: number }> } };
        const pizzaNumber = summaryPayload.summary?.dishTickets?.[0]?.pizzaNumber;
        expect(pizzaNumber).toBeTruthy();
        if (!pizzaNumber) throw new Error("Numero piatto mancante");

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
        }, { timeout: 20000 }).toBeGreaterThanOrEqual(2);

        const printJobsResponse = await page.request.get("/api/admin/print-jobs?limit=20");
        const printJobsPayload = await printJobsResponse.json() as PrintJobsPayload;
        const orderJobs = (printJobsPayload.jobs || []).filter((job) => job.document?.orderId === orderId);
        const kitchenJob = orderJobs.find((job) => job.printType === "KITCHEN_ORDER");
        const cashierJob = orderJobs.find((job) => job.printType === "CASHIER_SUMMARY");
        const customerJob = orderJobs.find((job) => job.printType === "CUSTOMER_ORDER");

        expect(kitchenJob).toBeUndefined();
        expect(cashierJob?.document?.pizzaNumber).toBeUndefined();
        expect(cashierJob?.document?.pizzaBarcodeValue).toBeUndefined();
        expect(customerJob?.document?.pizzaNumber).toBe(pizzaNumber);
        expect(customerJob?.document?.pizzaBarcodeValue).toBe(getPizzaBarcodeValue(pizzaNumber));

        await page.goto("/pizza-console");
        await expect(page.getByTestId(`pizza-console-queued-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });
        await page.getByRole("button", { name: "Segna pronta", exact: true }).click();
        await expect(page.getByTestId(`pizza-console-ready-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });

        await page.goto("/pizza-monitor");
        await expect(page.getByTestId(`pizza-monitor-number-${pizzaNumber}`)).toBeVisible({ timeout: 15000 });
    });
});
