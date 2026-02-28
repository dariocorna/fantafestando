import { test, expect } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import { ensureAdminEventContext, uniqueSuffix, randomIp } from "./utils/fixtures";

test.describe("Eliminazione entità hardware", () => {
    test.beforeEach(async ({ page }) => {
        page.on("dialog", async (dialog) => {
            await dialog.accept();
        });
        await ensureAdminAuthenticated(page, "/admin");
        await ensureAdminEventContext(page);
    });

    test("elimina stampante e verifica rimozione dalla lista", async ({ page, isMobile }) => {
        test.skip(isMobile, "Scenario validato su desktop.");

        await page.goto("/admin/settings/hardware");

        const suffix = uniqueSuffix();
        const printerName = `Printer Del ${suffix}`;
        const printerIp = randomIp();

        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Nome Stampante").fill(printerName);
        await dialog.getByLabel("Indirizzo IP").fill(printerIp);
        await dialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Reparto (Comanda Piatto)" }).click();
        await dialog.getByRole("button", { name: "Salva", exact: true }).click();
        await expect(page.getByText(printerName)).toBeVisible();

        const printerCard = page.locator('[data-slot="card"]', { hasText: printerName }).first();
        await printerCard.locator("button.text-red-500").click();
        await page.getByRole("button", { name: "Continua", exact: true }).click();

        await expect(printerCard).toBeHidden();
    });

    test("elimina periferica e verifica rimozione dalla lista", async ({ page, isMobile }) => {
        test.skip(isMobile, "Scenario validato su desktop.");

        await page.goto("/admin/settings/hardware");
        await page.getByRole("tab", { name: "Periferiche" }).click();

        const suffix = uniqueSuffix();
        const peripheralName = `Periph Del ${suffix}`;

        await page.getByRole("button", { name: /Nuova Periferica/i }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Nome Descrittivo").fill(peripheralName);
        await dialog.getByRole("combobox", { name: "Tipo Periferica" }).click();
        await page.getByRole("option", { name: "Cassetta Contanti (Manuale)" }).click();
        await dialog.getByRole("button", { name: "Aggiungi Periferica", exact: true }).click();
        await expect(page.getByText(peripheralName)).toBeVisible();

        const peripheralCard = page.locator('[data-slot="card"]', { hasText: peripheralName }).first();
        await peripheralCard.locator("button.text-red-500").click();
        await page.getByRole("button", { name: "Continua", exact: true }).click();

        await expect(peripheralCard).toBeHidden();
    });
});
