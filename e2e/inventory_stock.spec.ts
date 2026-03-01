import { expect, test } from "@playwright/test"
import {
    createAndActivateEvent,
    configureCashPos,
    createCategory,
    createProduct,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    dismissFeedbackModal,
    uniqueSuffix,
    localPrinterIp,
} from "./utils/fixtures"

test.describe("Magazzino e scorte base", () => {
    test.describe.configure({ mode: "serial" })

    test("gestisce esaurimento menu e override POS con conferma cassiere", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Stock Event ${suffix}`
        const categoryName = `Stock Cat ${suffix}`
        const productName = `Stock Product ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`

        await createAndActivateEvent(page, eventName)
        await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName)

        // Create product with stock = 1
        await createCategory(page, categoryName)
        await createProduct(page, categoryName, { name: productName, price: "8.00", stock: "1" })
        const productRow = page.locator("tr").filter({ hasText: productName })
        await expect(productRow).toContainText("Scorte basse")

        // Verify product visible in menu
        await page.goto("/menu")
        await page.waitForResponse(r => r.url().includes("/api/pos/init") && r.ok(), { timeout: 10000 })
        await expect(page.getByText(productName)).toBeVisible()

        // Sell the single unit via POS
        await openPosAndSelectDevice(page, posName)
        await openCashSessionIfRequired(page)

        const productButton = page.locator("button").filter({ hasText: productName }).first()
        await expect(productButton).toContainText(/Scorte basse/i)
        await productButton.click()

        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
        await expect(checkoutDialog).toBeVisible()
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
        await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible()
        await dismissFeedbackModal(page)

        // Verify sold out in admin catalog
        await page.goto("/admin/catalog")
        await expect(productRow).toContainText("Esaurito")

        // Verify hidden in public menu
        await page.goto("/menu")
        await page.waitForResponse(r => r.url().includes("/api/pos/init") && r.ok(), { timeout: 10000 })
        await expect(page.getByText(productName)).toHaveCount(0)

        // POS shows sold-out but allows override
        await page.goto("/pos")
        await page.waitForResponse(r => r.url().includes("/api/pos/init") && r.ok(), { timeout: 10000 })
        const soldOutButton = page.locator("button").filter({ hasText: productName }).first()
        await expect(soldOutButton).toContainText(/Esaurito/i)
        await soldOutButton.click()

        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        await expect(checkoutDialog).toBeVisible()
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()

        await expect(checkoutDialog.getByText(/Scorte insufficienti rilevate/i)).toBeVisible()
        await expect(checkoutDialog.locator("li").filter({ hasText: new RegExp(`^${productName}:`) })).toBeVisible()

        await checkoutDialog.getByRole("button", { name: "Prosegui comunque", exact: true }).click()
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
        await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible()
        await dismissFeedbackModal(page)
    })
})
