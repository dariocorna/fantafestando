import { test, expect } from "@playwright/test"
import {
    createAndActivateEvent,
    configureCashPos,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    dismissFeedbackModal,
    uniqueSuffix,
    randomIp,
    type CreateEventOptions,
} from "./utils/fixtures"

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createCatalogProduct(page: import("@playwright/test").Page, categoryName: string, productName: string, price: string) {
    await page.goto("/admin/catalog")
    await page.click("#new-category-btn")
    await page.fill("#cat-name", categoryName)
    await page.getByRole("button", { name: "Salva Categoria", exact: true }).click()
    await expect(page.getByText(categoryName)).toBeVisible()

    await page.click("#new-product-btn")
    await page.fill("#prod-name", productName)
    await page.fill('input[name="basePrice"]', price)
    await page.locator('select[name="categoryId"]').selectOption({ label: categoryName })
    await page.getByRole("button", { name: "Salva Prodotto", exact: true }).click()
    await expect(page.getByText(productName)).toBeVisible()
}

async function createWebOrderAndGetCode(
    page: import("@playwright/test").Page,
    productName: string,
    options?: { tableCode?: string; usePresetTable?: boolean },
) {
    await page.goto("/menu")
    await page.waitForResponse(r => r.url().includes("/api/pos/init") && r.ok(), { timeout: 10000 })

    const setupResult = await page.evaluate(async (targetProductName: string) => {
        const response = await fetch("/api/pos/init")
        const data = await response.json()
        const product = (data.products || []).find((p: { name: string }) => p.name === targetProductName)

        if (!data.event?._id || !product?._id) return { success: false }

        localStorage.setItem("osg_eventId", data.event._id)
        localStorage.setItem("osg_cart", JSON.stringify([{
            _id: product._id,
            name: product.name,
            basePrice: product.basePrice,
            quantity: 1,
        }]))
        return { success: true }
    }, productName)

    expect(setupResult.success).toBeTruthy()

    await page.reload()
    await page.getByRole("button", { name: /Vedi Carrello/i }).click()
    await expect(page.getByRole("button", { name: /INVIA ORDINE/i })).toBeVisible()
    if (options?.tableCode) {
        const tableCode = options.tableCode.toUpperCase()
        const tableInput = page.getByPlaceholder("Es: B02 oppure VIP TERRAZZA")
        await expect(tableInput).toBeVisible()

        if (options.usePresetTable) {
            await page.getByRole("button", { name: tableCode, exact: true }).click()
        } else {
            await tableInput.fill(tableCode)
        }

        await expect(tableInput).toHaveValue(tableCode)
    }
    await page.getByRole("button", { name: /INVIA ORDINE/i }).click()

    await expect(page).toHaveURL(/\/menu\/success\?code=/)
    const code = new URL(page.url()).searchParams.get("code")
    expect(code).toBeTruthy()
    return code as string
}

test.describe("POS - Completamento ordine da codice", () => {
    test("chiude un ordine WebApp da POS usando il codice", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso completo validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `POS Code Event ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `Cat ${suffix}`
        const productName = `Product ${suffix}`
        const tableCode = "B07"
        const overrideTableCode = "C12"
        const customTableName = "VIP TERRAZZA 1"

        await createAndActivateEvent(page, eventName, {
            askTable: true,
            predefinedTables: [tableCode, overrideTableCode, "A01"],
        })
        await configureCashPos(page, printerName, randomIp(), cashBoxName, posName)
        await createCatalogProduct(page, categoryName, productName, "8.00")

        const orderCode = await createWebOrderAndGetCode(page, productName, { tableCode, usePresetTable: true })

        await openPosAndSelectDevice(page, posName)
        await openCashSessionIfRequired(page)

        await page.getByRole("button", { name: /Carica ordine da codice/i }).click()
        const loadDialog = page.getByRole("dialog").filter({ hasText: /Carica ordine da codice/i })
        await loadDialog.getByRole("textbox").fill(orderCode)
        await loadDialog.getByRole("button", { name: /Carica/i, exact: true }).click()

        await expect(page.getByText(new RegExp(`Codice ${orderCode}`, "i"))).toBeVisible()
        await expect(page.getByText(new RegExp(`Tavolo ${tableCode}`, "i"))).toBeVisible()

        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
        await expect(checkoutDialog).toBeVisible()
        await expect(checkoutDialog.getByText(/^Tavolo$/i)).toBeVisible()

        const tableInput = checkoutDialog.getByPlaceholder("Es: B02 oppure VIP TERRAZZA")
        await expect(tableInput).toHaveValue(tableCode)

        await checkoutDialog.getByRole("button", { name: overrideTableCode, exact: true }).click()
        await expect(checkoutDialog.getByText(new RegExp(`Tavolo selezionato:\\s*${overrideTableCode}`, "i"))).toBeVisible()

        const confirmButton = checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true })
        await checkoutDialog.getByRole("button", { name: "RESET", exact: true }).click()
        await expect(checkoutDialog.getByText(/Tavolo selezionato:\s*---/i)).toBeVisible()
        await expect(confirmButton).toBeDisabled()

        await tableInput.fill(customTableName)
        await expect(checkoutDialog.getByText(new RegExp(`Tavolo selezionato:\\s*${escapeRegExp(customTableName)}`, "i"))).toBeVisible()

        await expect(checkoutDialog.getByText(/CONTANTI/i)).toBeVisible()
        await expect(checkoutDialog.getByText(/CARTA \/ POS/i)).toHaveCount(0)

        await confirmButton.scrollIntoViewIfNeeded()
        await confirmButton.click()
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
        await dismissFeedbackModal(page)
        await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible()

        await page.getByRole("button", { name: /Carica ordine da codice/i }).click()
        const pendingDialog = page.getByRole("dialog").filter({ hasText: /Carica ordine da codice/i })
        await expect(pendingDialog.getByText(/Nessun ordine pendente disponibile/i)).toBeVisible()

        await page.goto("/admin/orders")
        await expect(page.getByText(productName)).toBeVisible()
    })
})
