import { expect, test, type Page } from "@playwright/test";

interface ServiceWorkerRegistrationSummary {
    scope: string;
    scriptURL: string;
}

async function getServiceWorkerRegistrations(page: Page): Promise<ServiceWorkerRegistrationSummary[]> {
    return await page.evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();

        return registrations.map((registration) => {
            const worker = registration.active || registration.installing || registration.waiting;
            return {
                scope: registration.scope,
                scriptURL: worker?.scriptURL || "",
            };
        });
    });
}

test.describe("PWA surfaces", () => {
    test("menu espone manifest dedicato", async ({ page }) => {
        await page.goto("/menu", { waitUntil: "domcontentloaded" });

        const manifestHref = await page
            .locator('link[rel="manifest"]')
            .first()
            .getAttribute("href");

        expect(manifestHref).toBe("/manifest-menu.webmanifest");

        const response = await page.request.get(manifestHref || "");
        expect(response.ok()).toBeTruthy();

        const manifest = await response.json();
        expect(manifest.start_url).toBe("/menu?source=pwa");
        expect(manifest.scope).toBe("/menu/");
        expect(manifest.name).toBe("FantaFestando");
        expect(manifest.theme_color).toBe("#1e5fb8");

        const themeColorMeta = page.locator('meta[name="theme-color"]').first();
        await expect(themeColorMeta).toHaveAttribute("content", "#1e5fb8");
    });

    test("registra service worker dedicato su menu", async ({ page }) => {
        await page.goto("/menu", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        await expect
            .poll(async () => {
                const registrations = await getServiceWorkerRegistrations(page);
                return registrations.find((registration) => registration.scope.includes("/menu/")) || null;
            }, { timeout: 10000 })
            .not.toBeNull();

        const registrations = await getServiceWorkerRegistrations(page);
        const menuRegistration = registrations.find((registration) => registration.scope.includes("/menu/"));

        expect(menuRegistration).toBeDefined();
        expect(menuRegistration?.scriptURL).toContain("/sw-menu.js?v=");
    });

    test("nessuna route offline dedicata per menu", async ({ page }) => {
        const menuOffline = await page.request.get("/menu/offline");
        expect(menuOffline.status()).toBe(404);
    });
});
