import { expect, test, type Page } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    ensureAdminEventContext,
    createCategoryAndProducts,
    uniqueSuffix,
} from "./utils/fixtures";

async function savePosCatalogLayout(page: Page, layout: "COMPACT_COLUMNS" | "MODERN_TABS") {
    await page.goto("/admin/settings");
    const activeCheckbox = page.locator('input[name="active"]');
    if (!(await activeCheckbox.isChecked())) await activeCheckbox.check();

    const layoutSelect = page.locator("#posCatalogLayout");
    await layoutSelect.selectOption(layout);
    await expect(layoutSelect).toHaveValue(layout);
    await page.getByRole("button", { name: /Salva Impostazioni/i }).click();
    await expect(page.getByText(/Modifiche salvate/i)).toBeVisible();
}

async function closePosSelectorIfVisible(page: Page) {
    const selectorTitle = page.getByText(/In quale cassa sei\?/i);
    if (!(await selectorTitle.isVisible().catch(() => false))) return;

    const firstDevice = page.getByRole("dialog").locator("button").filter({ hasText: /Stampante:/i }).first();
    if (await firstDevice.isVisible().catch(() => false)) {
        await firstDevice.click();
        await expect(selectorTitle).toBeHidden();
        return;
    }
    await page.keyboard.press("Escape");
}

async function openPos(page: Page) {
    await page.goto("/pos");
    await page.waitForResponse(
        (r) => r.url().includes("/api/pos/init?channel=pos") && r.ok(),
        { timeout: 15000 },
    ).catch(() => null);
    await closePosSelectorIfVisible(page);
}

test.describe("Layout catalogo POS da impostazioni admin", () => {
    test("mantiene il layout selezionato anche dopo reload POS", async ({ page, isMobile }) => {
        test.skip(isMobile, "Scenario validato su desktop.");

        const suffix = uniqueSuffix();
        const categoryName = `Layout Cat ${suffix}`;
        const productName = `Layout Product ${suffix}`;

        await ensureAdminAuthenticated(page, "/admin");
        await ensureAdminEventContext(page);
        await createCategoryAndProducts(page, categoryName, [{ name: productName, price: "3.50" }]);

        await savePosCatalogLayout(page, "MODERN_TABS");

        const response = await page.request.get("/api/pos/init?channel=pos");
        expect(response.ok()).toBeTruthy();
        const payload = await response.json();
        expect(payload?.event?.settings?.posCatalogLayout).toBe("MODERN_TABS");

        await openPos(page);
        await expect(page.getByText(/Categoria attiva/i)).toBeVisible();

        await page.reload();
        await page.waitForResponse(
            (r) => r.url().includes("/api/pos/init?channel=pos") && r.ok(),
            { timeout: 15000 },
        ).catch(() => null);
        await closePosSelectorIfVisible(page);
        await expect(page.getByText(/Categoria attiva/i)).toBeVisible();

        await savePosCatalogLayout(page, "COMPACT_COLUMNS");

        const response2 = await page.request.get("/api/pos/init?channel=pos");
        expect(response2.ok()).toBeTruthy();
        const payload2 = await response2.json();
        expect(payload2?.event?.settings?.posCatalogLayout).toBe("COMPACT_COLUMNS");

        await openPos(page);
        await expect(page.getByText(/Categoria attiva/i)).toHaveCount(0);

        await page.reload();
        await page.waitForResponse(
            (r) => r.url().includes("/api/pos/init?channel=pos") && r.ok(),
            { timeout: 15000 },
        ).catch(() => null);
        await closePosSelectorIfVisible(page);
        await expect(page.getByText(/Categoria attiva/i)).toHaveCount(0);
    });
});
