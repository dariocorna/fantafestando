import { expect, test } from "@playwright/test";
import {
    createAndActivateEvent,
    createCategory,
    createProduct,
    deleteEvent,
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

        try {
            await createAndActivateEvent(page, eventName);
            await createCategory(page, categoryName);

            for (const product of products) {
                await createProduct(page, categoryName, product);
            }

            await page.goto("/admin/catalog");
            await expect(page.locator("tr").filter({ hasText: products[0].name }).first()).toBeVisible();
            await expect(page.locator("tr").filter({ hasText: products[4].name }).first()).toBeVisible();
        } finally {
            await deleteEvent(page, eventName);
        }
    });
});
