import { test, expect, type Page } from "@playwright/test"
import {
    createAndActivateEvent,
    createCategory,
    createProduct,
    uniqueSuffix,
} from "./utils/fixtures"

const DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const
const DAY_LABELS: Record<(typeof DAY_CODES)[number], string> = {
    MON: "LUN", TUE: "MAR", WED: "MER", THU: "GIO", FRI: "VEN", SAT: "SAB", SUN: "DOM",
}

function getCurrentRomeDayCode() {
    const shortDay = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Europe/Rome" }).format(new Date())
    const map: Record<string, (typeof DAY_CODES)[number]> = {
        Mon: "MON", Tue: "TUE", Wed: "WED", Thu: "THU", Fri: "FRI", Sat: "SAT", Sun: "SUN",
    }
    return map[shortDay] || "MON"
}

async function createProductWithDay(page: Page, options: {
    name: string; categoryName: string; price: string; dayLabel?: string;
}) {
    await page.click("#new-product-btn")
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Nome").fill(options.name)
    await dialog.getByLabel("Prezzo Base (€)").fill(options.price)
    await dialog.locator('select[name="categoryId"]').selectOption({ label: options.categoryName })
    if (options.dayLabel) {
        await dialog.getByRole("button", { name: options.dayLabel, exact: true }).click()
    }
    await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText(options.name)).toBeVisible()
}

test.describe("Disponibilità prodotti per giorno", () => {
    test.describe.configure({ mode: "serial" })

    test.beforeEach(async ({ page }) => {
        page.on('console', msg => {
            if (msg.text().startsWith('[DEBUG]')) {
                console.log(msg.text());
            }
        });
    });

    test("mostra nel menu solo i prodotti disponibili oggi", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")

        const suffix = uniqueSuffix()
        const eventName = `Day Availability ${suffix}`
        const categoryName = `Piatti ${suffix}`
        const alwaysProductName = `Sempre ${suffix}`
        const limitedProductName = `SoloAltroGiorno ${suffix}`

        const todayCode = getCurrentRomeDayCode()
        const todayIndex = DAY_CODES.indexOf(todayCode)
        const hiddenDayCode = DAY_CODES[(todayIndex + 1) % DAY_CODES.length]
        const hiddenDayLabel = DAY_LABELS[hiddenDayCode]

        await createAndActivateEvent(page, eventName)
        await createCategory(page, categoryName)

        await createProductWithDay(page, { name: alwaysProductName, categoryName, price: "8.00" })
        await createProductWithDay(page, { name: limitedProductName, categoryName, price: "9.00", dayLabel: hiddenDayLabel })

        const limitedRow = page.locator("tr").filter({ hasText: limitedProductName })
        await expect(limitedRow.getByText(hiddenDayLabel, { exact: true })).toBeVisible()

        await page.goto("/menu")
        await page.waitForResponse(r => r.url().includes("/api/pos/init") && r.ok(), { timeout: 10000 })

        await expect(page.getByText(alwaysProductName)).toBeVisible()
        await expect(page.getByText(limitedProductName)).toHaveCount(0)
    })

    test("blocca checkout se il carrello contiene prodotti non più disponibili oggi", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")

        const suffix = uniqueSuffix()
        const eventName = `Day Availability Guard ${suffix}`
        const categoryName = `Piatti ${suffix}`
        const productName = `ProdottoStale ${suffix}`

        const todayCode = getCurrentRomeDayCode()
        const todayIndex = DAY_CODES.indexOf(todayCode)
        const hiddenDayCode = DAY_CODES[(todayIndex + 1) % DAY_CODES.length]
        const hiddenDayLabel = DAY_LABELS[hiddenDayCode]

        await createAndActivateEvent(page, eventName)
        await createCategory(page, categoryName)
        await createProductWithDay(page, { name: productName, categoryName, price: "7.00" })

        await page.goto("/menu")
        await page.waitForResponse(r => r.url().includes("/api/pos/init") && r.ok(), { timeout: 10000 })
        await expect(page.getByText(productName).first()).toBeVisible()

        const productCard = page.locator("div.bg-white")
            .filter({ has: page.getByRole("heading", { name: productName, level: 3 }) }).first()
        await productCard.locator("button").first().click()
        await page.getByRole("button", { name: /Vedi Carrello/i }).click()

        // Wait for overlay to be visible
        await expect(page.getByRole("heading", { name: "Il tuo ordine" })).toBeVisible()
        await expect(page.getByText(productName).first()).toBeVisible()

        // Change product availability to a different day
        await page.goto("/admin/catalog")
        const productRow = page.locator("tr").filter({ hasText: productName }).first()
        await productRow.getByRole("button", { name: "Modifica", exact: true }).click()
        const editDialog = page.getByRole("dialog").filter({ hasText: /Modifica Prodotto/i })
        await editDialog.getByRole("button", { name: hiddenDayLabel, exact: true }).click()
        await editDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click()
        await expect.poll(
            async () => productRow.getByText(hiddenDayLabel, { exact: true }).isVisible().catch(() => false),
            { timeout: 10000 },
        ).toBeTruthy()

        await page.goto("/menu")
        await page.getByRole("button", { name: /Vedi Carrello/i }).click()
        await expect(page.getByRole("heading", { name: "Il tuo ordine" })).toBeVisible()
        await expect(page.getByText(productName).first()).toBeVisible()

        await page.getByRole("button", { name: /INVIA ORDINE/i }).click();
        await expect(page.getByText(/alcuni prodotti.*non sono più disponibili/i)).toBeVisible();

    })
})
