import { test, expect } from "@playwright/test";
import {
    createAndActivateEvent,
    createCategoryAndProducts,
    uniqueSuffix,
} from "./utils/fixtures";

test.describe("Menu pubblico — carrello", () => {
    test("aggiunta prodotti al carrello e navigazione a checkout", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Menu Cart ${suffix}`;
        const categoryName = `Piatti ${suffix}`;
        const productA = `Piatto A ${suffix}`;
        const productB = `Piatto B ${suffix}`;
        const productADescription = `Descrizione ${suffix}`;

        await createAndActivateEvent(page, eventName);
        await createCategoryAndProducts(page, categoryName, [
            { name: productA, price: "5.00", description: productADescription },
            { name: productB, price: "3.00" },
        ]);

        await page.goto("/menu");
        await page.waitForResponse(
            (r) => r.url().includes("/api/pos/init") && r.ok(),
            { timeout: 10000 },
        );

        await expect(page.getByRole("heading", { name: productA, level: 3 })).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole("heading", { name: productB, level: 3 })).toBeVisible({ timeout: 10000 });
        await expect(page.getByText(productADescription)).toBeVisible({ timeout: 10000 });
        await expect(page.getByText("Delizioso piatto tipico preparato con ingredienti freschi.")).toHaveCount(0);

        // Add product A via the add button inside its card (rounded-3xl)
        const cardA = page.locator(".rounded-3xl")
            .filter({ has: page.getByRole("heading", { name: productA, level: 3 }) })
            .first();
        await cardA.locator("button").first().click();

        // Add product B
        const cardB = page.locator(".rounded-3xl")
            .filter({ has: page.getByRole("heading", { name: productB, level: 3 }) })
            .first();
        await cardB.locator("button").first().click();

        // Cart floating button should now show
        const cartButton = page.getByRole("button", { name: /Vedi Carrello/i });
        await expect(cartButton).toBeVisible({ timeout: 5000 });
        await cartButton.click();

        // Cart dialog — click PROSEGUI to go to checkout
        const proseguiBtn = page.getByRole("button", { name: /PROSEGUI/i });
        await expect(proseguiBtn).toBeVisible({ timeout: 5000 });
        await proseguiBtn.click();

        // Verify checkout page shows our products
        await expect(page).toHaveURL(/\/menu\/checkout/);
        await expect(page.getByText(productA)).toBeVisible();
        await expect(page.getByText(productB)).toBeVisible();
        await expect(page.getByText(/8[,.]00\s*€/i)).toBeVisible();
    });
});
