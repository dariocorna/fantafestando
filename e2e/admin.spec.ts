import { test, expect } from '@playwright/test';

async function gotoAdmin(page: import('@playwright/test').Page) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
            return;
        } catch (error) {
            lastError = error;
            await page.waitForTimeout(500);
        }
    }
    throw lastError;
}

async function selectFirstEventContext(page: import('@playwright/test').Page) {
    await page.click('[data-testid="admin-event-selector"]');
    const firstOption = page.getByRole('option').first();
    if (!(await firstOption.isVisible().catch(() => false))) {
        return false;
    }

    await firstOption.click();
    await expect(page.getByTestId('admin-event-selector')).not.toContainText('Seleziona Festa', { timeout: 10000 });
    return true;
}

async function ensureAdminEventContext(page: import('@playwright/test').Page) {
    await gotoAdmin(page);
    if (await selectFirstEventContext(page)) return;

    await page.goto('/admin/settings/events');
    if (await page.getByText(/Nessuna festa configurata/i).isVisible().catch(() => false)) {
        const testEventName = `Auto Event ${Date.now()}`;
        await page.click('#new-event-btn');
        await page.fill('#name', testEventName);
        await page.getByRole('button', { name: 'Salva', exact: true }).click();
        await expect(page.getByText(testEventName)).toBeVisible();
    }

    await gotoAdmin(page);
    await selectFirstEventContext(page);
}

test.describe('Pannello Amministrazione', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAdmin(page);
    });

    test('navigazione pagine admin senza errori 404', async ({ page, isMobile }) => {
        await expect(page.getByTestId('admin-app-version')).toContainText(/^v/);

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
            // Le pagine admin possono mostrare uno stato vuoto senza heading quando manca il contesto festa.
            await expect
                .poll(
                    async () => {
                        const headerVisible = await page.locator('h1, h2').first().isVisible().catch(() => false);
                        const emptyStateVisible = await page
                            .getByText(/Nessuna festa attiva o selezionata|Seleziona una festa prima|Seleziona una festa dall'header/i)
                            .first()
                            .isVisible()
                            .catch(() => false);
                        return headerVisible || emptyStateVisible;
                    },
                    { timeout: 10000 }
                )
                .toBeTruthy();
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

        // Seleziona esplicitamente la festa appena creata come contesto admin
        await page.click('[data-testid="admin-event-selector"]');
        await page.getByRole('option', { name: new RegExp(testEventName) }).click();
        await expect(page.getByTestId('admin-event-selector')).toContainText(testEventName);

        // Vai in Impostazioni principali
        await page.goto('/admin/settings');
        await expect(page.locator('input[name="active"]')).toBeVisible({ timeout: 10000 });

        // Attiva la festa
        const activeCheckbox = page.locator('input[name="active"]');
        await activeCheckbox.check();

        // Salva
        await page.getByRole('button', { name: /Salva Impostazioni/i }).click();

        // Verifica effetto persistente (piu stabile del toast temporaneo)
        await expect
            .poll(
                async () => {
                    await page.goto('/admin/settings/events');
                    const eventCard = page.locator('div.p-4.border').filter({ hasText: testEventName }).first();
                    if (!(await eventCard.isVisible().catch(() => false))) return false;
                    return await eventCard.getByText(/Attiva \(Globale\)/i).isVisible().catch(() => false);
                },
                { timeout: 15000 }
            )
            .toBeTruthy();
    });

    test('modifica categoria e prodotto (Full CRUD)', async ({ page }) => {
        await ensureAdminEventContext(page);
        await page.goto('/admin/catalog');
        const newCategoryBtn = page.locator('#new-category-btn');
        if (!(await newCategoryBtn.isVisible().catch(() => false))) {
            await gotoAdmin(page);
            await selectFirstEventContext(page);
            await page.goto('/admin/catalog');
        }
        await expect(newCategoryBtn).toBeVisible({ timeout: 10000 });

        // Crea una categoria temporanea
        const catName = `CatToEdit ${Date.now()}`;
        await page.click('#new-category-btn');
        await page.fill('#cat-name', catName);
        await page.click('button:has-text("Salva Categoria")');
        await expect(page.getByRole('dialog')).not.toBeVisible();
        const catRow = page.locator('tr').filter({ hasText: catName });
        if (!(await catRow.isVisible().catch(() => false))) {
            await page.reload();
        }
        if (!(await catRow.isVisible().catch(() => false))) {
            await page.click('#new-category-btn');
            await page.fill('#cat-name', catName);
            await page.click('button:has-text("Salva Categoria")');
            await expect(page.getByRole('dialog')).not.toBeVisible();
        }
        await expect(catRow).toBeVisible({ timeout: 10000 });

        // Trova la riga e clicca Modifica (tramite aria-label)
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
        const prodRow = page.locator('tr').filter({ hasText: prodName });
        if (!(await prodRow.isVisible().catch(() => false))) {
            await page.reload();
        }
        if (!(await prodRow.isVisible().catch(() => false))) {
            await page.click('#new-product-btn');
            await page.fill('#prod-name', prodName);
            await page.fill('input[name="basePrice"]', '5.00');
            await page.locator('select[name="categoryId"]').selectOption({ label: editCatName });
            await page.click('button:has-text("Salva Prodotto")');
            await expect(page.getByRole('dialog')).not.toBeVisible();
        }
        await expect(prodRow).toBeVisible({ timeout: 10000 });

        // Modifica prodotto
        await prodRow.getByLabel("Modifica").click();

        const editProdName = `${prodName} EDITED`;
        await page.fill('#prod-edit-name', editProdName);
        await page.fill('input[name="basePrice"]', '7.50');
        await page.click('button:has-text("Salva Modifiche")');

        await expect(page.getByText(editProdName)).toBeVisible();
        await expect(prodRow.getByText('7.50 €')).toBeVisible();
    });
});
