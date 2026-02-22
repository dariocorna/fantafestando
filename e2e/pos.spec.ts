import { test, expect, type Page } from "@playwright/test";

async function closePosSelectorIfVisible(page: Page) {
    await page.waitForResponse(
        response => response.url().includes("/api/pos/init") && response.ok(),
        { timeout: 10000 }
    ).catch(() => null);

    const selectorTitle = page.getByText(/In quale cassa sei\?/i);
    if (!(await selectorTitle.isVisible())) return;

    const emptyState = page.getByText(/Loggati come admin e configura/i);
    if (await emptyState.isVisible()) return;

    const firstDevice = page.getByRole("dialog").locator("button").filter({ hasText: /Stampante:/i }).first();
    if (await firstDevice.isVisible()) {
        await firstDevice.click();
    }

    await expect(selectorTitle).toBeHidden();
}

test.describe("Interfaccia POS (Cassa)", () => {
    test("caricamento pagina POS e visualizzazione categorie", async ({ page }) => {
        await page.goto("/pos");
        await closePosSelectorIfVisible(page);

        await expect(page.locator("h2")).toBeVisible();
        await expect(page.getByText(/Totale da Pagare/i)).toBeVisible();
    });

    test("apertura dialog checkout e selezione pagamento", async ({ page }) => {
        await page.goto("/pos");
        await closePosSelectorIfVisible(page);

        if (await page.getByText(/Loggati come admin e configura/i).isVisible()) {
            await expect(page.getByText(/Loggati come admin e configura/i)).toBeVisible();
            return;
        }

        const productButton = page.locator("button").filter({ hasText: /€/ }).first();
        await expect(productButton).toBeVisible();
        await productButton.click();

        const payBtn = page.getByRole("button", { name: /PAGA ORA/i });
        await expect(payBtn).toBeEnabled();
        await payBtn.click();

        await expect(page.getByText(/Importo Dovuto/i)).toBeVisible();
        await expect(page.getByText(/CONTANTI/i)).toBeVisible();
        await expect(page.getByText(/CARTA \/ POS/i)).toBeVisible();
    });
});
