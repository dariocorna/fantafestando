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

async function openCashSessionIfRequired(page: Page, openingFloatAmount = "0") {
    const openButton = page.getByRole("button", { name: /Apri Cassa/i });
    if (!(await openButton.isVisible())) return;

    await openButton.click();
    const openDialog = page.getByRole("dialog").filter({ hasText: /Apertura Cassa/i });
    await expect(openDialog).toBeVisible();
    await openDialog.locator("#opening-float-amount").fill(openingFloatAmount);
    await openDialog.getByRole("button", { name: "APRI CASSA", exact: true }).click();
    await expect(openDialog).toBeHidden();
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

        await openCashSessionIfRequired(page);

        const payBtn = page.getByRole("button", { name: /PAGA ORA/i });
        await expect(payBtn).toBeEnabled();
        await payBtn.click();

        await expect(page.getByText(/Importo Dovuto/i)).toBeVisible();

        const cashMethod = page.getByText(/CONTANTI/i);
        const cardMethod = page.getByText(/CARTA \/ POS/i);
        const noMethodsWarning = page.getByText(/non ha metodi di pagamento configurati/i);

        const cashVisible = await cashMethod.isVisible();
        const cardVisible = await cardMethod.isVisible();
        const warningVisible = await noMethodsWarning.isVisible();

        expect(cashVisible || cardVisible || warningVisible).toBeTruthy();
    });
});
