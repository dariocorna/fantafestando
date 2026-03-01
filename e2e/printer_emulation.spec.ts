import { test, expect } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import { ensureAdminEventContext, uniqueSuffix } from "./utils/fixtures";

test.describe("Printer Emulation", () => {
    test.beforeEach(async ({ page }) => {
        await ensureAdminAuthenticated(page, "/admin");
        await ensureAdminEventContext(page);
    });

    test("crea stampante virtuale con porta e slot", async ({ page }) => {
        await page.goto("/admin/settings/hardware");

        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const dialog = page.getByRole("dialog");

        const printerName = `Virtuale Test ${uniqueSuffix()}`;
        await dialog.getByLabel("Nome Stampante").fill(printerName);
        await dialog.getByLabel("Indirizzo IP").fill("127.0.0.1");
        await dialog.getByLabel("Porta TCP").fill("19105");
        await dialog.getByLabel("Stampante virtuale").check();
        await dialog.getByLabel("Slot emulatore (1-10, se virtuale)").fill("6");
        await dialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Reparto (Comanda Piatto)" }).click();

        await dialog.getByRole("button", { name: "Salva", exact: true }).click();

        const card = page.locator('[data-slot="card"]', { hasText: printerName }).first();
        await expect(card).toBeVisible();
        await expect(card).toContainText("127.0.0.1:19105");
        await expect(card).toContainText(/Modalità:/);
        await expect(card).toContainText(/Slot:/);
    });

    test("provisioning virtuale e monitor runtime ricevute demo", async ({ page }) => {
        await page.goto("/admin/settings/hardware");

        const provisionButton = page.getByRole("button", { name: "Provisiona 10 virtuali" });
        await provisionButton.click();
        await expect(page.getByText("Virtual Printer 10")).toBeVisible({ timeout: 15000 });
        await expect(page.locator('[data-slot="card"]', { hasText: "Virtual Printer 10" })).toContainText(/19109/);

        await page.getByRole("tab", { name: "Monitor Stampa" }).click();
        await page.getByRole("button", { name: "Genera Ricevuta Demo" }).click();

        const demoJobBtn = page.getByRole("button").filter({ hasText: "Test manuale" }).first();
        await expect(demoJobBtn).toBeVisible({ timeout: 15000 });
        await expect(demoJobBtn).toContainText("SENT", { timeout: 15000 });
        await demoJobBtn.click();

        await expect(page.getByTestId("print-job-breakdown")).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId("print-job-breakdown")).toContainText("Copia:");
        await expect(page.getByTestId("print-job-breakdown")).toContainText("Ordine N°:");
        await expect(page.getByTestId("print-job-totals")).toContainText("TOTALE");
        await expect(page.getByTestId("print-job-preview")).toBeVisible();
    });
});
