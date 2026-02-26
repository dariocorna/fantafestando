import { test, expect, type Page } from "@playwright/test";

async function createAndActivateEvent(page: Page, eventName: string) {
    await page.goto("/admin/settings/events");

    await page.click("#new-event-btn");
    const dialog = page.getByRole("dialog");
    await page.fill("#name", eventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(eventName)).toBeVisible();

    await page.click('[data-testid="admin-event-selector"]');
    await page.getByRole("option", { name: new RegExp(eventName) }).click();
    await expect(page.getByTestId("admin-event-selector")).toContainText(eventName);

    await page.goto("/admin/settings");
    const activeCheckbox = page.locator('input[name="active"]');
    if (!(await activeCheckbox.isChecked())) {
        await activeCheckbox.check();
    }
    await page.getByRole("button", { name: /Salva Impostazioni/i }).click();
    await expect(page.getByText(/Modifiche salvate/i)).toBeVisible();
}

async function createCashHardwareForPos(
    page: Page,
    printerName: string,
    printerIp: string,
    printerPort: string,
    cashBoxName: string,
    posName: string
) {
    await page.goto("/admin/settings/hardware");
    await page.getByRole("button", { name: /Nuova Stampante/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome Stampante").fill(printerName);
    await dialog.getByLabel("Indirizzo IP").fill(printerIp);
    await dialog.getByLabel("Porta TCP").fill(printerPort);
    await dialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
    await page.getByRole("option", { name: /Cassa \(Scontrino Cliente\)/i }).click();
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(printerName)).toBeVisible();

    await page.getByRole("tab", { name: "Periferiche" }).click();
    await page.getByRole("button", { name: /Nuova Periferica/i }).click();
    const periphDialog = page.getByRole("dialog");
    await periphDialog.getByLabel("Nome Descrittivo").fill(cashBoxName);
    await periphDialog.getByRole("combobox", { name: /Tipo Periferica/i }).click();
    await page.getByRole("option", { name: /Cassetta Contanti/i }).click();
    await periphDialog.getByRole("button", { name: /Aggiungi Periferica/i }).click();
    await expect(page.getByText(cashBoxName)).toBeVisible();

    await page.goto("/admin/settings/pos");
    await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
    const posDialog = page.getByRole("dialog");
    await posDialog.getByLabel("Nome Postazione").fill(posName);
    await posDialog.getByRole("combobox", { name: /Stampante Associata/i }).click();
    await page.getByRole("option", { name: new RegExp(printerName) }).click();
    await posDialog.getByRole("combobox", { name: /Cassetta Contanti/i }).click();
    await page.getByRole("option", { name: new RegExp(cashBoxName) }).click();
    await posDialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(posName)).toBeVisible();
}

async function createCatalogProduct(page: Page, categoryName: string, productName: string) {
    await page.goto("/admin/catalog");
    await page.click("#new-category-btn");
    await page.fill("#cat-name", categoryName);
    await page.getByRole("button", { name: "Salva Categoria", exact: true }).click();
    await expect(page.getByText(categoryName)).toBeVisible();

    await page.click("#new-product-btn");
    await page.fill("#prod-name", productName);
    await page.fill('input[name="basePrice"]', "5.00");
    await page.locator('select[name="categoryId"]').selectOption({ label: categoryName });
    await page.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
    await expect(page.getByText(productName)).toBeVisible();
}

async function selectPosDevice(page: Page, posName: string) {
    await page.goto("/pos");
    await page.evaluate(() => localStorage.removeItem("osgfest_pos_id"));
    await page.reload();

    await page.waitForResponse(
        (response) => response.url().includes("/api/pos/init") && response.ok(),
        { timeout: 10000 }
    );

    const selectorTitle = page.getByText(/In quale cassa sei\?/i);
    if (await selectorTitle.isVisible()) {
        const button = page.getByRole("dialog").locator("button").filter({ hasText: new RegExp(posName) }).first();
        await expect(button).toBeVisible();
        await button.click();
        await expect(selectorTitle).toBeHidden();
    }
}

async function openCashSessionIfRequired(page: Page) {
    const openButton = page.getByRole("button", { name: /Apri Cassa/i });
    if (!(await openButton.isVisible())) return;

    await openButton.click();
    const openDialog = page.getByRole("dialog").filter({ hasText: /Apertura Cassa/i });
    await openDialog.locator("#opening-float-amount").fill("0");
    await openDialog.getByRole("button", { name: "APRI CASSA", exact: true }).click();
    await expect(page.getByRole("button", { name: /Chiudi Cassa/i })).toBeVisible();
}

test.describe("Print Retry Flows", () => {
    test("admin monitor supports retry flow for failed jobs", async ({ page }) => {
        test.setTimeout(120000);
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const eventName = `Retry Admin ${suffix}`;
        const printerName = `A Retry Printer ${suffix}`;
        const cashBoxName = `A Retry CashBox ${suffix}`;
        const posName = `A Retry POS ${suffix}`;
        const categoryName = `A Retry Cat ${suffix}`;
        const productName = `A Retry Product ${suffix}`;

        await createAndActivateEvent(page, eventName);
        await createCashHardwareForPos(page, printerName, "127.0.0.1", "19199", cashBoxName, posName);
        await createCatalogProduct(page, categoryName, productName);

        await selectPosDevice(page, posName);
        await openCashSessionIfRequired(page);
        await page.locator("button").filter({ hasText: productName }).first().click();
        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click();
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 });

        const feedbackModal = page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i });
        if (await feedbackModal.isVisible()) {
            await feedbackModal.getByRole("button", { name: "OK", exact: true }).click();
            await expect(feedbackModal).toBeHidden();
        }

        await page.goto("/admin/settings/hardware");
        await page.getByRole("tab", { name: "Monitor Stampa" }).click();
        await expect(page.locator("span", { hasText: "FAILED" }).first()).toBeVisible({ timeout: 20000 });

        const failedJobButton = page.locator("button").filter({ hasText: /FAILED/ }).first();
        await failedJobButton.click();
        await page.getByRole("button", { name: "Reinvia job fallito" }).click();
        await expect(page.getByText(/Reinvio/i)).toBeVisible();

        await page.getByRole("tab", { name: "Stampanti" }).click();
        const printerCard = page.locator('[data-slot="card"]', { hasText: printerName }).first();
        await printerCard.getByRole("button", { name: "Modifica" }).click();
        const editDialog = page.getByRole("dialog");
        await editDialog.getByLabel("Indirizzo IP").fill("127.0.0.1");
        await editDialog.getByLabel("Porta TCP").fill("19100");
        await editDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click();
        await expect(printerCard.getByText("127.0.0.1:19100")).toBeVisible({ timeout: 15000 });

        await page.getByRole("tab", { name: "Monitor Stampa" }).click();
        await failedJobButton.click();
        await page.getByRole("button", { name: "Reinvia job fallito" }).click();
        await expect(page.getByText(/Reinvio/i)).toBeVisible();
    });

    test("pos error modal exposes cashier-triggered retry action", async ({ page }) => {
        test.setTimeout(120000);
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const eventName = `Retry POS ${suffix}`;
        const printerName = `POS Retry Printer ${suffix}`;
        const cashBoxName = `POS CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `POS Cat ${suffix}`;
        const productName = `POS Product ${suffix}`;

        await createAndActivateEvent(page, eventName);
        await createCashHardwareForPos(page, printerName, "127.0.0.1", "19199", cashBoxName, posName);
        await createCatalogProduct(page, categoryName, productName);

        await selectPosDevice(page, posName);
        await openCashSessionIfRequired(page);

        const productButton = page.locator("button").filter({ hasText: productName }).first();
        await expect(productButton).toBeVisible();
        await productButton.click();

        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
        await expect(checkoutDialog).toBeVisible();
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click();
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 });

        const feedbackModal = page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i });
        await expect(feedbackModal).toBeVisible({ timeout: 20000 });
        const retryButton = feedbackModal.getByRole("button", { name: "Riprova stampa", exact: true });
        await expect(retryButton).toBeVisible();
        await retryButton.click();
        await expect(
            feedbackModal.locator("p").filter({ hasText: /Reinvio completato|Reinvio non riuscito|Nessun job fallito/i }).first()
        ).toBeVisible({ timeout: 20000 });
    });
});
