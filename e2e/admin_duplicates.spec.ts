import { expect, test, type Page } from "@playwright/test";
import { ensureAdminAuthenticated } from "./utils/auth";
import { selectEventContext, uniqueSuffix } from "./utils/fixtures";

async function createEventViaDialog(page: Page, name: string) {
    await page.goto("/admin/settings/events");

    const trigger = page.locator("#new-event-btn");
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog").filter({ has: page.locator("#name") }).first();
    await expect(dialog).toBeVisible();
    await dialog.locator("#name").fill(name);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(name)).toBeVisible();
}

test.describe("Gestione duplicati amministrazione", () => {
    test("blocca duplicati su feste e prodotti mostrando errore", async ({ page, isMobile }) => {
        test.skip(isMobile, "Scenario verificato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Dup Event ${suffix}`;
        const categoryName = `Dup Category ${suffix}`;
        const productName = `Dup Product ${suffix}`;

        await ensureAdminAuthenticated(page, "/admin/settings/events");

        await createEventViaDialog(page, eventName);

        await page.locator("#new-event-btn").click();
        const duplicateEventDialog = page.getByRole("dialog").filter({ has: page.locator("#name") }).first();
        await expect(duplicateEventDialog).toBeVisible();
        await duplicateEventDialog.locator("#name").fill(eventName.toUpperCase());
        await duplicateEventDialog.getByRole("button", { name: "Salva", exact: true }).click();
        await expect(duplicateEventDialog.getByRole("alert")).toContainText(/Esiste già una festa con questo nome/i);
        await expect(duplicateEventDialog).toBeVisible();

        await duplicateEventDialog.press("Escape");
        await expect(duplicateEventDialog).toBeHidden();
        await expect(page.locator("h3").filter({ hasText: eventName })).toHaveCount(1);

        await selectEventContext(page, eventName);

        await page.goto("/admin/catalog");
        await page.click("#new-category-btn");
        const categoryDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Categoria/i }).first();
        await expect(categoryDialog).toBeVisible();
        await categoryDialog.locator("#cat-name").fill(categoryName);
        await categoryDialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();
        await expect(categoryDialog).toBeHidden();
        await expect(page.getByText(categoryName)).toBeVisible();

        await page.click("#new-product-btn");
        const productDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Prodotto/i }).first();
        await expect(productDialog).toBeVisible();
        await productDialog.getByLabel("Nome").fill(productName);
        await productDialog.getByLabel("Prezzo Base (€)").fill("5.50");
        await productDialog.locator('select[name="categoryId"]').selectOption({ label: categoryName });
        await productDialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
        await expect(productDialog).toBeHidden();
        await expect(page.getByText(productName)).toBeVisible();

        await page.click("#new-product-btn");
        const duplicateProductDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Prodotto/i }).first();
        await expect(duplicateProductDialog).toBeVisible();
        await duplicateProductDialog.getByLabel("Nome").fill(productName.toLowerCase());
        await duplicateProductDialog.getByLabel("Prezzo Base (€)").fill("5.50");
        await duplicateProductDialog.locator('select[name="categoryId"]').selectOption({ label: categoryName });
        await duplicateProductDialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
        await expect(duplicateProductDialog.getByRole("alert")).toContainText(/Esiste già un prodotto con questo nome/i);
        await expect(duplicateProductDialog).toBeVisible();

        await duplicateProductDialog.press("Escape");
        await expect(duplicateProductDialog).toBeHidden();
        await expect(page.locator("tr").filter({ hasText: new RegExp(productName, "i") })).toHaveCount(1);
    });
});
