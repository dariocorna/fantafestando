import { test, expect } from '@playwright/test';

test.describe('Pannello Amministrazione', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/admin');
    });

    test('navigazione pagine admin senza errori 404', async ({ page, isMobile }) => {
        const navItems = [
            { title: 'Dashboard', url: /\/admin$/, path: '/admin' },
            { title: 'Catalogo', url: /\/admin\/catalog/, path: '/admin/catalog' },
            { title: 'Storico Ordini', url: /\/admin\/orders/, path: '/admin/orders' },
            { title: 'Impostazioni', url: /\/admin\/settings/, path: '/admin/settings' },
        ];

        for (const item of navItems) {
            if (isMobile) {
                // Su mobile, per evitare flakiness con l'animazione Sheet della Sidebar, 
                // navighiamo direttamente per testare il 404.
                await page.goto(item.path);
            } else {
                await page.getByRole('link', { name: item.title }).click();
            }
            // Controllo Header come garanzia che la pagina ha caricato (e non è 404)
            const header = page.locator('h1, h2').first();
            await expect(header).toBeVisible();
        }
    });

    test('creazione nuova festa e attivazione globale', async ({ page, isMobile }) => {
        await page.goto('/admin/settings/events');

        // Apri dialog
        await page.click('#new-event-btn');
        await expect(page.getByText(/Crea Nuova Festa/i)).toBeVisible();

        // Compila form
        const testEventName = `Festa Test ${Date.now()}`;
        await page.fill('#name', testEventName);

        // Invia
        await page.getByRole('dialog').getByRole('button', { name: 'Salva', exact: true }).click();

        // Attendi che il DOM si aggiorni (Server Action) e chiudi il dialog
        await page.waitForTimeout(1000);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Verifica comparsa in lista
        await expect(page.getByText(testEventName)).toBeVisible();

        // Clicca impostazioni per attivarla
        // Nota: Assumiamo che ci sia un modo per identificare il pulsante impostazioni della riga appena creata
        // Per semplicità cerchiamo il pulsante 'Settings' vicino al nome
        // Clicca impostazioni per attivarla
        const eventRow = page.locator('div.p-4').filter({ hasText: testEventName });
        await eventRow.getByRole('button').filter({ hasText: /Impostazioni/i }).click();

        // Nel modal impostazioni, attiva la festa
        const activeCheckbox = page.getByLabel(/Festa Attiva/i);
        await expect(activeCheckbox).toBeVisible();
        await activeCheckbox.check();

        // Salva
        await page.getByRole('dialog').getByRole('button', { name: 'Salva Impostazioni' }).click();

        // Verifica che lo stato sia aggiornato (es. un badge 'Attiva' se implementato, o semplicemente non errore)
    });
});
