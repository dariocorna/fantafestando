import { chromium, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ensureE2EUsers } from "./utils/users";

const storageStatePath = path.join(process.cwd(), "test-results/.auth/admin.json");

function resolveBaseUrl(config: FullConfig): string {
    const projectBaseUrl = config.projects[0]?.use?.baseURL;
    const envBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
    const baseUrl = projectBaseUrl || envBaseUrl || "http://127.0.0.1:3000";
    return String(baseUrl);
}

export default async function globalSetup(config: FullConfig) {
    const baseURL = resolveBaseUrl(config);
    const credentials = await ensureE2EUsers();
    const username = credentials.admin.username;
    const password = credentials.admin.password;

    await mkdir(path.dirname(storageStatePath), { recursive: true });

    const browser = await chromium.launch();
    const page = await browser.newPage({ baseURL });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });

    if (page.url().includes("/login")) {
        await page.locator("#username").fill(username);
        await page.locator("#password").fill(password);
        await Promise.all([
            page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 }),
            page.getByRole("button", { name: "Accedi", exact: true }).click()
        ]);
    }

    if (!page.url().includes("/admin")) {
        await page.goto("/admin", { waitUntil: "domcontentloaded" });
    }

    await page.context().storageState({ path: storageStatePath });
    await browser.close();
}
