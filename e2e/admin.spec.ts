import { test, expect } from '@playwright/test';
import { ensureAdminAuthenticated } from './utils/auth';
import { ensureAdminEventContext, uniqueSuffix } from './utils/fixtures';

test.describe('Pannello Amministrazione', () => {
    test.beforeEach(async ({ page }) => {
        await ensureAdminAuthenticated(page, '/admin');
    });

    test('navigazione pagine admin senza errori 404', async ({ page, isMobile }) => {
        await expect(page.getByTestId('admin-app-version')).toContainText(/^v/);

        const navItems = [
            { title: 'Dashboard', path: '/admin' },
            { title: 'Catalogo', path: '/admin/catalog' },
            { title: 'Storico Ordini', path: '/admin/orders' },
            { title: 'Impostazioni', path: '/admin/settings' },
        ];

        for (const item of navItems) {
            if (isMobile) {
                await page.goto(item.path);
            } else {
                await page.getByRole('link', { name: item.title }).click();
            }
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

        await page.click('#new-event-btn');
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText(/Crea Nuova Festa/i)).toBeVisible();

        const testEventName = `Festa Test ${uniqueSuffix()}`;
        await page.fill('#name', testEventName);

        await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByText(testEventName)).toBeVisible();

        await page.click('[data-testid="admin-event-selector"]');
        await page.getByRole('option', { name: new RegExp(testEventName) }).click();
        await expect(page.getByTestId('admin-event-selector')).toContainText(testEventName);

        await page.goto('/admin/settings');
        await expect(page.locator('input[name="active"]')).toBeVisible({ timeout: 10000 });

        const activeCheckbox = page.locator('input[name="active"]');
        await activeCheckbox.check();

        await page.getByRole('button', { name: /Salva Impostazioni/i }).click();

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
        await expect(page.locator('#new-category-btn')).toBeVisible({ timeout: 10000 });

        const suffix = uniqueSuffix();
        const catName = `CatToEdit ${suffix}`;
        await page.click('#new-category-btn');
        await page.fill('#cat-name', catName);
        await page.click('button:has-text("Salva Categoria")');
        await expect(page.getByRole('dialog')).not.toBeVisible();
        const catRow = page.locator('tr').filter({ hasText: catName });
        await expect(catRow).toBeVisible({ timeout: 10000 });

        await catRow.getByLabel("Modifica").click();
        const editCatName = `${catName} EDITED`;
        await page.fill('#cat-edit-name', editCatName);
        await page.click('button:has-text("Salva Modifiche")');
        await expect(page.getByText(editCatName)).toBeVisible();

        const prodName = `ProdToEdit ${suffix}`;
        await page.click('#new-product-btn');
        await page.fill('#prod-name', prodName);
        await page.fill('input[name="basePrice"]', '5.00');
        await page.locator('select[name="categoryId"]').selectOption({ label: editCatName });
        await page.click('button:has-text("Salva Prodotto")');
        await expect(page.getByRole('dialog')).not.toBeVisible();
        const prodRow = page.locator('tr').filter({ hasText: prodName });
        await expect(prodRow).toBeVisible({ timeout: 10000 });

        await prodRow.getByLabel("Modifica").click();
        const editProdName = `${prodName} EDITED`;
        await page.fill('#prod-edit-name', editProdName);
        await page.fill('input[name="basePrice"]', '7.50');
        await page.click('button:has-text("Salva Modifiche")');
        await expect(page.getByText(editProdName)).toBeVisible();
        await expect(prodRow.getByText('7.50 €')).toBeVisible();
    });
});
