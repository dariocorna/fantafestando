import { expect, test, type Page } from "@playwright/test"
import mongoose from "mongoose"
import { ensureAdminAuthenticated } from "./utils/auth"
import {
    configureCashPos,
    closeCashSession,
    openPosAndSelectDevice,
    openCashSession,
    dismissFeedbackModal,
    uniqueSuffix,
    localPrinterIp,
    seedActiveEventWithCatalog,
} from "./utils/fixtures"
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db"

/**
 * Creates event and configures discount presets (test-specific).
 * Extends the shared createAndActivateEvent with discount preset setup.
 */
async function createEventWithDiscountPresets(
    eventName: string,
    categoryName: string,
    products: Array<{ name: string; price: string }>
) {
    await seedActiveEventWithCatalog(eventName, categoryName, products)
    await ensureDbConnection()
    const db = mongoose.connection.db
    if (!db) {
        throw new Error("Connessione Mongo non disponibile per il setup sconti E2E.")
    }

    await db.collection("events").updateOne(
        { name: eventName },
        {
            $set: {
                "settings.quickDiscountPresets": [
                    { label: "Staff", type: "PERCENT", value: 50 },
                    { label: "Promo Cassa", type: "FIXED", value: 2 },
                    { label: "Tesserati", type: "PERCENT", value: 20 },
                    { label: "Convenzione A", type: "PERCENT", value: 5 },
                    { label: "Convenzione B", type: "PERCENT", value: 10 },
                    { label: "Convenzione C", type: "PERCENT", value: 15 },
                    { label: "Buono 1", type: "FIXED", value: 1 },
                    { label: "Buono 3", type: "FIXED", value: 3 }
                ]
            }
        }
    )
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

        try {
            await page.setViewportSize({ width: 1366, height: 768 })
            await createEventWithDiscountPresets(eventName, categoryName, [
                { name: productA, price: "8.00" },
                { name: productB, price: "4.00" },
            ])
            await ensureAdminAuthenticated(page, "/admin/settings/hardware")
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName)

            await openPosAndSelectDevice(page, posName)
            await openCashSession(page, "50")

            // Order 1: Staff 50% discount
            await addProductsToCart(page, [productA, productB])
            const panel = page.locator("#pos-discount-presets")
            await expect(panel).toBeVisible()
            const discountsBox = await page.getByTestId("pos-desktop-discounts").boundingBox()
            const cartBox = await page.getByTestId("pos-desktop-cart-items").boundingBox()
            expect(discountsBox).not.toBeNull()
            expect(cartBox).not.toBeNull()
            expect(discountsBox!.height).toBeLessThanOrEqual(190)
            expect(cartBox!.height).toBeGreaterThanOrEqual(120)
            await expect(page.locator("#discount-preset-card-0")).toBeVisible()
            await page.locator("#discount-preset-card-0").click()
            await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/6\.00\s*€/i)
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            await completeCheckout(page)

            // Order 2: Fixed -2€ discount
            await addProductsToCart(page, [productA, productB])
            await expect(panel).toBeVisible()
            await expect(page.locator("#discount-preset-card-1")).toBeVisible()
            await page.locator("#discount-preset-card-1").click()
            await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/10\.00\s*€/i)
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            await completeCheckout(page)

            await closeCashSession(page, "66")
            await page.getByTestId("pos-desktop-cash-menu-trigger").click()
            await expect(page.getByText("Ultima chiusura", { exact: true })).toBeVisible()
            const payCtaBox = await page.getByTestId("pos-pay-cta").boundingBox()
            expect(payCtaBox).not.toBeNull()
            expect(payCtaBox!.y + payCtaBox!.height).toBeLessThanOrEqual(768)

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
        } finally {
            await cleanupEventArtifactsByName(eventName)
        }
    })

    test("lo sconto percentuale si applica anche alle voci aggiunte dopo", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Discount Grow Event ${suffix}`
        const printerName = `Grow Cashier ${suffix}`
        const cashBoxName = `Grow CashBox ${suffix}`
        const posName = `Grow POS ${suffix}`
        const categoryName = `Grow Cat ${suffix}`
        const productA = `Grow Product A ${suffix}`
        const productB = `Grow Product B ${suffix}`

        try {
            await createEventWithDiscountPresets(eventName, categoryName, [
                { name: productA, price: "10.00" },
                { name: productB, price: "3.00" },
            ])
            await ensureAdminAuthenticated(page, "/admin/settings/hardware")
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName)

            await openPosAndSelectDevice(page, posName)
            await openCashSession(page, "50")

            // Applica 50% con il solo prodotto A (10€) -> totale 5€.
            await addProductsToCart(page, [productA])
            const panel = page.locator("#pos-discount-presets")
            await expect(panel).toBeVisible()
            await expect(page.locator("#discount-preset-card-0")).toBeVisible()
            await page.locator("#discount-preset-card-0").click()
            await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/5\.00\s*€/i)
            await page.locator("#discount-preset-card-2").click()
            await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/4\.00\s*€/i)

            // Aggiungi B (3€) DOPO gli sconti: 50% di 13€ e poi 20% dei 6.50€ residui.
            await addProductsToCart(page, [productB])
            await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/5\.20\s*€/i)

            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            await completeCheckout(page)

            await ensureDbConnection()
            const db = mongoose.connection.db
            if (!db) throw new Error("DB non disponibile")
            const event = await db.collection("events").findOne({ name: eventName })
            const order = await db.collection("orders").findOne({ eventId: event?._id, status: "PAID" })
            expect(order?.totalAmount).toBeCloseTo(5.2, 2)
        } finally {
            await cleanupEventArtifactsByName(eventName)
        }
    })
})
