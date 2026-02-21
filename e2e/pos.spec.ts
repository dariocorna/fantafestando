import { test, expect } from '@playwright/test';

test.describe('Interfaccia POS (Cassa)', () => {
    test('caricamento pagina POS e visualizzazione categorie', async ({ page }) => {
        // Naviga alla cassa
        await page.goto('/pos');

        // Verifica intestazione (deve esserci il nome dell'evento o il default)
        // Usiamo un matcher flessibile per la traduzione
        await expect(page.locator('h2')).toBeVisible();
        await expect(page.getByText(/Totale da Pagare/i)).toBeVisible();
    });

    test('apertura dialog checkout e selezione pagamento', async ({ page }) => {
        await page.goto('/pos');

        // Attesa caricamento dati (API init)
        await page.waitForTimeout(2000);

        // Seleziona il primo prodotto disponibile (cerca per il prezzo €)
        const productButton = page.locator('button').filter({ hasText: /€/ }).first();
        if (await productButton.isVisible()) {
            await productButton.click();

            // Verifica che il pulsante PAGA ORA sia attivo
            const payBtn = page.getByRole('button', { name: /PAGA ORA/i });
            await expect(payBtn).toBeEnabled();

            // Clicca PAGA ORA
            await payBtn.click();

            // Verifica modal checkout
            await expect(page.getByText(/Importo Dovuto/i)).toBeVisible();

            // Verifica selettore pagamento
            await expect(page.getByText(/CONTANTI/i)).toBeVisible();
            await expect(page.getByText(/CARTA \/ POS/i)).toBeVisible();
        }
    });
});
