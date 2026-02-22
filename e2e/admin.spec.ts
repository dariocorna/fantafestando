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

    test('creazione nuova festa e attivazione globale', async ({ page }) => {
        await page.goto('/admin/settings/events');

        // Apri dialog
        await page.click('#new-event-btn');
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText(/Crea Nuova Festa/i)).toBeVisible();

        // Compila form
        const testEventName = `Festa Test ${Date.now()}`;
        await page.fill('#name', testEventName);

        // Invia
        await dialog.getByRole('button', { name: 'Salva', exact: true }).click();

        // Verifica chiusura automatica del dialog
        await expect(dialog).not.toBeVisible();

        // Verifica comparsa in lista
        await expect(page.getByText(testEventName)).toBeVisible();

        // Seleziona la nuova festa nel selettore Header (AdminEventSelector)
        await page.click('[data-testid="admin-event-selector"]');
        await page.getByRole('option', { name: testEventName }).click();

        // Attendi che il selettore mostri il nome corretto (indica che il refresh è avvenuto)
        await expect(page.getByTestId('admin-event-selector')).toContainText(testEventName);

        // Vai in Impostazioni principali
        await page.goto('/admin/settings');
        await expect(page.getByText(new RegExp(`Impostazioni Festa: ${testEventName}`, 'i'))).toBeVisible({ timeout: 10000 });

        // Attiva la festa
        const activeCheckbox = page.locator('input[name="active"]');
        await activeCheckbox.check();

        // Salva
        await page.getByRole('button', { name: /Salva Impostazioni/i }).click();

        // Verifica feedback salvataggio
        await expect(page.getByText(/Modifiche salvate/i)).toBeVisible();
    });

    test('modifica categoria e prodotto (Full CRUD)', async ({ page }) => {
        await page.goto('/admin/catalog');

        // Crea una categoria temporanea
        const catName = `CatToEdit ${Date.now()}`;
        await page.click('#new-category-btn');
        await page.fill('#cat-name', catName);
        await page.click('button:has-text("Salva Categoria")');
        await expect(page.getByRole('dialog')).not.toBeVisible();
        await expect(page.getByText(catName)).toBeVisible();

        // Trova la riga e clicca Modifica (tramite aria-label)
        const catRow = page.locator('tr').filter({ hasText: catName });
        await catRow.getByLabel("Modifica").click();

        // Dialog modifica categoria
        const editCatName = `${catName} EDITED`;
        await page.fill('#cat-edit-name', editCatName);
        await page.click('button:has-text("Salva Modifiche")');

        await expect(page.getByText(editCatName)).toBeVisible();

        // Crea un prodotto temporaneo
        const prodName = `ProdToEdit ${Date.now()}`;
        await page.click('#new-product-btn');
        await page.fill('#prod-name', prodName);
        await page.fill('input[name="basePrice"]', '5.00');
        // Native select per categoria
        await page.locator('select[name="categoryId"]').selectOption({ label: editCatName });
        await page.click('button:has-text("Salva Prodotto")');
        await expect(page.getByRole('dialog')).not.toBeVisible();
        await expect(page.getByText(prodName)).toBeVisible();

        // Modifica prodotto
        const prodRow = page.locator('tr').filter({ hasText: prodName });
        await prodRow.getByLabel("Modifica").click();

        const editProdName = `${prodName} EDITED`;
        await page.fill('#prod-edit-name', editProdName);
        await page.fill('input[name="basePrice"]', '7.50');
        await page.click('button:has-text("Salva Modifiche")');

        await expect(page.getByText(editProdName)).toBeVisible();
        await expect(page.getByText('7.50 €')).toBeVisible();
    });
});
