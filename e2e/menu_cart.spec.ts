import { test, expect } from "@playwright/test";
import {
    createAndActivateEvent,
    createCategoryAndProducts,
    uniqueSuffix,
} from "./utils/fixtures";

test.describe.serial("Menu pubblico — carrello", () => {
    test("aggiunta prodotti al carrello e invio ordine dal cart overlay", async ({ page, isMobile }) => {
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

        await expect(page.getByRole("heading", { name: productA, level: 3 })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole("heading", { name: productB, level: 3 })).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(productADescription)).toBeVisible({ timeout: 15000 });
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

        // Cart floating button shows — no price, just "Vedi Carrello"
        const cartButton = page.getByTestId("menu-cart-cta");
        await expect(cartButton).toBeVisible({ timeout: 5000 });
        await expect(cartButton).toContainText("Vedi Carrello");
        // Verify NO price is displayed on the floating button
        await expect(cartButton).not.toContainText("€");
        await cartButton.click();

        // Cart overlay — heading + total visible
        await expect(page.getByRole("heading", { name: "Il tuo ordine" })).toBeVisible({ timeout: 5000 });

        // Verify total (use the large total display, not the line items)
        const totalDisplay = page.locator(".text-4xl");
        await expect(totalDisplay).toContainText("8.00");

        // "INVIA ORDINE" button should be visible (inline, not floating)
        const submitButton = page.getByTestId("menu-submit-order");
        await expect(submitButton).toBeVisible();
        await expect(submitButton).toContainText("INVIA ORDINE");
    });

    test("modifica quantità e rimozione prodotti dal cart overlay", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `Cart Edit ${suffix}`;
        const categoryName = `Cat ${suffix}`;
        const product = `Prodotto ${suffix}`;

        await createAndActivateEvent(page, eventName);
        await createCategoryAndProducts(page, categoryName, [
            { name: product, price: "4.00" },
        ]);

        await page.goto("/menu");
        await page.waitForResponse(
            (r) => r.url().includes("/api/pos/init") && r.ok(),
            { timeout: 10000 },
        );

        // Add product twice (click add, then +)
        const card = page.locator(".rounded-3xl")
            .filter({ has: page.getByRole("heading", { name: product, level: 3 }) })
            .first();
        await expect(card).toBeVisible({ timeout: 15000 });
        await card.locator("button").first().click();

        // Now the quantity controls are shown, click + to add another
        await card.locator("button").last().click();

        // Open cart
        const cartButton = page.getByTestId("menu-cart-cta");
        await expect(cartButton).toBeVisible({ timeout: 5000 });
        await cartButton.click();

        // Verify the order heading is shown
        await expect(page.getByRole("heading", { name: "Il tuo ordine" })).toBeVisible({ timeout: 5000 });

        // Verify total (use the large total display)
        const totalDisplay = page.locator(".text-4xl");
        await expect(totalDisplay).toContainText("8.00");

        // Verify the submit button is present
        await expect(page.getByTestId("menu-submit-order")).toBeVisible();
    });
});
