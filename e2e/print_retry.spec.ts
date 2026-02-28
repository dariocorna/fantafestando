import { test, expect } from "@playwright/test"
import {
    createAndActivateEvent,
    configureCashPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    uniqueSuffix,
} from "./utils/fixtures"

async function createCatalogProduct(page: import("@playwright/test").Page, categoryName: string, productName: string) {
    await page.goto("/admin/catalog")
    await page.click("#new-category-btn")
    await page.fill("#cat-name", categoryName)
    await page.getByRole("button", { name: "Salva Categoria", exact: true }).click()
    await expect(page.getByText(categoryName)).toBeVisible()

    await page.click("#new-product-btn")
    await page.fill("#prod-name", productName)
    await page.fill('input[name="basePrice"]', "5.00")
    await page.locator('select[name="categoryId"]').selectOption({ label: categoryName })
    await page.getByRole("button", { name: "Salva Prodotto", exact: true }).click()
    await expect(page.getByText(productName)).toBeVisible()
}

test.describe("Print Retry Flows", () => {
    test("admin monitor supports retry flow for failed jobs", async ({ page }) => {
        test.setTimeout(90000)
        const suffix = uniqueSuffix()
        const eventName = `Retry Admin ${suffix}`
        const printerName = `A Retry Printer ${suffix}`
        const cashBoxName = `A Retry CashBox ${suffix}`
        const posName = `A Retry POS ${suffix}`
        const categoryName = `A Retry Cat ${suffix}`
        const productName = `A Retry Product ${suffix}`

        await createAndActivateEvent(page, eventName)
        await configureCashPos(page, printerName, "127.0.0.1", cashBoxName, posName, { printerPort: "19199" })
        await createCatalogProduct(page, categoryName, productName)

        await openPosAndSelectDevice(page, posName)
        await openCashSessionIfRequired(page)
        await page.locator("button").filter({ hasText: productName }).first().click()
        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 })

        const feedbackModal = page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i })
        if (await feedbackModal.isVisible()) {
            await feedbackModal.getByRole("button", { name: "OK", exact: true }).click()
            await expect(feedbackModal).toBeHidden()
        }

        await page.goto("/admin/settings/hardware")
        await page.getByRole("tab", { name: "Monitor Stampa" }).click()
        await expect(page.locator("span", { hasText: "FAILED" }).first()).toBeVisible({ timeout: 15000 })

        const failedJobButton = page.locator("button").filter({ hasText: /FAILED/ }).first()
        await failedJobButton.click()
        await page.getByRole("button", { name: "Reinvia job fallito" }).click()
        await expect(page.getByText(/Reinvio/i)).toBeVisible()

        // Fix printer IP to valid emulator port
        await page.getByRole("tab", { name: "Stampanti" }).click()
        const printerCard = page.locator('[data-slot="card"]', { hasText: printerName }).first()
        await printerCard.getByRole("button", { name: "Modifica" }).click()
        const editDialog = page.getByRole("dialog")
        await editDialog.getByLabel("Indirizzo IP").fill("127.0.0.1")
        await editDialog.getByLabel("Porta TCP").fill("19100")
        await editDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click()
        await expect(printerCard.getByText("127.0.0.1:19100")).toBeVisible({ timeout: 10000 })

        await page.getByRole("tab", { name: "Monitor Stampa" }).click()
        await failedJobButton.click()
        await page.getByRole("button", { name: "Reinvia job fallito" }).click()
        await expect(page.getByText(/Reinvio/i)).toBeVisible()
    })

    test("pos error modal exposes cashier-triggered retry action", async ({ page }) => {
        test.setTimeout(90000)
        const suffix = uniqueSuffix()
        const eventName = `Retry POS ${suffix}`
        const printerName = `POS Retry Printer ${suffix}`
        const cashBoxName = `POS CashBox ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `POS Cat ${suffix}`
        const productName = `POS Product ${suffix}`

        await createAndActivateEvent(page, eventName)
        await configureCashPos(page, printerName, "127.0.0.1", cashBoxName, posName, { printerPort: "19199" })
        await createCatalogProduct(page, categoryName, productName)

        await openPosAndSelectDevice(page, posName)
        await openCashSessionIfRequired(page)

        await page.locator("button").filter({ hasText: productName }).first().click()
        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
        await expect(checkoutDialog).toBeVisible()
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 })

        const feedbackModal = page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i })
        await expect(feedbackModal).toBeVisible({ timeout: 15000 })
        const retryButton = feedbackModal.getByRole("button", { name: "Riprova stampa", exact: true })
        await expect(retryButton).toBeVisible()
        await retryButton.click()
        await expect(
            feedbackModal.locator("p").filter({ hasText: /Reinvio completato|Reinvio non riuscito|Nessun job fallito/i }).first()
        ).toBeVisible({ timeout: 15000 })
    })
})
