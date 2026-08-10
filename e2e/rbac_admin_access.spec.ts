import { expect, test } from "@playwright/test";
import { loginWithCredentials } from "./utils/auth";
import { ensureE2EUsers, type E2ECredentials } from "./utils/users";

let credentials: E2ECredentials;

test.beforeAll(async () => {
    credentials = await ensureE2EUsers();
});

test.describe("RBAC accesso admin", () => {
    test("utente ADMIN puo accedere a /admin", async ({ page }) => {
        await page.goto("/admin", { waitUntil: "domcontentloaded" });

        await expect(page).toHaveURL(/\/admin(?:$|\/|\?)/);
        await expect(page.locator("header").getByText("FantaFestando Manager")).toBeVisible();
    });
});

test.describe("RBAC accesso admin senza sessione iniziale", () => {
    test.use({
        storageState: {
            cookies: [],
            origins: []
        }
    });

    test("utente CASHIER bloccato su /admin (backoffice non accessibile)", async ({ page }) => {
        await loginWithCredentials(page, {
            username: credentials.cashier.username,
            password: credentials.cashier.password,
            targetPath: "/admin"
        });

        await expect(page.getByTestId("pos-brand-shell")).toBeVisible();
        await expect(page.getByTestId("admin-event-selector")).toHaveCount(0);
    });

    test("utente non autenticato su /admin/settings viene rediretto a /login", async ({ page }) => {
        await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });

        await expect(page).toHaveURL(/\/login\?/);
        const url = new URL(page.url());
        expect(url.pathname).toBe("/login");
        expect(url.searchParams.get("callbackUrl")).toBe("/admin/settings");
        await expect(page.getByTestId("login-form")).toBeVisible();
    });

    test("utente CASHIER autenticato puo usare /pos", async ({ page }) => {
        await loginWithCredentials(page, {
            username: credentials.cashier.username,
            password: credentials.cashier.password,
            targetPath: "/pos",
            expectedPathPrefix: "/pos"
        });

        await expect(page).toHaveURL(/\/pos(?:$|\/|\?)/);
    });

    test("utente non autenticato su /pizza-console viene rediretto a /login", async ({ page }) => {
        await page.goto("/pizza-console", { waitUntil: "domcontentloaded" });

        await expect(page).toHaveURL(/\/login\?/);
        const url = new URL(page.url());
        expect(url.pathname).toBe("/login");
        expect(url.searchParams.get("callbackUrl")).toBe("/pizza-console");
        await expect(page.getByTestId("login-form")).toBeVisible();
    });

    test("utente CASHIER autenticato puo accedere a /pizza-console", async ({ page }) => {
        await loginWithCredentials(page, {
            username: credentials.cashier.username,
            password: credentials.cashier.password,
            targetPath: "/pizza-console",
            expectedPathPrefix: "/pizza-console"
        });

        await expect(page.getByTestId("pizza-console-scanner-input")).toBeVisible();
    });
});
