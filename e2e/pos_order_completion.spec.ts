import { test, expect, type Page } from "@playwright/test";

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createAndActivateEvent(
    page: Page,
    eventName: string,
    options?: { askTable?: boolean; askName?: boolean; predefinedTables?: string[] }
) {
    await page.goto("/admin/settings/events");

    await page.click("#new-event-btn");
    const dialog = page.getByRole("dialog");
    await page.fill("#name", eventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(eventName)).toBeVisible();

    await page.click('[data-testid="admin-event-selector"]');
    await page.getByRole("option", { name: new RegExp(eventName) }).click();
    await expect(page.getByTestId("admin-event-selector")).toContainText(eventName);

    await page.goto("/admin/settings");
    const activeCheckbox = page.locator('input[name="active"]');
    if (!(await activeCheckbox.isChecked())) {
        await activeCheckbox.check();
    }

    const askTableCheckbox = page.locator('input[name="askTable"]');
    if (options?.askTable) {
        if (!(await askTableCheckbox.isChecked())) await askTableCheckbox.check();
    } else {
        if (await askTableCheckbox.isChecked()) await askTableCheckbox.uncheck();
    }

    const askNameCheckbox = page.locator('input[name="askName"]');
    if (options?.askName) {
        if (!(await askNameCheckbox.isChecked())) await askNameCheckbox.check();
    } else {
        if (await askNameCheckbox.isChecked()) await askNameCheckbox.uncheck();
    }

    const predefinedTables = options?.predefinedTables ?? [];
    if (predefinedTables.length > 0) {
        await page.getByRole("button", { name: /Importa Elenco/i }).click();
        await page.locator("#bulk-predefined-tables").fill(predefinedTables.join("\n"));
        await page.getByRole("button", { name: /Importa in Lista/i }).click();
    }

    await page.getByRole("button", { name: /Salva Impostazioni/i }).click();
    await expect(page.getByText(/Modifiche salvate/i)).toBeVisible();
}

async function configureHardwareForCashPos(
    page: Page,
    printerName: string,
    printerIp: string,
    cashBoxName: string,
    posName: string
) {
    await page.goto("/admin/settings/hardware");

    await page.getByRole("button", { name: /Nuova Stampante/i }).click();
    const printerDialog = page.getByRole("dialog");
    await printerDialog.getByLabel("Nome Stampante").fill(printerName);
    await printerDialog.getByLabel("Indirizzo IP").fill(printerIp);
    await printerDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
    await page.getByRole("option", { name: "Cassa (Scontrino Cliente)" }).click();
    await printerDialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(printerName)).toBeVisible();

    await page.getByRole("tab", { name: "Periferiche" }).click();
    await page.getByRole("button", { name: /Nuova Periferica/i }).click();
    const peripheralDialog = page.getByRole("dialog");
    await peripheralDialog.getByLabel("Nome Descrittivo").fill(cashBoxName);
    await peripheralDialog.getByRole("combobox", { name: "Tipo Periferica" }).click();
    await page.getByRole("option", { name: "Cassetta Contanti (Manuale)" }).click();
    await peripheralDialog.getByRole("button", { name: "Aggiungi Periferica", exact: true }).click();
    await expect(page.getByText(cashBoxName)).toBeVisible();

    await page.goto("/admin/settings/pos");
    await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
    const posDialog = page.getByRole("dialog");
    await posDialog.getByLabel("Nome Postazione").fill(posName);
    await posDialog.getByRole("combobox", { name: "Stampante Associata" }).click();
    await page.getByRole("option", { name: new RegExp(printerName) }).click();
    await posDialog.getByRole("combobox", { name: "Cassetta Contanti (Manuale)" }).click();
    await page.getByRole("option", { name: new RegExp(cashBoxName) }).click();
    await posDialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(posName)).toBeVisible();
}

async function createCatalogProduct(page: Page, categoryName: string, productName: string, price: string) {
    await page.goto("/admin/catalog");

    await page.click("#new-category-btn");
    await page.fill("#cat-name", categoryName);
    await page.getByRole("button", { name: "Salva Categoria", exact: true }).click();
    await expect(page.getByText(categoryName)).toBeVisible();

    await page.click("#new-product-btn");
    await page.fill("#prod-name", productName);
    await page.fill('input[name="basePrice"]', price);
    await page.locator('select[name="categoryId"]').selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
    await expect(page.getByText(productName)).toBeVisible();
}

async function createWebOrderAndGetCode(
    page: Page,
    productName: string,
    options?: { tableCode?: string; usePresetTable?: boolean }
) {
    await page.goto("/menu");
    await page.waitForResponse(
        response => response.url().includes("/api/pos/init") && response.ok(),
        { timeout: 10000 }
    );

    const setupResult = await page.evaluate(async (targetProductName: string) => {
        const response = await fetch("/api/pos/init");
        const data = await response.json();
        const product = (data.products || []).find((p: { name: string }) => p.name === targetProductName);

        if (!data.event?._id || !product?._id) {
            return { success: false };
        }

        localStorage.setItem("osg_eventId", data.event._id);
        localStorage.setItem(
            "osg_cart",
            JSON.stringify([
                {
                    _id: product._id,
                    name: product.name,
                    basePrice: product.basePrice,
                    quantity: 1
                }
            ])
        );

        return { success: true };
    }, productName);

    expect(setupResult.success).toBeTruthy();

    await page.goto("/menu/checkout");
    await expect(page.getByRole("button", { name: /INVIA ORDINE/i })).toBeVisible();
    if (options?.tableCode) {
        const tableCode = options.tableCode.toUpperCase();
        const tableInput = page.getByPlaceholder("Es: B02 oppure VIP TERRAZZA");
        await expect(tableInput).toBeVisible();

        if (options.usePresetTable) {
            await page.getByRole("button", { name: tableCode, exact: true }).click();
        } else {
            await tableInput.fill(tableCode);
        }

        await expect(
            page.getByText(new RegExp(`Tavolo selezionato:\\s*${escapeRegExp(tableCode)}`, "i"))
        ).toBeVisible();
    }
    await page.getByRole("button", { name: /INVIA ORDINE/i }).click();

    await expect(page).toHaveURL(/\/menu\/success\?code=/);
    const successUrl = new URL(page.url());
    const code = successUrl.searchParams.get("code");
    expect(code).toBeTruthy();
    return code as string;
}

async function openPosAndSelectDevice(page: Page, posName: string) {
    await page.goto("/pos");
    await page.evaluate(() => localStorage.removeItem("osgfest_pos_id"));
    await page.reload();

    await page.waitForResponse(
        response => response.url().includes("/api/pos/init") && response.ok(),
        { timeout: 10000 }
    );

    const selectorTitle = page.getByText(/In quale cassa sei\?/i);
    if (await selectorTitle.isVisible()) {
        const posButton = page.getByRole("dialog").locator("button").filter({ hasText: new RegExp(posName) }).first();
        await expect(posButton).toBeVisible();
        await posButton.click();
        await expect(selectorTitle).toBeHidden();
    }

    await expect(page.getByRole("button", { name: new RegExp(`Postazione: ${posName}`) })).toBeVisible();
}

test.describe("POS - Completamento ordine da codice", () => {
    test("chiude un ordine WebApp da POS usando il codice", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso completo validato su desktop.");

        const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const eventName = `POS Code Event ${uniqueSuffix}`;
        const cashierPrinterName = `Cashier ${uniqueSuffix}`;
        const cashBoxName = `CashBox ${uniqueSuffix}`;
        const posName = `POS ${uniqueSuffix}`;
        const categoryName = `Cat ${uniqueSuffix}`;
        const productName = `Product ${uniqueSuffix}`;
        const productPrice = "8.00";
        const tableCode = "B07";
        const overrideTableCode = "C12";
        const customTableName = "VIP TERRAZZA 1";

        await createAndActivateEvent(page, eventName, {
            askTable: true,
            predefinedTables: [tableCode, overrideTableCode, "A01"]
        });
        await configureHardwareForCashPos(page, cashierPrinterName, `192.168.1.${Math.floor(Math.random() * 150) + 50}`, cashBoxName, posName);
        await createCatalogProduct(page, categoryName, productName, productPrice);

        const orderCode = await createWebOrderAndGetCode(page, productName, { tableCode, usePresetTable: true });

        await openPosAndSelectDevice(page, posName);

        const dialogMessages: string[] = [];
        page.on("dialog", async dialog => {
            dialogMessages.push(dialog.message());
            await dialog.accept();
        });

        await page.getByRole("button", { name: /Carica ordine da codice/i }).click();
        const loadDialog = page.getByRole("dialog").filter({ hasText: /Carica ordine da codice/i });
        await loadDialog.getByLabel(/Codice ordine/i).fill(orderCode);
        await loadDialog.getByRole("button", { name: /Carica Ordine/i }).click();

        await expect(page.getByText(new RegExp(`Codice ${orderCode}`, "i"))).toBeVisible();
        await expect(page.getByText(new RegExp(`Tavolo ${tableCode}`, "i"))).toBeVisible();

        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
        await expect(checkoutDialog).toBeVisible();
        await expect(checkoutDialog.getByText(/^Tavolo$/i)).toBeVisible();

        const tableInput = checkoutDialog.getByPlaceholder("Es: B02 oppure VIP TERRAZZA");
        await expect(tableInput).toHaveValue(tableCode);

        await checkoutDialog.getByRole("button", { name: overrideTableCode, exact: true }).click();
        await expect(
            checkoutDialog.getByText(new RegExp(`Tavolo selezionato:\\s*${overrideTableCode}`, "i"))
        ).toBeVisible();

        const confirmButton = checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true });
        await checkoutDialog.getByRole("button", { name: "RESET", exact: true }).click();
        await expect(checkoutDialog.getByText(/Tavolo selezionato:\s*---/i)).toBeVisible();
        await expect(confirmButton).toBeDisabled();

        await tableInput.fill(customTableName);
        await expect(
            checkoutDialog.getByText(new RegExp(`Tavolo selezionato:\\s*${escapeRegExp(customTableName)}`, "i"))
        ).toBeVisible();

        await expect(checkoutDialog.getByText(/CONTANTI/i)).toBeVisible();
        await expect(checkoutDialog.getByText(/CARTA \/ POS/i)).toHaveCount(0);

        await confirmButton.scrollIntoViewIfNeeded();
        await confirmButton.click();
        await expect(checkoutDialog.getByText(/Stampa in corso/i)).toBeVisible();
        await expect(checkoutDialog.getByText(/Simulazione stampa attiva/i)).toBeVisible();
        await expect.poll(() => dialogMessages.join(" | ")).toContain("Ordine completato correttamente");
        await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible();

        await page.getByRole("button", { name: /Carica ordine da codice/i }).click();
        const pendingDialog = page.getByRole("dialog").filter({ hasText: /Carica ordine da codice/i });
        await expect(pendingDialog.getByText(/Nessun ordine pendente disponibile/i)).toBeVisible();

        await page.goto("/admin/orders");
        await expect(page.getByText(productName)).toBeVisible();
    });
});
