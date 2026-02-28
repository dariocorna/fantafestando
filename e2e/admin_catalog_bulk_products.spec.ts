import { expect, test } from "@playwright/test";
import {
    createCategory,
    createProduct,
    deleteEvent,
    selectEventContext,
    uniqueSuffix,
} from "./utils/fixtures";

test.describe("Catalogo - inserimento massivo prodotti", () => {
    test("crea festa, categoria, 5 prodotti e poi elimina la festa", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop");
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `Bulk Event ${suffix}`;
        const categoryName = `Bulk Category ${suffix}`;

        const products = Array.from({ length: 5 }, (_, index) => ({
            name: `Bulk Product ${index + 1} ${suffix}`,
            price: (((index % 9) + 1) * 1.25).toFixed(2),
        }));

        await page.goto("/admin/settings/events");
        await page.click("#new-event-btn");
        const dialog = page.getByRole("dialog");
        await dialog.locator("#name").fill(eventName);
        await dialog.getByRole("button", { name: "Salva", exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByText(eventName)).toBeVisible();

        await selectEventContext(page, eventName);
        await createCategory(page, categoryName);

        for (const product of products) {
            await createProduct(page, categoryName, product);
        }

        await page.goto("/admin/catalog");
        await expect(page.locator("tr").filter({ hasText: products[0].name }).first()).toBeVisible();
        await expect(page.locator("tr").filter({ hasText: products[4].name }).first()).toBeVisible();

        await deleteEvent(page, eventName);
    });
});
