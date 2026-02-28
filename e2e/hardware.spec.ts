import { test, expect } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import { ensureAdminEventContext, uniqueSuffix, randomIp } from "./utils/fixtures";

test.describe("Gestione Hardware ed Elettronica", () => {
    test.describe.configure({ timeout: 90000 });

    test.beforeEach(async ({ page }) => {
        page.on("dialog", async (dialog) => {
            await dialog.accept();
        });
        await ensureAdminAuthenticated(page, "/admin");
        await ensureAdminEventContext(page);
    });

    test("configurazione completa: stampante -> pos -> categoria", async ({ page }) => {
        await page.goto("/admin/settings/hardware");

        const suffix = uniqueSuffix();
        const printerName = `Kitchen ${suffix}`;
        const printerIp = randomIp();

        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const printerDialog = page.getByRole("dialog");
        await printerDialog.getByLabel("Nome Stampante").fill(printerName);
        await printerDialog.getByLabel("Indirizzo IP").fill(printerIp);
        await printerDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Reparto (Comanda Piatto)" }).click();
        await printerDialog.getByRole("button", { name: "Salva", exact: true }).click();
        await expect(page.getByText(printerName)).toBeVisible();
        await expect(page.getByText(printerIp)).toBeVisible();

        const cashierName = `Cassa Centrale ${suffix}`;
        const cashierIp = "192.168.1.50";
        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const cashierDialog = page.getByRole("dialog");
        await cashierDialog.getByLabel("Nome Stampante").fill(cashierName);
        await cashierDialog.getByLabel("Indirizzo IP").fill(cashierIp);
        await cashierDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Cassa (Scontrino Cliente)" }).click();
        await cashierDialog.getByRole("button", { name: "Salva", exact: true }).click();
        await expect(page.getByText(cashierName)).toBeVisible();

        await page.goto("/admin/settings/pos");
        await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
        const posDialog = page.getByRole("dialog");
        const posName = `Cassa 1 ${suffix}`;
        await posDialog.getByLabel("Nome Postazione").fill(posName);
        await posDialog.getByRole("combobox", { name: "Stampante Associata" }).click();
        await page.getByRole("option", { name: new RegExp(cashierName) }).click();
        await posDialog.getByRole("button", { name: "Salva", exact: true }).click();
        await expect(page.getByText(posName)).toBeVisible();

        await page.goto("/admin/catalog");
        await page.click("#new-category-btn");
        const catName = `Pizza ${suffix}`;
        await page.fill("#cat-name", catName);
        await page.selectOption('select[id="printerId"]', { label: `${printerName} (${printerIp})` });
        await page.getByRole("button", { name: "Salva Categoria", exact: true }).click();
        const row = page.locator("tr").filter({ hasText: catName });
        await expect(row.getByText(printerName)).toBeVisible({ timeout: 10000 });
    });

    test("validazione campi obbligatori hardware", async ({ page }) => {
        await page.goto("/admin/settings/hardware");
        await page.getByRole("button", { name: /Nuova Stampante/i }).click();

        const invalidName = `Stampante Rotta ${uniqueSuffix()}`;
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Nome Stampante").fill(invalidName);
        await dialog.getByRole("button", { name: "Salva", exact: true }).click();

        await expect(dialog).toBeVisible();
        await expect(page.locator('[data-slot="card-title"]', { hasText: invalidName })).toHaveCount(0);
    });

    test("modifica hardware esistente (Full CRUD)", async ({ page }) => {
        await page.goto("/admin/settings/hardware");

        const suffix = uniqueSuffix();

        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const createDialog = page.getByRole("dialog");
        const printerName = `PrinterToEdit ${suffix}`;
        const printerIp = "192.168.1.99";
        await createDialog.getByLabel("Nome Stampante").fill(printerName);
        await createDialog.getByLabel("Indirizzo IP").fill(printerIp);
        await createDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Cassa (Scontrino Cliente)" }).click();
        await createDialog.getByRole("button", { name: "Salva", exact: true }).click();
        await expect(page.getByText(printerName)).toBeVisible();

        const printerCard = page.locator('[data-slot="card"]', { hasText: printerName }).first();
        await printerCard.getByRole("button", { name: "Modifica" }).click();
        const editPrinterDialog = page.getByRole("dialog");
        const editedPrinterIp = "192.168.1.100";
        await editPrinterDialog.getByLabel("Indirizzo IP").fill(editedPrinterIp);
        await editPrinterDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click();
        await expect(printerCard.getByText(editedPrinterIp)).toBeVisible();

        await page.goto("/admin/settings/pos");
        await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
        const createPosDialog = page.getByRole("dialog");
        const posName = `PosToEdit ${suffix}`;
        await createPosDialog.getByLabel("Nome Postazione").fill(posName);
        await createPosDialog.getByRole("combobox", { name: "Stampante Associata" }).click();
        await page.getByRole("option", { name: new RegExp(printerName) }).click();
        await createPosDialog.getByRole("button", { name: "Salva", exact: true }).click();
        await expect(page.getByText(posName)).toBeVisible();

        const posCard = page.locator('[data-slot="card"]', { hasText: posName }).first();
        await posCard.getByRole("button", { name: "Modifica" }).click();
        const editPosDialog = page.getByRole("dialog");
        const editedPosName = `${posName} EDITED`;
        await editPosDialog.getByLabel("Nome Postazione").fill(editedPosName);
        await editPosDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click();
        await expect(page.getByText(editedPosName)).toBeVisible();
    });
});
