import { expect, test, type Page } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";

async function ensureAdminEventContext(page: Page, fallbackEventName: string) {
    await ensureAdminAuthenticated(page, "/admin");

    const selector = page.getByTestId("admin-event-selector");
    await expect(selector).toBeVisible();
    await selector.click();

    const firstOption = page.getByRole("option").first();
    if (await firstOption.isVisible().catch(() => false)) {
        await firstOption.click();
        await expect(selector).not.toContainText("Seleziona Festa", { timeout: 10000 });
        return;
    }

    await page.goto("/admin/settings/events");
    await page.click("#new-event-btn");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#name").fill(fallbackEventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.click('[data-testid="admin-event-selector"]');
    await page.getByRole("option", { name: new RegExp(fallbackEventName) }).click();
    await expect(page.getByTestId("admin-event-selector")).toContainText(fallbackEventName);
}

async function savePosCatalogLayout(page: Page, layout: "COMPACT_COLUMNS" | "MODERN_TABS") {
    await page.goto("/admin/settings");

    const activeCheckbox = page.locator('input[name="active"]');
    if (!(await activeCheckbox.isChecked())) {
        await activeCheckbox.check();
    }

    const layoutSelect = page.locator("#posCatalogLayout");
    await layoutSelect.selectOption(layout);
    await expect(layoutSelect).toHaveValue(layout);
    await page.getByRole("button", { name: /Salva Impostazioni/i }).click();

    await expect(page.getByText(/Modifiche salvate/i)).toBeVisible();
}

async function createCategoryAndProduct(
    page: Page,
    categoryName: string,
    productName: string,
    productPrice: string
) {
    await page.goto("/admin/catalog");

    await page.click("#new-category-btn");
    await page.fill("#cat-name", categoryName);
    await page.getByRole("button", { name: "Salva Categoria", exact: true }).click();
    await expect(page.getByText(categoryName)).toBeVisible();

    await page.click("#new-product-btn");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome").fill(productName);
    await dialog.getByLabel("Prezzo Base (€)").fill(productPrice);
    await dialog.locator('select[name="categoryId"]').selectOption({ label: categoryName });
    await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(productName)).toBeVisible();
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
    await expect(selectorTitle).toBeHidden({ timeout: 5000 }).catch(() => null);
}

async function openPos(page: Page) {
    await page.goto("/pos");
    await page.waitForResponse(
        (response) => response.url().includes("/api/pos/init?channel=pos") && response.ok(),
        { timeout: 15000 }
    ).catch(() => null);
    await closePosSelectorIfVisible(page);
}

async function expectPosInitLayout(page: Page, layout: "COMPACT_COLUMNS" | "MODERN_TABS") {
    const response = await page.request.get("/api/pos/init?channel=pos");
    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    expect(payload?.event?.settings?.posCatalogLayout).toBe(layout);
}

test.describe("Layout catalogo POS da impostazioni admin", () => {
    test("mantiene il layout selezionato anche dopo reload POS", async ({ page, isMobile }) => {
        test.skip(isMobile, "Scenario validato su desktop.");

        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const eventName = `Layout Event ${suffix}`;
        const categoryName = `Layout Cat ${suffix}`;
        const productName = `Layout Product ${suffix}`;
        const productPrice = "3.50";

        await ensureAdminEventContext(page, eventName);
        await createCategoryAndProduct(page, categoryName, productName, productPrice);

        await savePosCatalogLayout(page, "MODERN_TABS");
        await expectPosInitLayout(page, "MODERN_TABS");

        await openPos(page);
        await expect(page.getByText(/Categoria attiva/i)).toBeVisible();

        await page.reload();
        await page.waitForResponse(
            (response) => response.url().includes("/api/pos/init?channel=pos") && response.ok(),
            { timeout: 15000 }
        ).catch(() => null);
        await closePosSelectorIfVisible(page);
        await expect(page.getByText(/Categoria attiva/i)).toBeVisible();

        await savePosCatalogLayout(page, "COMPACT_COLUMNS");
        await expectPosInitLayout(page, "COMPACT_COLUMNS");

        await openPos(page);
        await expect(page.getByText(/Categoria attiva/i)).toHaveCount(0);

        await page.reload();
        await page.waitForResponse(
            (response) => response.url().includes("/api/pos/init?channel=pos") && response.ok(),
            { timeout: 15000 }
        ).catch(() => null);
        await closePosSelectorIfVisible(page);
        await expect(page.getByText(/Categoria attiva/i)).toHaveCount(0);
    });
});
