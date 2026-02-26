import { test, expect, type Page } from "@playwright/test";

async function gotoAdmin(page: Page) {
    await page.goto("/admin", { waitUntil: "domcontentloaded", timeout: 60000 });
}

async function ensureAdminEventContext(page: Page) {
    const selector = page.getByTestId("admin-event-selector");

    await gotoAdmin(page);
    await page.click('[data-testid="admin-event-selector"]');
    const firstOption = page.getByRole("option").first();
    if (await firstOption.isVisible().catch(() => false)) {
        await firstOption.click();
        await expect(selector).not.toContainText("Seleziona Festa", { timeout: 10000 });
        await page.waitForLoadState("networkidle");
        return;
    }

    const eventName = `Event Printer Emulation ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
    await page.waitForLoadState("networkidle");
}

test.describe("Printer Emulation", () => {
    test.beforeEach(async ({ page }) => {
        await ensureAdminEventContext(page);
    });

    test("crea stampante virtuale con porta e slot", async ({ page }) => {
        await page.goto("/admin/settings/hardware");

        await page.getByRole("button", { name: /Nuova Stampante/i }).click();
        const dialog = page.getByRole("dialog");

        const printerName = `Virtuale Test ${Date.now()}`;
        await dialog.getByLabel("Nome Stampante").fill(printerName);
        await dialog.getByLabel("Indirizzo IP").fill("127.0.0.1");
        await dialog.getByLabel("Porta TCP").fill("19105");
        await dialog.getByLabel("Stampante virtuale").check();
        await dialog.getByLabel("Slot emulatore (1-10, se virtuale)").fill("6");
        await dialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
        await page.getByRole("option", { name: "Reparto (Comanda Piatto)" }).click();
        await dialog.getByRole("button", { name: "Salva", exact: true }).click();

        const card = page.locator('[data-slot="card"]', { hasText: printerName }).first();
        await expect(card.getByText("127.0.0.1:19105")).toBeVisible({ timeout: 15000 });
        await expect(card.getByText(/Modalità:/)).toBeVisible();
        await expect(card.getByText(/Slot:/)).toBeVisible();
    });

    test("provisioning virtuale e monitor runtime ricevute demo", async ({ page }) => {
        await page.goto("/admin/settings/hardware");
        await page.getByRole("button", { name: "Provisiona 10 virtuali" }).click();

        await expect(page.getByText("Virtual Printer 10")).toBeVisible({ timeout: 15000 });
        await expect(page.getByText("printer-emulator:19109")).toBeVisible({ timeout: 15000 });

        await page.getByRole("tab", { name: "Monitor Stampa" }).click();
        await page.getByRole("button", { name: "Genera Ricevuta Demo" }).click();

        await expect(page.getByText("Ricevuta Demo")).toBeVisible({ timeout: 15000 });
        await expect(page.getByText("SENT")).toBeVisible({ timeout: 15000 });
    });
});
