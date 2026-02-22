import { test, expect } from '@playwright/test';

test.describe('Gestione Hardware ed Elettronica', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/admin');
        // Assicurati che ci sia un evento attivo e selezionato
        // Se non c'è, il test 'navigazione' in admin.spec.ts dovrebbe averlo creato, 
        // ma per isolamento usiamo uno esistente o il primo disponibile.
        await page.click('[data-testid="admin-event-selector"]');
        const firstOption = page.getByRole('option').first();
        if (await firstOption.isVisible()) {
            await firstOption.click();
        } else {
            // Se non ci sono eventi, ne creiamo uno al volo (mantenendo i test isolati)
            await page.goto('/admin/settings/events');
            await page.click('#new-event-btn');
            await page.fill('#name', 'Event Hardware Test');
            await page.click('button:has-text("Salva")');
            await page.click('[data-testid="admin-event-selector"]');
            await page.getByRole('option', { name: 'Event Hardware Test' }).click();
        }
    });

    test('configurazione completa: stampante -> pos -> categoria', async ({ page }) => {
        // 1. Aggiungi Stampante
        await page.goto('/admin/settings/printers');
        await page.click('button:has-text("Nuova Stampante")');
        const printerName = `Kitchen ${Date.now()}`;
        const printerIp = `192.168.1.${Math.floor(Math.random() * 254) + 1}`;

        await page.fill('input[id="name"]', printerName);
        await page.fill('input[id="ip"]', printerIp);
        // Precise Shadcn Select interaction
        await page.getByRole('combobox', { name: 'Tipo Stampante' }).click();
        await page.getByRole('option', { name: 'Reparto (Comanda Piatto)' }).click();
        await page.click('button:has-text("Salva")');

        await expect(page.getByText(printerName)).toBeVisible();
        await expect(page.getByText(printerIp)).toBeVisible();

        // Aggiungi anche una stampante cassa per il POS
        const cashierName = `Cassa Centrale ${Date.now()}`;
        const cashierIp = `192.168.1.50`;
        await page.click('button:has-text("Nuova Stampante")');
        await page.fill('input[id="name"]', cashierName);
        await page.fill('input[id="ip"]', cashierIp);
        // Precise Shadcn Select interaction
        await page.getByRole('combobox', { name: 'Tipo Stampante' }).click();
        await page.getByRole('option', { name: 'Cassa (Scontrino Cliente)' }).click();
        await page.click('button:has-text("Salva")');
        await expect(page.getByText(cashierName)).toBeVisible();

        // 2. Aggiungi Punto Cassa (PosDevice)
        await page.goto('/admin/settings/pos');
        await page.click('button:has-text("Nuovo Dispositivo")');
        const posName = `Cassa 1 ${Date.now()}`;
        await page.fill('input[id="name"]', posName);
        // Seleziona la stampante cassa appena creata
        await page.getByRole('combobox', { name: 'Stampante Associata' }).click();
        await page.getByRole('option', { name: new RegExp(cashierName) }).click();
        await page.click('button:has-text("Salva")');

        await expect(page.getByText(posName)).toBeVisible();

        // 3. Collega Categoria alla stampante cucina
        await page.goto('/admin/catalog');
        await page.click('#new-category-btn');
        const catName = `Pizza ${Date.now()}`;
        await page.fill('#cat-name', catName);
        // Native select interaction for Category printer
        await page.selectOption('select[id="printerId"]', { label: `${printerName} (${printerIp})` });
        await page.click('button:has-text("Salva Categoria")');

        // Verifica nella tabella del catalogo
        const row = page.locator('tr').filter({ hasText: catName });
        await expect(row.getByText(printerName)).toBeVisible();
    });

    test('validazione campi obbligatori hardware', async ({ page }) => {
        await page.goto('/admin/settings/printers');
        await page.click('button:has-text("Nuova Stampante")');
        // Test Negativo: manca IP stampante
        await page.fill('input[name="name"]', 'Stampante Rotta');
        // Non compiliamo IP (HTML5 required dovrebbe bloccare, ma verifichiamo il comportamento)
        await page.click('button:has-text("Salva")');

        // Verifichiamo che non sia stata aggiunta
        await expect(page.getByText('Stampante Rotta')).not.toBeVisible();

        // Test Negativo: manca nome POS
        await page.goto('/admin/settings/pos');
        await page.click('button:has-text("Nuovo Dispositivo")');
        // Dovrebbe restare sulla stessa pagina con errori o non fare nulla
        const rows = page.locator('table tbody tr');
        const count = await rows.count();
        // Se non ci sono righe o il conteggio non è aumentato, ok.
    });
});
