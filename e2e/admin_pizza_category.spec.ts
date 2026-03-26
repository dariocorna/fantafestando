import { expect, test } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    createAndActivateEvent,
    createPrinter,
    deleteEvent,
    localPrinterIp,
    uniqueSuffix,
} from "./utils/fixtures";

test.describe.serial("Admin catalogo - categorie pizza", () => {
    const createdEvents: string[] = [];

    test.afterEach(async ({ page }) => {
        const eventName = createdEvents.pop();
        if (!eventName) return;
        await deleteEvent(page, eventName);
    });

    test("valida le categorie pizza e salva una configurazione coerente", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Pizza Category ${suffix}`;
        const kitchenPrinterName = `Forno ${suffix}`;
        const categoryName = `Pizze ${suffix}`;

        await ensureAdminAuthenticated(page, "/admin/catalog");
        await createAndActivateEvent(page, eventName);
        createdEvents.push(eventName);
        await createPrinter(page, kitchenPrinterName, localPrinterIp(), {
            printerType: "KITCHEN",
            printerPort: "19101"
        });

        await page.goto("/admin/catalog");
        await page.click("#new-category-btn");
        const validationDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Categoria/i }).first();
        await expect(validationDialog).toBeVisible();

        await validationDialog.locator("#cat-name").fill(categoryName);
        await validationDialog.getByLabel("Categoria pizza").check();
        await validationDialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();
        await expect(validationDialog.getByRole("alert")).toContainText("richiede una stampante reparto kitchen");
        await validationDialog.getByRole("button", { name: "Close" }).click();
        await expect(validationDialog).toBeHidden({ timeout: 15000 });

        await page.click("#new-category-btn");
        const dialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Categoria/i }).first();
        await expect(dialog).toBeVisible();

        await dialog.locator("#cat-name").fill(categoryName);
        const printerSelect = dialog.getByLabel("Stampante Reparto");
        const printerValue = await printerSelect.evaluate((element, needle) => {
            const select = element as HTMLSelectElement;
            return Array.from(select.options).find((option) => option.text.includes(needle))?.value ?? null;
        }, kitchenPrinterName);
        expect(printerValue).toBeTruthy();
        await printerSelect.selectOption(printerValue!);
        await dialog.getByLabel("Categoria pizza").check();
        await expect(dialog.locator("#skipKitchenPrint")).toBeDisabled();
        await dialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();

        await expect(dialog).toBeHidden({ timeout: 15000 });
        const row = page.getByRole("row").filter({ hasText: categoryName }).first();
        await expect(row).toContainText("Pizza");
        await expect(row).toContainText(kitchenPrinterName);
    });
});
