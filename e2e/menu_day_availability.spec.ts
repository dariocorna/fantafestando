import { test, expect, type Page } from "@playwright/test";

const DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_LABELS: Record<(typeof DAY_CODES)[number], string> = {
    MON: "LUN",
    TUE: "MAR",
    WED: "MER",
    THU: "GIO",
    FRI: "VEN",
    SAT: "SAB",
    SUN: "DOM"
};

function getCurrentRomeDayCode() {
    const shortDay = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: "Europe/Rome"
    }).format(new Date());

    const map: Record<string, (typeof DAY_CODES)[number]> = {
        Mon: "MON",
        Tue: "TUE",
        Wed: "WED",
        Thu: "THU",
        Fri: "FRI",
        Sat: "SAT",
        Sun: "SUN"
    };

    return map[shortDay] || "MON";
}

async function createAndActivateEvent(page: Page, eventName: string) {
    await page.goto("/admin/settings/events");

    await page.click("#new-event-btn");
    const dialog = page.getByRole("dialog");
    await dialog.locator("#name").fill(eventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(eventName)).toBeVisible();

    await page.click('[data-testid="admin-event-selector"]');
    await page.getByRole("option", { name: new RegExp(eventName) }).click();
    await expect(page.getByTestId("admin-event-selector")).toContainText(eventName);

    await page.goto("/admin/settings");
    const activeCheckbox = page.locator('input[name="active"]');
    if (!(await activeCheckbox.isChecked())) {
        await activeCheckbox.check();
    }
    await page.getByRole("button", { name: /Salva Impostazioni/i }).click();

    await expect
        .poll(
            async () => {
                await page.goto("/admin/settings/events");
                const eventCard = page.locator("div.p-4.border").filter({ hasText: eventName }).first();
                if (!(await eventCard.isVisible().catch(() => false))) return false;
                return await eventCard.getByText(/Attiva \(Globale\)/i).isVisible().catch(() => false);
            },
            { timeout: 15000 }
        )
        .toBeTruthy();
}

async function createCategory(page: Page, categoryName: string) {
    await page.goto("/admin/catalog");
    await page.click("#new-category-btn");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome").fill(categoryName);
    await dialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(categoryName)).toBeVisible();
}

async function createProduct(page: Page, options: {
    name: string;
    categoryName: string;
    price: string;
    dayLabel?: string;
}) {
    await page.click("#new-product-btn");
    const dialog = page.getByRole("dialog");

    await dialog.getByLabel("Nome").fill(options.name);
    await dialog.getByLabel("Prezzo Base (€)").fill(options.price);
    await dialog.locator('select[name="categoryId"]').selectOption({ label: options.categoryName });

    if (options.dayLabel) {
        await dialog.getByRole("button", { name: options.dayLabel, exact: true }).click();
    }

    await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(options.name)).toBeVisible();
}

async function setProductAvailableDay(page: Page, productName: string, dayLabel: string) {
    await page.goto("/admin/catalog");
    const productRow = page.locator("tr").filter({ hasText: productName }).first();
    await productRow.getByRole("button", { name: "Modifica", exact: true }).click();

    const dialog = page.getByRole("dialog").filter({ hasText: /Modifica Prodotto/i });
    await dialog.getByRole("button", { name: dayLabel, exact: true }).click();
    await dialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click();

    await expect
        .poll(
            async () => productRow.getByText(dayLabel, { exact: true }).isVisible().catch(() => false),
            { timeout: 10000 }
        )
        .toBeTruthy();
}

test.describe("Disponibilità prodotti per giorno", () => {
    test.describe.configure({ mode: "serial" });

    test("mostra nel menu solo i prodotti disponibili oggi", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const eventName = `Day Availability ${suffix}`;
        const categoryName = `Piatti ${suffix}`;
        const alwaysProductName = `Sempre ${suffix}`;
        const limitedProductName = `SoloAltroGiorno ${suffix}`;

        const todayCode = getCurrentRomeDayCode();
        const todayIndex = DAY_CODES.indexOf(todayCode);
        const hiddenDayCode = DAY_CODES[(todayIndex + 1) % DAY_CODES.length];
        const hiddenDayLabel = DAY_LABELS[hiddenDayCode];

        await createAndActivateEvent(page, eventName);
        await createCategory(page, categoryName);

        await createProduct(page, {
            name: alwaysProductName,
            categoryName,
            price: "8.00"
        });

        await createProduct(page, {
            name: limitedProductName,
            categoryName,
            price: "9.00",
            dayLabel: hiddenDayLabel
        });

        const limitedProductRow = page.locator("tr").filter({ hasText: limitedProductName });
        await expect(limitedProductRow.getByText(hiddenDayLabel, { exact: true })).toBeVisible();

        await page.goto("/menu");
        await page.waitForResponse(
            (response) => response.url().includes("/api/pos/init") && response.ok(),
            { timeout: 10000 }
        );

        await expect(page.getByText(alwaysProductName)).toBeVisible();
        await expect(page.getByText(limitedProductName)).toHaveCount(0);
    });

    test("blocca checkout se il carrello contiene prodotti non più disponibili oggi", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.");

        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const eventName = `Day Availability Guard ${suffix}`;
        const categoryName = `Piatti ${suffix}`;
        const productName = `ProdottoStale ${suffix}`;

        const todayCode = getCurrentRomeDayCode();
        const todayIndex = DAY_CODES.indexOf(todayCode);
        const hiddenDayCode = DAY_CODES[(todayIndex + 1) % DAY_CODES.length];
        const hiddenDayLabel = DAY_LABELS[hiddenDayCode];

        await createAndActivateEvent(page, eventName);
        await createCategory(page, categoryName);
        await createProduct(page, {
            name: productName,
            categoryName,
            price: "7.00"
        });

        await page.goto("/menu");
        await page.waitForResponse(
            (response) => response.url().includes("/api/pos/init") && response.ok(),
            { timeout: 10000 }
        );
        await expect(page.getByText(productName)).toBeVisible();

        const productCard = page
            .locator("div.bg-white")
            .filter({ has: page.getByRole("heading", { name: productName, level: 3 }) })
            .first();
        await productCard.locator("button").first().click();
        await page.getByRole("button", { name: /Vedi Carrello/i }).click();
        await page.getByRole("button", { name: /PROSEGUI/i }).click();

        await expect(page).toHaveURL(/\/menu\/checkout/);
        await expect(page.getByText(productName)).toBeVisible();

        await setProductAvailableDay(page, productName, hiddenDayLabel);

        await page.goto("/menu/checkout");
        await expect(page.getByText(productName)).toBeVisible();

        await page.getByRole("button", { name: /INVIA ORDINE/i }).click();
        const errorBanner = page.getByRole("alert").filter({ hasText: /non sono più disponibili oggi/i }).first();
        await expect(errorBanner).toBeVisible();
        await expect(page).toHaveURL(/\/menu\/checkout/);
    });
});
