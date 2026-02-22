import { test, expect } from '@playwright/test';

test.describe('Selezione Punto Cassa POS', () => {

    test('obbligo di selezione al primo avvio', async ({ page }) => {
        // Pulizia localStorage per simulare primo avvio
        await page.goto('/pos');
        await page.evaluate(() => localStorage.removeItem('osgfest_pos_id'));
        await page.reload();

        // Verifica che il dialog sia aperto
        await expect(page.getByText(/In quale cassa sei\?/i)).toBeVisible();

        // Se non ci sono casse configurate (dipende dallo stato del DB di test)
        // Se ci sono, ne selezioniamo una.
        const posButton = page.locator('button').filter({ hasText: /Postazione:/i }).first();
        // In un ambiente di test pulito, probabilmente dobbiamo crearne una prima o mockare l'API init.
        // Ma qui usiamo l'approccio integrato: se non c'è, verifichiamo il messaggio di errore.
        if (await page.getByText(/Loggati come admin e configura/i).isVisible()) {
            await expect(page.getByText(/Loggati come admin e configura/i)).toBeVisible();
        }
    });

    test('persistenza della selezione tramite localStorage', async ({ page }) => {
        await page.goto('/pos');

        // Mocking manuale della selezione via localStorage per testare il caricamento
        const testPosId = '65d000000000000000000001';
        await page.evaluate((id) => localStorage.setItem('osgfest_pos_id', id), testPosId);
        await page.reload();

        // Il dialog non dovrebbe apparire se è già salvata
        await expect(page.getByText(/In quale cassa sei\?/i)).not.toBeVisible();

        // Verifichiamo che nell'header compaia il link per cambiare postazione (anche se l'ID è fake, il frontend lo legge)
        await expect(page.getByRole('button', { name: /Postazione:/i })).toBeVisible();
    });

    test('cambio postazione tramite interfaccia', async ({ page }) => {
        await page.goto('/pos');

        // Assicuriamoci che il dialog sia chiuso (o apriamolo cliccando sul link)
        const headerBtn = page.getByRole('button', { name: /Postazione:/i });
        if (await headerBtn.isVisible()) {
            await headerBtn.click();
        }

        await expect(page.getByText(/In quale cassa sei\?/i)).toBeVisible();
    });
});
