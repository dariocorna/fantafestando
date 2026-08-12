import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test"
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

const adminStorageState = "test-results/.auth/admin.json"
const variantLabel = "Doppia"

async function setupRealtimeStockEvent(suffix: string, includeVariant = false) {
    const eventName = `POS Stock Realtime ${suffix}`
    const categoryName = `POS Stock Realtime Cat ${suffix}`
    const productName = `POS Stock Realtime Product ${suffix}`
    const printerName = `POS Stock Realtime Printer ${suffix}`
    const posAName = `POS Stock Realtime A ${suffix}`
    const posBName = `POS Stock Realtime B ${suffix}`

    const { eventId } = await createActiveEventWithCatalogDirect(eventName, categoryName, [{
        name: productName,
        price: "8.00",
        stock: "1",
    }])
    const { printerId } = await createVirtualPrinterDirect({ eventName, printerName, type: "CASHIER" })
    const [cashBoxA, cashBoxB] = await Promise.all([
        Peripheral.create({ eventId, name: `CashBox A ${suffix}`, type: "CASH_BOX", config: {} }),
        Peripheral.create({ eventId, name: `CashBox B ${suffix}`, type: "CASH_BOX", config: {} }),
    ])
    const [, posB] = await Promise.all([
        PosDevice.create({ eventId, name: posAName, printerId, cashBoxId: cashBoxA._id }),
        PosDevice.create({ eventId, name: posBName, printerId, cashBoxId: cashBoxB._id }),
    ])

    await dbConnect()
    const product = await Product.findOne({ eventId, name: productName }).select("_id").lean<{ _id: string }>()
    if (!product?._id) throw new Error(`Prodotto non trovato: ${productName}`)
    if (includeVariant) {
        await Product.updateOne(
            { _id: product._id },
            { $set: { variants: [{ optionName: variantLabel, priceVariation: 0, stockQuantity: 3 }] } },
        )
    }

    return {
        productId: String(product._id),
        productName,
        posAName,
        posBId: String(posB._id),
        posBName,
    }
}

async function setInlineStock(page: Page, productId: string, label: string, quantity: string) {
    const section = page.getByTestId(label === variantLabel
        ? `stock-variant-${productId}-${variantLabel}`
        : `stock-product-${productId}`)
    await section.getByRole("spinbutton", {
        name: label === variantLabel ? new RegExp(`Scorta .+ - ${variantLabel}$`) : `Scorta ${label}`,
    }).fill(quantity)
    await section.getByRole("button", { name: /Salva/i }).click()
    await expect(section.getByRole("status")).toHaveText(label === variantLabel
        ? new RegExp(`Scorta .+ - ${variantLabel} aggiornata a ${quantity}$`)
        : `Scorta ${label} aggiornata a ${quantity}`)
}

function cartQuantity(page: Page) {
    return page.locator('[data-testid^="cart-item-quantity-"]').first()
}

async function closeContexts(contexts: Array<BrowserContext | undefined>) {
    await Promise.allSettled(contexts.filter((context): context is BrowserContext => Boolean(context)).map((context) => context.close()))
}

test.describe("POS scorte realtime tra postazioni", () => {
    test.describe.configure({ mode: "serial" })

    test("propaga prodotto e variante senza perdere carrello o cassa e blocca la sovravendita", async ({ browser, baseURL, isMobile }) => {
        test.skip(isMobile, "Flusso multi-postazione validato su desktop.")

        const suffix = uniqueSuffix()
        const eventName = `POS Stock Realtime ${suffix}`
        let contextA: BrowserContext | undefined
        let contextB: BrowserContext | undefined

        try {
            const setup = await setupRealtimeStockEvent(suffix, true)
            ;[contextA, contextB] = await Promise.all([
                browser.newContext({ baseURL, storageState: adminStorageState }),
                browser.newContext({ baseURL, storageState: adminStorageState }),
            ])
            const pageA = await contextA.newPage()
            const pageB = await contextB.newPage()

            await Promise.all([
                openPosAndSelectDevice(pageA, setup.posAName),
                openPosAndSelectDevice(pageB, setup.posBName),
            ])
            await Promise.all([
                expect(pageA.getByTestId("pos-stock-sync-status")).toHaveText("Scorte sincronizzate"),
                expect(pageB.getByTestId("pos-stock-sync-status")).toHaveText("Scorte sincronizzate"),
            ])
            await openCashSessionIfRequired(pageB, "0")

            const productCardB = pageB.getByTestId(`pos-product-${setup.productId}`)
            await productCardB.click()
            await expect(cartQuantity(pageB)).toHaveText("1")
            await expect(pageB.getByTestId("pos-desktop-cash-menu-trigger")).toContainText(setup.posBName)
            expect(await pageB.evaluate(() => localStorage.getItem("fantafestando_pos_id"))).toBe(setup.posBId)

            await Promise.all([
                pageA.getByRole("button", { name: "Scorte", exact: true }).click(),
                pageB.getByRole("button", { name: "Scorte", exact: true }).click(),
            ])

            const variantSectionB = pageB.getByTestId(`stock-variant-${setup.productId}-${variantLabel}`)
            const variantStockB = variantSectionB.getByRole("spinbutton", { name: new RegExp(`Scorta .+ - ${variantLabel}$`) })
            await expect(variantStockB).toHaveValue("3")
            await setInlineStock(pageA, setup.productId, variantLabel, "7")
            await expect(variantStockB).toHaveValue("7")
            await expect(cartQuantity(pageB)).toHaveText("1")

            await pageB.getByRole("button", { name: "Termina scorte", exact: true }).click()
            await setInlineStock(pageA, setup.productId, setup.productName, "0")
            await expect(productCardB).toContainText("Esaurito")
            await expect(cartQuantity(pageB)).toHaveText("1")
            await expect(pageB.getByTestId("pos-desktop-cash-menu-trigger")).toContainText(setup.posBName)
            expect(await pageB.evaluate(() => localStorage.getItem("fantafestando_pos_id"))).toBe(setup.posBId)

            await pageB.getByTestId("pos-pay-cta").click()
            const checkoutDialog = pageB.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
            await expect(checkoutDialog).toBeVisible()
            const confirmButton = checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true })
            await confirmButton.scrollIntoViewIfNeeded()
            await confirmButton.click()
            await expect(checkoutDialog.getByText(/Scorte insufficienti rilevate/i)).toBeVisible()
            await expect(checkoutDialog.locator("li").filter({ hasText: new RegExp(`^${setup.productName}:`) })).toBeVisible()
            await expect(cartQuantity(pageB)).toHaveText("1")
        } finally {
            await closeContexts([contextA, contextB])
            await cleanupEventArtifactsByName(eventName)
        }
    })

    test("usa il polling quando SSE cade e torna live riallineando lo snapshot", async ({ browser, baseURL, isMobile }) => {
        test.skip(isMobile, "Flusso multi-postazione validato su desktop.")

        const suffix = uniqueSuffix()
        const eventName = `POS Stock Realtime ${suffix}`
        let contextA: BrowserContext | undefined
        let contextB: BrowserContext | undefined

        try {
            const setup = await setupRealtimeStockEvent(suffix)
            ;[contextA, contextB] = await Promise.all([
                browser.newContext({ baseURL, storageState: adminStorageState }),
                browser.newContext({ baseURL, storageState: adminStorageState }),
            ])
            const pageA = await contextA.newPage()
            const pageB = await contextB.newPage()
            const isStockStream = (url: URL) => url.pathname === "/api/pos/stock-stream"
            const abortStockStream = (route: Route) => route.abort("connectionrefused")
            await pageB.route(isStockStream, abortStockStream)

            await Promise.all([
                openPosAndSelectDevice(pageA, setup.posAName),
                openPosAndSelectDevice(pageB, setup.posBName),
            ])
            await expect(pageA.getByTestId("pos-stock-sync-status")).toHaveText("Scorte sincronizzate")
            await expect(pageB.getByTestId("pos-stock-sync-status")).toHaveText("Riallineamento scorte periodico")

            await pageA.getByRole("button", { name: "Scorte", exact: true }).click()
            const pollingSnapshot = pageB.waitForResponse((response) =>
                response.url().includes("/api/pos/stock?") && response.ok()
            )
            await setInlineStock(pageA, setup.productId, setup.productName, "0")
            await pollingSnapshot
            const productCardB = pageB.getByTestId(`pos-product-${setup.productId}`)
            await expect(productCardB).toContainText("Esaurito")

            const reconnectedStream = pageB.waitForResponse((response) =>
                new URL(response.url()).pathname === "/api/pos/stock-stream" && response.ok()
            )
            await pageB.unroute(isStockStream, abortStockStream)
            await reconnectedStream
            await expect(pageB.getByTestId("pos-stock-sync-status")).toHaveText("Scorte sincronizzate")

            const realtimeSnapshot = pageB.waitForResponse((response) =>
                response.url().includes("/api/pos/stock?") && response.ok()
            )
            await setInlineStock(pageA, setup.productId, setup.productName, "2")
            await realtimeSnapshot
            await expect(productCardB).toContainText("Scorte basse (2)")
        } finally {
            await closeContexts([contextA, contextB])
            await cleanupEventArtifactsByName(eventName)
        }
    })
})
