import { expect, test, type Page } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";

async function expectNoHorizontalOverflow(page: Page) {
    await expect
        .poll(async () => {
            return await page.evaluate(() => {
                const html = document.documentElement;
                const body = document.body;

                return {
                    htmlScrollWidth: html.scrollWidth,
                    htmlClientWidth: html.clientWidth,
                    bodyScrollWidth: body?.scrollWidth ?? 0,
                    bodyClientWidth: body?.clientWidth ?? 0,
                };
            });
        })
        .toEqual(
            expect.objectContaining({
                htmlScrollWidth: expect.any(Number),
                htmlClientWidth: expect.any(Number),
                bodyScrollWidth: expect.any(Number),
                bodyClientWidth: expect.any(Number),
            })
        );

    const metrics = await page.evaluate(() => {
        const html = document.documentElement;
        const body = document.body;

        return {
            htmlScrollWidth: html.scrollWidth,
            htmlClientWidth: html.clientWidth,
            bodyScrollWidth: body?.scrollWidth ?? 0,
            bodyClientWidth: body?.clientWidth ?? 0,
        };
    });

    expect(metrics.htmlScrollWidth).toBeLessThanOrEqual(metrics.htmlClientWidth + 1);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
}

test.describe("Responsive surfaces", () => {
    test("admin: header non genera overflow orizzontale su mobile", async ({ page, isMobile }) => {
        test.skip(!isMobile, "Verifica dedicata solo a viewport mobile");

        await ensureAdminAuthenticated(page, "/admin");
        await page.waitForLoadState("networkidle");

        await expect(page.locator("header")).toBeVisible();
        await expectNoHorizontalOverflow(page);
    });

    test("menu: nessun overflow orizzontale su mobile", async ({ page, isMobile }) => {
        test.skip(!isMobile, "Verifica dedicata solo a viewport mobile");

        await page.goto("/menu", { waitUntil: "domcontentloaded" });
        await page.waitForResponse((response) => response.url().includes("/api/pos/init") && response.ok());

        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
    });

    test("pos: viewport desktop largo (>=13 pollici) e layout stabile", async ({ page, isMobile }) => {
        test.skip(isMobile, "Il POS è validato su schermo largo desktop");

        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto("/pos", { waitUntil: "domcontentloaded" });
        await page.waitForResponse((response) => response.url().includes("/api/pos/init") && response.ok());

        const viewport = page.viewportSize();
        expect(viewport).not.toBeNull();
        expect(viewport!.width).toBeGreaterThanOrEqual(1366);

        await expectNoHorizontalOverflow(page);
    });
});
