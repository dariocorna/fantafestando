import { test, expect } from '@playwright/test';

test.describe('Deploy smoke checks', () => {
    test('health endpoint is available', async ({ request }) => {
        const response = await request.get('/api/health');
        expect(response.ok()).toBeTruthy();

        const data = await response.json();
        expect(data.status).toBe('ok');
        expect(typeof data.timestamp).toBe('string');
    });

    test('core routes respond without 404', async ({ page }) => {
        const routes = ['/admin', '/menu', '/pos'];

        for (const route of routes) {
            const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
            expect(response, `No response received for ${route}`).not.toBeNull();
            expect(response!.status(), `Unexpected status for ${route}`).toBeLessThan(400);
        }
    });
});
