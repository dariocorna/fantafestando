import { test, expect, type Page } from "@playwright/test";

async function gotoAdmin(page: Page) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await page.goto("/admin", { waitUntil: "domcontentloaded", timeout: 60000 });
            return;
        } catch (error) {
            lastError = error;
            await page.waitForTimeout(500);
        }
    }
    throw lastError;
}

async function ensureAdminEventContext(page: Page) {
    const selector = page.getByTestId("admin-event-selector");

    await gotoAdmin(page);
    await page.click('[data-testid="admin-event-selector"]');
    const firstOption = page.getByRole("option").first();
    if (await firstOption.isVisible().catch(() => false)) {
        await firstOption.click();
        await expect(selector).not.toContainText("Seleziona Festa", { timeout: 10000 });
        await expect(selector).toBeEnabled({ timeout: 10000 });
        await page.waitForLoadState("networkidle");
        return;
    }

    const eventName = `Event Hardware Test ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await page.goto("/admin/settings/events");
    await page.click("#new-event-btn");
    const dialog = page.getByRole("dialog");
    await page.fill("#name", eventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(eventName)).toBeVisible({ timeout: 10000 });

    await gotoAdmin(page);
    await page.click('[data-testid="admin-event-selector"]');
    await page.getByRole("option").first().click();
    await expect(selector).not.toContainText("Seleziona Festa", { timeout: 10000 });
    await expect(selector).toBeEnabled({ timeout: 10000 });
    await page.waitForLoadState("networkidle");
}

async function submitDialogWithRetry(
    _page: Page,
    dialog: ReturnType<Page["getByRole"]>,
    submitButtonName: string,
    expectedVisibleLocator: ReturnType<Page["getByText"]>,
) {
    for (let attempt = 0; attempt < 2; attempt++) {
        await dialog.getByRole("button", { name: submitButtonName, exact: true }).click();
        try {
            await expect(expectedVisibleLocator).toBeVisible({ timeout: 12000 });
            return;
        } catch (error) {
            if (attempt === 1) throw error;
            await dialog.getByRole("button", { name: submitButtonName, exact: true }).click();
            await expect(expectedVisibleLocator).toBeVisible({ timeout: 15000 });
            return;
        }
    }
}

test.describe("Gestione Hardware ed Elettronica", () => {
    test.describe.configure({ timeout: 90000 });
    test.beforeEach(async ({ page }) => {
        page.on("dialog", async (dialog) => {
            await dialog.accept();
        });
        await ensureAdminEventContext(page);
    });

    test("configurazione completa: stampante -> pos -> categoria", async ({ page }) => {
        await page.goto("/admin/settings/hardware");

        // 1. Aggiungi stampante reparto
        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const printerDialog = page.getByRole("dialog");
        const printerName = `Kitchen ${Date.now()}`;
        const printerIp = `192.168.1.${Math.floor(Math.random() * 200) + 20}`;
        await printerDialog.getByLabel("Nome Stampante").fill(printerName);
        await printerDialog.getByLabel("Indirizzo IP").fill(printerIp);
        await printerDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Reparto (Comanda Piatto)" }).click();
        await submitDialogWithRetry(page, printerDialog, "Salva", page.getByText(printerName));
        await expect(page.getByText(printerIp)).toBeVisible({ timeout: 15000 });

        // 2. Aggiungi stampante cassa
        const cashierName = `Cassa Centrale ${Date.now()}`;
        const cashierIp = "192.168.1.50";
        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const cashierDialog = page.getByRole("dialog");
        await cashierDialog.getByLabel("Nome Stampante").fill(cashierName);
        await cashierDialog.getByLabel("Indirizzo IP").fill(cashierIp);
        await cashierDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Cassa (Scontrino Cliente)" }).click();
        await submitDialogWithRetry(page, cashierDialog, "Salva", page.getByText(cashierName));

        // 3. Aggiungi Punto Cassa
        await page.goto("/admin/settings/pos");
        await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
        const posDialog = page.getByRole("dialog");
        const posName = `Cassa 1 ${Date.now()}`;
        await posDialog.getByLabel("Nome Postazione").fill(posName);
        await posDialog.getByRole("combobox", { name: "Stampante Associata" }).click();
        await page.getByRole("option", { name: new RegExp(cashierName) }).click();
        await submitDialogWithRetry(page, posDialog, "Salva", page.getByText(posName));

        // 4. Collega categoria alla stampante reparto
        await page.goto("/admin/catalog");
        await page.click("#new-category-btn");
        const catName = `Pizza ${Date.now()}`;
        await page.fill("#cat-name", catName);
        await page.selectOption('select[id="printerId"]', { label: `${printerName} (${printerIp})` });
        await page.getByRole("button", { name: "Salva Categoria", exact: true }).click();

        const row = page.locator("tr").filter({ hasText: catName });
        await expect(row.getByText(printerName)).toBeVisible({ timeout: 10000 });
    });

    test("validazione campi obbligatori hardware", async ({ page }) => {
        await page.goto("/admin/settings/hardware");
        await page.getByRole("button", { name: /Nuova Stampante/i }).click();

        const invalidName = `Stampante Rotta ${Date.now()}`;
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Nome Stampante").fill(invalidName);
        await dialog.getByRole("button", { name: "Salva", exact: true }).click();

        // L'input IP è required: il dialog resta aperto e la card non viene creata.
        await expect(dialog).toBeVisible();
        await expect(page.locator('[data-slot="card-title"]', { hasText: invalidName })).toHaveCount(0);
    });

    test("modifica hardware esistente (Full CRUD)", async ({ page }) => {
        await page.goto("/admin/settings/hardware");

        // Crea stampante cassa
        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const createDialog = page.getByRole("dialog");
        const printerName = `PrinterToEdit ${Date.now()}`;
        const printerIp = "192.168.1.99";
        await createDialog.getByLabel("Nome Stampante").fill(printerName);
        await createDialog.getByLabel("Indirizzo IP").fill(printerIp);
        await createDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Cassa (Scontrino Cliente)" }).click();
        await submitDialogWithRetry(page, createDialog, "Salva", page.getByText(printerName));

        // Modifica stampante
        const printerCard = page.locator('[data-slot="card"]', { hasText: printerName }).first();
        await printerCard.getByRole("button", { name: "Modifica" }).click();
        const editPrinterDialog = page.getByRole("dialog");
        const editedPrinterIp = "192.168.1.100";
        await editPrinterDialog.getByLabel("Indirizzo IP").fill(editedPrinterIp);
        await editPrinterDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click();
        await expect(page.getByText(editedPrinterIp)).toBeVisible();

        // Crea POS
        await page.goto("/admin/settings/pos");
        await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
        const createPosDialog = page.getByRole("dialog");
        const posName = `PosToEdit ${Date.now()}`;
        await createPosDialog.getByLabel("Nome Postazione").fill(posName);
        await createPosDialog.getByRole("combobox", { name: "Stampante Associata" }).click();
        await page.getByRole("option", { name: new RegExp(printerName) }).click();
        await submitDialogWithRetry(page, createPosDialog, "Salva", page.getByText(posName));

        // Modifica POS
        const posCard = page.locator('[data-slot="card"]', { hasText: posName }).first();
        await posCard.getByRole("button", { name: "Modifica" }).click();
        const editPosDialog = page.getByRole("dialog");
        const editedPosName = `${posName} EDITED`;
        await editPosDialog.getByLabel("Nome Postazione").fill(editedPosName);
        await editPosDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click();
        await expect(page.getByText(editedPosName)).toBeVisible();
    });
});
