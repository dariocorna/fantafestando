import { test, expect } from '@playwright/test';
import { uniqueSuffix, ensureAdminEventContext, createCategoryAndProducts } from './utils/fixtures';

test.describe('Admin Catalog Category Drag and Drop Ordering', () => {
    let suffix: string;
    let catA: string;
    let catB: string;
    let catC: string;

    test.beforeEach(async ({ page }) => {
        await page.goto('/admin');
        await ensureAdminEventContext(page);

        suffix = uniqueSuffix();
        catA = `Cat A ${suffix}`;
        catB = `Cat B ${suffix}`;
        catC = `Cat C ${suffix}`;

        // Create categories in order A, B, C
        await createCategoryAndProducts(page, catA, []);
        await createCategoryAndProducts(page, catB, []);
        await createCategoryAndProducts(page, catC, []);
    });

    test('reorders categories via keyboard and persists after reload', async ({ page }) => {
        await page.goto('/admin/catalog');
        await page.waitForLoadState('networkidle');

        const categoryTable = page.locator('table').first();

        // Helper: get names of our test categories in DOM order
        async function getTestCategoryOrder(): Promise<string[]> {
            const names = await categoryTable.locator('tbody tr td:nth-child(2)').allInnerTexts();
            return names.filter(name => name.includes(suffix));
        }

        // Verify initial order
        expect(await getTestCategoryOrder()).toEqual([catA, catB, catC]);

        // --- Keyboard-based reorder: move Cat A down one position ---
        // @dnd-kit KeyboardSensor: focus handle → Space (pick up) → ArrowDown (move) → Space (drop)
        const rowA = categoryTable.locator('tbody tr', { hasText: catA });
        const handleA = rowA.locator('button.cursor-grab');
        await expect(handleA).toBeVisible();

        await handleA.focus();
        await page.keyboard.press('Space');
        // Small pause for dnd-kit to activate the drag
        await page.waitForTimeout(200);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        await page.keyboard.press('Space');

        // Wait for the server action to complete (revalidation)
        await page.waitForLoadState('networkidle');
        // Give a moment for React to reconcile
        await page.waitForTimeout(500);

        // Verify order changed in the DOM: should now be B, A, C
        const orderAfterDrag = await getTestCategoryOrder();
        expect(orderAfterDrag).toEqual([catB, catA, catC]);

        // --- Verify persistence: reload page and check order is still B, A, C ---
        await page.reload();
        await page.waitForLoadState('networkidle');

        const orderAfterReload = await getTestCategoryOrder();
        expect(orderAfterReload).toEqual([catB, catA, catC]);
    });
});
