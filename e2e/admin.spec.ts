import { test, expect } from '@playwright/test';
import { ensureDbConnection } from './utils/db';
import { ensureAdminAuthenticated } from './utils/auth';
import { deleteEvent, ensureAdminEventContext, setAdminEventContextCookie, uniqueSuffix } from './utils/fixtures';
import Event from '../src/models/Event';

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

    test('attivazione globale della festa selezionata', async ({ page }) => {
        const testEventName = `Festa Test ${uniqueSuffix()}`;
        try {
            await ensureDbConnection();
            const event = await Event.create({ name: testEventName, active: false, archived: false });
            await setAdminEventContextCookie(page, String(event._id));
            await page.goto('/admin/settings');
            await expect(page.getByTestId('admin-brand-lockup')).toContainText(testEventName);
            await expect(page.locator('input[name="active"]')).toBeVisible({ timeout: 10000 });

            const activeCheckbox = page.locator('input[name="active"]');
            await activeCheckbox.check();

            await page.getByRole('button', { name: /Salva Impostazioni/i }).click();
            await expect(page.getByText('Modifiche salvate!')).toBeVisible();

            await expect.poll(async () => Event.countDocuments({ _id: event._id, active: true })).toBe(1);
            await expect.poll(async () => Event.countDocuments({ _id: { $ne: event._id }, active: true })).toBe(0);
        } finally {
            await deleteEvent(page, testEventName);
        }
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
        await expect(page.getByRole('row').filter({ hasText: editCatName }).first()).toBeVisible();

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
