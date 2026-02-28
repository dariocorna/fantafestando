import { test, expect } from "@playwright/test";
import { resolveE2ECredentials } from "./utils/users";

test.describe("Flusso di autenticazione", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("mostra errore con credenziali errate", async ({ page }) => {
        await page.goto("/login", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#username")).toBeVisible();

        await page.locator("#username").fill("utente_inesistente");
        await page.locator("#password").fill("password_sbagliata");
        await page.getByRole("button", { name: "Accedi", exact: true }).click();

        await expect(page.getByText(/Credenziali non valide|Errore di autenticazione/i)).toBeVisible({ timeout: 10000 });
        await expect(page).toHaveURL(/\/login/);
    });

    test("login corretto reindirizza ad admin", async ({ page }) => {
        const credentials = resolveE2ECredentials();
        await page.goto("/login", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#username")).toBeVisible();

        await page.locator("#username").fill(credentials.admin.username);
        await page.locator("#password").fill(credentials.admin.password);
        await page.getByRole("button", { name: "Accedi", exact: true }).click();

        await expect(page).toHaveURL(/\/admin/, { timeout: 20000 });
    });

    test("redirect a login se non autenticato", async ({ page }) => {
        await page.goto("/admin", { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/\/login/);
    });
});
