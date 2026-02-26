import { expect, test, type Page } from "@playwright/test";

function randomToken(length = 6): string {
    return Math.random().toString(36).slice(2, 2 + length);
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createEvent(page: Page, eventName: string) {
    await page.goto("/admin/settings/events");
    await page.click("#new-event-btn");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#name").fill(eventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator("div.p-4.border").filter({ hasText: eventName }).first()).toBeVisible({ timeout: 10000 });
}

async function selectEventContext(page: Page, eventName: string) {
    await page.click('[data-testid="admin-event-selector"]');
    const exactEventOption = page.getByRole("option", {
        name: new RegExp(`^${escapeRegExp(eventName)}(\\s+\\(Attiva\\))?$`)
    });
    await exactEventOption.click();
    await expect(page.getByTestId("admin-event-selector")).toContainText(eventName);
}

async function createCategory(page: Page, categoryName: string) {
    await page.goto("/admin/catalog");
    await page.click("#new-category-btn");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#cat-name").fill(categoryName);
    await dialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator("tr").filter({ hasText: categoryName }).first()).toBeVisible({ timeout: 10000 });
}

async function createProductWithRetry(
    page: Page,
    categoryName: string,
    productName: string,
    price: string,
    maxAttempts = 3
) {
    const productRow = page.locator("tr").filter({ hasText: productName }).first();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await page.goto("/admin/catalog");
        await page.click("#new-product-btn");

        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();

        await dialog.locator("#prod-name").fill(productName);
        await dialog.locator('input[name="basePrice"]').fill(price);
        await dialog.locator('select[name="categoryId"]').selectOption({ label: categoryName });
        await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click();

        try {
            await expect(dialog).toBeHidden({ timeout: 10000 });
            await expect(productRow).toBeVisible({ timeout: 10000 });
            return;
        } catch (error) {
            if (attempt === maxAttempts) {
                throw error;
            }

            await page.keyboard.press("Escape").catch(() => undefined);
            await page.waitForTimeout(500);
        }
    }
}

async function deleteEvent(page: Page, eventName: string) {
    await page.goto("/admin/settings/events");

    const eventCard = page.locator("div.p-4.border").filter({ hasText: eventName }).first();
    await expect(eventCard).toBeVisible({ timeout: 10000 });

    await eventCard.locator("button.text-red-500").first().click();
    const continueButton = page.getByRole("button", { name: "Continua", exact: true });
    await expect(continueButton).toBeVisible();
    await continueButton.click();

    await expect(eventCard).toBeHidden({ timeout: 10000 });
}

test.describe("Catalogo - inserimento massivo prodotti", () => {
    test("crea festa, categoria, 20 prodotti random e poi elimina la festa", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop");
        test.setTimeout(180000);

        const suffix = `${Date.now()}-${randomToken(4)}`;
        const eventName = `Bulk Event ${suffix}`;
        const categoryName = `Bulk Category ${suffix}`;

        const products = Array.from({ length: 20 }, (_, index) => ({
            name: `Bulk Product ${index + 1} ${suffix} ${randomToken(3)}`,
            price: (((index % 9) + 1) * 1.25).toFixed(2)
        }));

        await createEvent(page, eventName);
        await selectEventContext(page, eventName);

        await createCategory(page, categoryName);

        for (const product of products) {
            await createProductWithRetry(page, categoryName, product.name, product.price);
        }

        await page.goto("/admin/catalog");
        await expect(page.locator("tr").filter({ hasText: products[0].name }).first()).toBeVisible();
        await expect(page.locator("tr").filter({ hasText: products[19].name }).first()).toBeVisible();

        await deleteEvent(page, eventName);
    });
});
