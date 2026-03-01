import { expect, test, type Page } from "@playwright/test"
import { ensureAdminAuthenticated } from "./utils/auth"
import {
    createAndActivateEvent,
    configureCashPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    openCashSession,
    dismissFeedbackModal,
    uniqueSuffix,
    localPrinterIp,
} from "./utils/fixtures"

/**
 * Creates event and configures discount presets (test-specific).
 * Extends the shared createAndActivateEvent with discount preset setup.
 */
async function createEventWithDiscountPresets(page: Page, eventName: string) {
    await ensureAdminAuthenticated(page, "/admin/settings/events")
    await createAndActivateEvent(page, eventName)

    // Clear existing presets then add new ones
    const quickDiscountSection = page.locator("div").filter({ hasText: /Preset Sconti Rapidi POS/i }).first()
    for (let i = 0; i < 8; i++) {
        const removeButton = quickDiscountSection.getByRole("button", { name: /^Rimuovi$/i }).first()
        if (!(await removeButton.isVisible().catch(() => false))) break
        await removeButton.click()
    }

    await page.locator("#quick-discount-add-preset").click()
    await page.getByTestId("quick-discount-label-0").fill("Staff")
    await page.getByTestId("quick-discount-type-0").selectOption("PERCENT")
    await page.getByTestId("quick-discount-value-0").fill("50")

    await page.locator("#quick-discount-add-preset").click()
    await page.getByTestId("quick-discount-label-1").fill("Promo Cassa")
    await page.getByTestId("quick-discount-type-1").selectOption("FIXED")
    await page.getByTestId("quick-discount-value-1").fill("2")

    await expect(page.getByTestId("quick-discount-label-0")).toHaveValue("Staff")
    await expect(page.getByTestId("quick-discount-label-1")).toHaveValue("Promo Cassa")
    await page.getByRole("button", { name: /Salva Impostazioni/i }).click()
    await expect(page.getByText(/Modifiche salvate/i)).toBeVisible()
}

async function addProductsToCart(page: Page, productNames: string[]) {
    for (const name of productNames) {
        await page.locator("button").filter({ hasText: new RegExp(name) }).first().click()
    }
}

async function completeCheckout(page: Page) {
    const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
    await expect(checkoutDialog).toBeVisible()
    const confirmButton = checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true })
    await confirmButton.scrollIntoViewIfNeeded()
    await confirmButton.click()
    await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
    await dismissFeedbackModal(page)
}

test.describe("POS sconti e storno ordine", () => {
    test.describe.configure({ mode: "serial" })

    test("applica sconto ordine e riga, poi storna in admin", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Discount Event ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `Discount Cat ${suffix}`
        const productA = `Discount Product A ${suffix}`
        const productB = `Discount Product B ${suffix}`

        await createEventWithDiscountPresets(page, eventName)
        await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName)
        await createCategoryAndProducts(page, categoryName, [
            { name: productA, price: "8.00" },
            { name: productB, price: "4.00" },
        ])

        await openPosAndSelectDevice(page, posName)
        await openCashSession(page, "50")

        // Order 1: Staff 50% discount
        await addProductsToCart(page, [productA, productB])
        const panel = page.locator("#pos-discount-presets")
        if (!(await panel.isVisible().catch(() => false))) {
            await page.locator("#discounts-tab-trigger").click()
        }
        await expect(panel).toBeVisible()
        await expect(page.locator("#discount-preset-card-0")).toBeVisible()
        await page.locator("#discount-preset-card-0").click()
        await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/6\.00\s*€/i)
        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        await completeCheckout(page)

        // Order 2: Fixed -2€ discount
        await addProductsToCart(page, [productA, productB])
        if (!(await panel.isVisible().catch(() => false))) {
            await page.locator("#discounts-tab-trigger").click()
        }
        await expect(page.locator("#discount-preset-card-1")).toBeVisible()
        await page.locator("#discount-preset-card-1").click()
        await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/10\.00\s*€/i)
        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        await completeCheckout(page)

        // Verify orders in admin
        await page.goto("/admin/orders")
        const rows = page.locator("tbody tr")
        await expect(rows.first()).toContainText(/2\.00\s*€/i)
        await expect(rows.first()).toContainText(/10\.00\s*€/i)
        await expect(rows.nth(1)).toContainText(/6\.00\s*€/i)

        // Storno
        const dialogHandler = async (dialog: { type: () => string; accept: (promptText?: string) => Promise<void> }) => {
            if (dialog.type() === "prompt") await dialog.accept("Storno test E2E")
            else await dialog.accept()
        }
        page.on("dialog", dialogHandler)
        await rows.first().locator('button[title="Storna ordine"]').click()
        await expect(rows.first()).toContainText(/Stornato/i)
        await expect(rows.first()).toContainText(/Motivo storno:\s*Storno test E2E/i)
        page.off("dialog", dialogHandler)

        const revenueCard = page.locator("div").filter({ hasText: /Totale Incasso Netto/i }).first()
        await expect(revenueCard).toContainText(/6\.00\s*€/i)
    })
})
