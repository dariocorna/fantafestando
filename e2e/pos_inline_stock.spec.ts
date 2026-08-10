import { expect, test, type Page } from "@playwright/test"
import { cleanupEventArtifactsByName } from "./utils/db"
import {
    createActiveEventWithCatalogDirect,
    createVirtualPrinterDirect,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures"
import dbConnect from "../src/lib/mongoose"
import Peripheral from "../src/models/Peripheral"
import PosDevice from "../src/models/PosDevice"
import Product from "../src/models/Product"

const variantLabel = "Doppia"

async function addVariantToProduct(eventId: string, productName: string, stockQuantity: number) {
    await dbConnect()
    const product = await Product.findOne({ eventId, name: productName }).lean<{ _id: string }>()
    if (!product?._id) throw new Error(`Prodotto non trovato: ${productName}`)

    await Product.updateOne(
        { _id: product._id },
        { $set: { variants: [{ optionName: variantLabel, priceVariation: 0, stockQuantity }] } },
    )

    return String(product._id)
}

async function loadProduct(eventId: string, productName: string) {
    await dbConnect()
    return Product.findOne({ eventId, name: productName }).lean<{
        _id: string
        stockQuantity: number | null
        variants?: Array<{ optionName: string; stockQuantity?: number | null }>
    }>()
}

async function setupPosStockEvent(page: Page, suffix: string) {
    const eventName = `POS Stock Inline ${suffix}`
    const printerName = `POS Stock Printer ${suffix}`
    const cashBoxName = `POS Stock CashBox ${suffix}`
    const posName = `POS Stock Terminal ${suffix}`
    const categoryName = `POS Stock Cat ${suffix}`
    const productName = `POS Stock Product ${suffix}`

    const { eventId } = await createActiveEventWithCatalogDirect(eventName, categoryName, [{
        name: productName,
        price: "8.00",
        stock: "4",
    }])
    const [{ printerId }, cashBox] = await Promise.all([
        createVirtualPrinterDirect({ eventName, printerName, type: "CASHIER" }),
        Peripheral.create({ eventId, name: cashBoxName, type: "CASH_BOX", config: {} }),
    ])
    await PosDevice.create({ eventId, name: posName, printerId, cashBoxId: cashBox._id })

    const productId = await addVariantToProduct(eventId, productName, 3)
    await openPosAndSelectDevice(page, posName)
    await openCashSessionIfRequired(page, "0")

    return {
        eventId,
        eventName,
        productName,
        productId,
    }
}

function getCartQuantityLocator(page: Page) {
    const row = page.locator('[data-testid^="cart-item-row-"]').first()
    return row.locator('[data-testid^="cart-item-quantity-"]').first()
}

test.describe("POS modalità scorte inline", () => {
    test("blocca il carrello in sola lettura in modalità scorte e ripristina l'aggiunta", async ({ page, isMobile }) => {
        const suffix = uniqueSuffix()
        const eventName = `POS Stock Inline ${suffix}`

        try {
            const setup = await setupPosStockEvent(page, suffix)
            const stockButton = page.getByRole("button", { name: /Scorte/i })
            const productButton = page.locator("button").filter({ hasText: new RegExp(setup.productName) }).first()
            await productButton.click()
            if (isMobile) await page.getByTestId("pos-mobile-cart-bar").click()

            await expect(getCartQuantityLocator(page)).toHaveText("1")
            if (isMobile) await page.keyboard.press("Escape")

            await stockButton.click()
            await expect(stockButton).toHaveAttribute("aria-pressed", "true")
            await expect(page.getByTestId("pos-stock-mode-banner")).toBeVisible()
            if (isMobile) {
                await page.getByRole("button", { name: "Cassa aperta", exact: true }).click()
                const cashStatusSheet = page.getByRole("dialog", { name: "Stato cassa" })
                await expect(cashStatusSheet.getByRole("button", { name: "Chiudi Cassa", exact: true })).toBeDisabled()
                await page.keyboard.press("Escape")
            } else {
                const closeCashButton = page.getByTestId("pos-desktop-cash-menu").getByRole("button", { name: "Chiudi Cassa", exact: true })
                if (!(await closeCashButton.isVisible())) await page.getByTestId("pos-desktop-cash-menu-trigger").click()
                await expect(closeCashButton).toBeDisabled()
            }

            const stockProductSection = page.locator(`[data-testid="stock-product-${setup.productId}"]`)
            await expect(stockProductSection).toBeVisible()

            await stockProductSection.click()
            if (isMobile) await page.getByTestId("pos-mobile-cart-bar").click()
            await expect(getCartQuantityLocator(page)).toHaveText("1")

            await expect(page.getByTestId("pos-pay-cta")).toBeDisabled()

            const cartRow = page.locator('[data-testid^="cart-item-row-"]').first()
            await expect(cartRow.getByRole("button", { name: /Rimuovi .* dal carrello/i })).toBeDisabled()
            await expect(cartRow.getByRole("button", { name: /Diminuisci quantità/i })).toBeDisabled()
            await expect(cartRow.getByRole("button", { name: /Aumenta quantità/i })).toBeDisabled()

            if (isMobile) await page.keyboard.press("Escape")
            await stockButton.click()
            await expect(stockButton).toHaveAttribute("aria-pressed", "false")
            await expect(page.getByTestId("pos-stock-mode-banner")).toHaveCount(0)

            await productButton.click()
            if (isMobile) await page.getByTestId("pos-mobile-cart-bar").click()
            await expect(getCartQuantityLocator(page)).toHaveText("2")
            await expect(page.getByTestId("pos-pay-cta")).toBeEnabled()
        } finally {
            await cleanupEventArtifactsByName(eventName)
        }
    })

    test("salva scorte prodotto/variante e gestisce input non validi senza loading", async ({ page }) => {
        const suffix = uniqueSuffix()
        const eventName = `POS Stock Inline ${suffix}`

        try {
            const setup = await setupPosStockEvent(page, suffix)
            const stockButton = page.getByRole("button", { name: /Scorte/i })
            await stockButton.click()
            const stockProductSection = page.locator(`[data-testid="stock-product-${setup.productId}"]`)
            await expect(stockProductSection).toBeVisible()

            const productInput = stockProductSection.getByRole("spinbutton", { name: `Scorta ${setup.productName}` })
            const productSave = stockProductSection.getByRole("button", { name: /Salva/i })
            const unlimitedButton = stockProductSection.getByRole("button", { name: /Illimitata/i })

            await productInput.fill("12")
            await productSave.click()
            await expect(stockProductSection.getByRole("status")).toHaveText(`Scorta ${setup.productName} aggiornata a 12`)

            let product = await loadProduct(setup.eventId, setup.productName)
            expect(product?.stockQuantity).toBe(12)

            await productInput.fill("0")
            await productSave.click()
            await expect(stockProductSection.getByRole("status")).toHaveText(`Scorta ${setup.productName} aggiornata a 0`)

            product = await loadProduct(setup.eventId, setup.productName)
            expect(product?.stockQuantity).toBe(0)

            await unlimitedButton.click()
            await expect(stockProductSection.getByRole("status")).toHaveText(`Scorta ${setup.productName} aggiornata a illimitata`)

            product = await loadProduct(setup.eventId, setup.productName)
            expect(product?.stockQuantity).toBeNull()

            const variantSection = page.locator(`[data-testid="stock-variant-${setup.productId}-${variantLabel}"]`)
            const variantInput = variantSection.getByRole("spinbutton", { name: `Scorta ${variantLabel}` })
            const variantSave = variantSection.getByRole("button", { name: /Salva/i })

            await variantInput.fill("7")
            await variantSave.click()
            await expect(variantSection.getByRole("status")).toHaveText(`Scorta ${variantLabel} aggiornata a 7`)

            product = await loadProduct(setup.eventId, setup.productName)
            expect(product?.variants?.[0]?.stockQuantity).toBe(7)

            await productInput.fill("1.5")
            await productSave.click()
            await expect(stockProductSection.getByRole("alert")).toHaveText("Inserisci un intero maggiore o uguale a zero")
            await expect(productSave).toBeEnabled()

            await productInput.fill("-3")
            await productSave.click()
            await expect(stockProductSection.getByRole("alert")).toHaveText("Inserisci un intero maggiore o uguale a zero")
            await expect(productSave).toBeEnabled()
        } finally {
            await cleanupEventArtifactsByName(eventName)
        }
    })
})
