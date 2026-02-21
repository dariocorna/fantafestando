import { test, expect } from '@playwright/test';

test.describe('Admin Panel', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to events page as starting point
        await page.goto('/admin/events');
    });

    test('should navigate to all admin pages without 404', async ({ page }) => {
        const navItems = [
            { title: 'Dashboard', url: /\/admin$/ },
            { title: 'Catalog', url: /\/admin\/catalog/ },
            { title: 'Events', url: /\/admin\/events/ },
            { title: 'Orders History', url: /\/admin\/orders/ },
            { title: 'Settings', url: /\/admin\/settings/ },
        ];

        for (const item of navItems) {
            await page.getByRole('link', { name: item.title }).click();
            await expect(page).toHaveURL(item.url);
            // Allow both h1 and h2
            const header = page.locator('h1, h2').first();
            await expect(header).toBeVisible();
        }
    });

    test('should open "Nuova Festa" dialog and create a new event', async ({ page }) => {
        await page.goto('/admin/events');

        // Check if dialog opens
        await page.click('#new-event-btn');
        await expect(page.getByText('Crea Nuova Festa')).toBeVisible();

        // Fill form
        const testEventName = `Test Event ${Date.now()}`;
        await page.fill('#name', testEventName);

        // Submit
        await page.click('button[type="submit"]');

        // Check if event appears in list
        await expect(page.getByText(testEventName)).toBeVisible();
    });

    test('should create a category and a product in the catalog', async ({ page }) => {
        // 1. Create an event first
        await page.goto('/admin/events');
        const eventName = `CatTestEvt ${Date.now()}`;
        await page.click('#new-event-btn');
        await page.fill('#name', eventName);
        await page.click('button[type="submit"]');

        // 2. Go to Catalog
        await page.goto('/admin/catalog');

        // 3. Create Category
        await page.click('#new-category-btn');
        const catName = 'Test Cat';
        await page.fill('#cat-name', catName);
        await page.click('button[type="submit"]');
        await expect(page.getByText(catName).first()).toBeVisible();

        // Wait for dialog to close completely
        await page.locator('div[role="dialog"]').waitFor({ state: 'hidden' });

        // 4. Create Product
        await page.click('#new-product-btn');
        const prodName = 'Test Prod';
        await page.fill('#prod-name', prodName);
        await page.fill('#basePrice', '10.50');
        await page.click('button[type="submit"]');
        await expect(page.getByText(prodName)).toBeVisible();
    });
});
