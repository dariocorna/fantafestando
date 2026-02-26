import { test, expect, type Page } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";

async function gotoAdmin(page: Page) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await ensureAdminAuthenticated(page, "/admin");
            return;
        } catch (error) {
            lastError = error;
            await page.waitForTimeout(500);
        }
    }
    throw lastError;
}

async function submitDialogWithRetry(
    dialog: ReturnType<Page["getByRole"]>,
    submitButtonName: string,
    expectedVisibleLocator: ReturnType<Page["locator"]>,
) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await dialog.getByRole("button", { name: submitButtonName, exact: true }).click();
        try {
            await expect(expectedVisibleLocator).toBeVisible({ timeout: 12000 });
            return;
        } catch (error) {
            if (attempt === 1) throw error;
        }
    }
}

async function ensureAdminEventContext(page: Page) {
    const selector = page.getByTestId("admin-event-selector");

    await gotoAdmin(page);
    if (!(await selector.innerText()).includes("Seleziona Festa")) {
        await expect(selector).toBeEnabled({ timeout: 10000 });
        return;
    }

    await page.click('[data-testid="admin-event-selector"]');
    const firstOption = page.getByRole("option").first();
    if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstOption.click();
        await expect(selector).not.toContainText("Seleziona Festa", { timeout: 10000 });
        await expect(selector).toBeEnabled({ timeout: 10000 });
        await page.waitForLoadState("networkidle");
        return;
    }

    const eventName = `Event Printer Emulation ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await ensureAdminAuthenticated(page, "/admin/settings/events");
    await page.click("#new-event-btn");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await dialog.locator("#name").fill(eventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(page.getByText(eventName)).toBeVisible({ timeout: 10000 });

    await gotoAdmin(page);
    if ((await selector.innerText()).includes("Seleziona Festa")) {
        await page.click('[data-testid="admin-event-selector"]');
        await page.getByRole("option", { name: new RegExp(eventName) }).click();
    }
    await expect(selector).not.toContainText("Seleziona Festa", { timeout: 10000 });
    await expect(selector).toBeEnabled({ timeout: 10000 });
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

        const card = page.locator('[data-slot="card"]', { hasText: printerName }).first();
        await submitDialogWithRetry(dialog, "Salva", card);
        await expect(card).toContainText("127.0.0.1:19105", { timeout: 15000 });
        await expect(card).toContainText(/Modalità:/);
        await expect(card).toContainText(/Slot:/);
    });

    test("provisioning virtuale e monitor runtime ricevute demo", async ({ page }) => {
        await page.goto("/admin/settings/hardware");

        const provisionButton = page.getByRole("button", { name: "Provisiona 10 virtuali" });
        let provisioned = false;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await provisionButton.click();
            try {
                await expect(page.getByText("Virtual Printer 10")).toBeVisible({ timeout: 15000 });
                provisioned = true;
                break;
            } catch (error) {
                if (attempt === 1) throw error;
            }
        }
        expect(provisioned).toBeTruthy();

        await expect(page.getByText(/(printer-emulator|127\.0\.0\.1):19109/)).toBeVisible({ timeout: 15000 });

        await page.getByRole("tab", { name: "Monitor Stampa" }).click();
        await page.getByRole("button", { name: "Genera Ricevuta Demo" }).click();

        await expect(page.getByText("Ricevuta Demo")).toBeVisible({ timeout: 15000 });
        await expect(page.getByText("SENT")).toBeVisible({ timeout: 15000 });
    });
});
