import { expect, test } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    createAndActivateEvent,
    deleteEvent,
    uniqueSuffix,
} from "./utils/fixtures";

test.describe.serial("Admin catalogo - preparazioni numerate", () => {
    const createdEvents: string[] = [];

    test.afterEach(async ({ page }) => {
        const eventName = createdEvents.pop();
        if (!eventName) return;
        await deleteEvent(page, eventName);
    });

    test("valida le categorie numerate e salva una configurazione coerente", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Pizza Category ${suffix}`;
        const categoryName = `Pizze ${suffix}`;

        await ensureAdminAuthenticated(page, "/admin/catalog");
        await createAndActivateEvent(page, eventName);
        createdEvents.push(eventName);

        await page.goto("/admin/catalog");
        await page.click("#new-category-btn");
        const dialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Categoria/i }).first();
        await expect(dialog).toBeVisible();

        await dialog.locator("#cat-name").fill(categoryName);
        await dialog.getByLabel("Preparazione numerata").check();
        const barcode = dialog.getByLabel("Stampa barcode piatto");
        await expect(barcode).not.toBeChecked();
        await barcode.check();
        await expect(dialog.locator("#skipKitchenPrint")).toBeDisabled();
        await expect(dialog).toContainText("senza stampante dedicata la comanda esce solo in cassa");
        await dialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();

        await expect(dialog).toBeHidden({ timeout: 15000 });
        const row = page.getByRole("row").filter({ hasText: categoryName }).first();
        await expect(row).toContainText("Numerata");
        await expect(row).toContainText("barcode");
        await expect(row).toContainText("Default Cassa");
    });
});
