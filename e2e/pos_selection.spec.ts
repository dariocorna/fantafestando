import { test, expect, type Page } from "@playwright/test";

async function openPosWithCleanSelection(page: Page) {
    await page.goto("/pos");
    await page.evaluate(() => localStorage.removeItem("fantafestando_pos_id"));
    await page.reload();
}

async function getFirstPosButton(page: Page) {
    return page.getByRole("dialog").locator("button").filter({ hasText: /Stampante:/i }).first();
}

test.describe("Selezione Punto Cassa POS", () => {
    test("obbligo di selezione al primo avvio", async ({ page }) => {
        await openPosWithCleanSelection(page);

        await expect(page.getByText(/In quale cassa sei\?/i)).toBeVisible();

        if (await page.getByText(/Loggati come admin e configura/i).isVisible()) {
            await expect(page.getByText(/Loggati come admin e configura/i)).toBeVisible();
            return;
        }

        const firstDevice = await getFirstPosButton(page);
        await expect(firstDevice).toBeVisible();
    });

    test("persistenza della selezione tramite localStorage", async ({ page }) => {
        await openPosWithCleanSelection(page);

        if (await page.getByText(/Loggati come admin e configura/i).isVisible()) {
            await expect(page.getByText(/Loggati come admin e configura/i)).toBeVisible();
            return;
        }

        const firstDevice = await getFirstPosButton(page);
        await firstDevice.click();
        await expect(page.getByText(/In quale cassa sei\?/i)).toBeHidden();
        await expect(page.getByTestId("pos-desktop-cash-menu-trigger")).toBeVisible();

        await page.reload();
        await expect(page.getByText(/In quale cassa sei\?/i)).toBeHidden();
        await expect(page.getByTestId("pos-desktop-cash-menu-trigger")).toBeVisible();
    });

    test("cambio postazione tramite interfaccia", async ({ page }) => {
        await page.goto("/pos");
        await page.waitForResponse(
            response => response.url().includes("/api/pos/init") && response.ok(),
            { timeout: 10000 }
        ).catch(() => null);

        if (await page.getByText(/Loggati come admin e configura/i).isVisible()) {
            await expect(page.getByText(/Loggati come admin e configura/i)).toBeVisible();
            return;
        }

        const selectorTitle = page.getByText(/In quale cassa sei\?/i);
        if (await selectorTitle.isVisible().catch(() => false)) {
            const firstDevice = await getFirstPosButton(page);
            await firstDevice.click();
            await expect(selectorTitle).toBeHidden();
        }

        const cashMenu = page.getByTestId("pos-desktop-cash-menu");
        await page.getByTestId("pos-desktop-cash-menu-trigger").click();
        await expect(cashMenu).toHaveAttribute("open", "");
        await page.locator("h1").click();
        await expect(cashMenu).not.toHaveAttribute("open", "");
        await page.getByTestId("pos-desktop-cash-menu-trigger").click();
        await page.getByRole("button", { name: /Cambia cassa/i }).click();
        await expect(cashMenu).not.toHaveAttribute("open", "");
        await expect(page.getByText(/In quale cassa sei\?/i)).toBeVisible();
    });
});
