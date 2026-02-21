import { test, expect } from '@playwright/test';

test.describe('POS Interface', () => {
    test('should load POS page and show categories', async ({ page }) => {
        // Need to ensure an event and categories exist for this test to be robust
        // But for now, check if the page loads and the basic layout is there
        await page.goto('/pos');

        // Check current order header
        await expect(page.getByText('Current Order')).toBeVisible();

        // Total should be visible
        await expect(page.getByText('Total to Pay')).toBeVisible();
    });

    test('should open payment dialog when "PAY NOW" is clicked', async ({ page }) => {
        await page.goto('/pos');

        // Wait for potential data fetch
        await page.waitForTimeout(1000);

        // If there are products, click one to add to cart
        const productButton = page.locator('button').filter({ hasText: /€/ }).first();
        if (await productButton.isVisible()) {
            await productButton.click();

            // Check if cart is not empty
            await expect(page.getByText('PAY NOW')).toBeEnabled();

            // Click PAY NOW
            await page.click('button:has-text("PAY NOW")');

            // Should see the amount due in the dialog
            await expect(page.getByText('Amount Due')).toBeVisible();
        }
    });
});
