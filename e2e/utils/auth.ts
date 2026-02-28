import { expect, type Page } from "@playwright/test";
import { resolveE2ECredentials } from "./users";

export interface LoginWithCredentialsOptions {
    username: string;
    password: string;
    targetPath?: string;
    expectedPathPrefix?: string;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildExpectedUrlRegex(pathPrefix: string): RegExp {
    const escapedPrefix = escapeRegExp(pathPrefix);
    return new RegExp(`${escapedPrefix}(?:$|/|\\?)`);
}

export async function loginWithCredentials(page: Page, options: LoginWithCredentialsOptions) {
    const targetPath = options.targetPath || "/admin";
    await page.goto(targetPath, { waitUntil: "domcontentloaded" });

    if (!page.url().includes("/login")) {
        if (options.expectedPathPrefix) {
            await expect(page).toHaveURL(buildExpectedUrlRegex(options.expectedPathPrefix), { timeout: 20000 });
        }
        return;
    }

    await page.locator("#username").fill(options.username);
    await page.locator("#password").fill(options.password);

    await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 }),
        page.getByRole("button", { name: "Accedi", exact: true }).click()
    ]);

    if (options.expectedPathPrefix) {
        await expect(page).toHaveURL(buildExpectedUrlRegex(options.expectedPathPrefix), { timeout: 20000 });
    }
}

export async function ensureAdminAuthenticated(page: Page, targetPath = "/admin") {
    const credentials = resolveE2ECredentials();
    await loginWithCredentials(page, {
        username: credentials.admin.username,
        password: credentials.admin.password,
        targetPath,
        expectedPathPrefix: "/admin"
    });
}

export async function ensureCashierAuthenticated(
    page: Page,
    targetPath = "/pos",
    expectedPathPrefix = "/pos"
) {
    const credentials = resolveE2ECredentials();
    await loginWithCredentials(page, {
        username: credentials.cashier.username,
        password: credentials.cashier.password,
        targetPath,
        expectedPathPrefix
    });
}
