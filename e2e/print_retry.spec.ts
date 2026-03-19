import { test, expect } from "@playwright/test"
import {
    createAndActivateEvent,
    configureCashPos,
    deleteEvent,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    uniqueSuffix,
} from "./utils/fixtures"

async function createCatalogProduct(
    page: import("@playwright/test").Page,
    categoryName: string,
    productName: string,
    kitchenPrinterName?: string,
    shortName = "RTR-SHORT"
) {
    await page.goto("/admin/catalog")
    await page.click("#new-category-btn")
    const categoryDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Categoria/i }).first()
    await categoryDialog.locator("#cat-name").fill(categoryName)
    if (kitchenPrinterName) {
        const printerSelect = categoryDialog.getByLabel("Stampante Reparto")
        const printerValue = await printerSelect.evaluate((element, needle) => {
            const select = element as HTMLSelectElement
            const option = Array.from(select.options).find((item) => item.text.includes(needle))
            return option?.value ?? null
        }, kitchenPrinterName)
        expect(printerValue).toBeTruthy()
        await printerSelect.selectOption(printerValue!)
    }
    await categoryDialog.getByRole("button", { name: "Salva Categoria", exact: true }).click()
    await expect(page.getByText(categoryName)).toBeVisible()

    await page.click("#new-product-btn")
    const productDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Prodotto/i }).first()
    await productDialog.locator("#prod-name").fill(productName)
    await productDialog.getByLabel("Etichetta breve POS/Scontrino (opzionale)").fill(shortName)
    await productDialog.locator('input[name="basePrice"]').fill("5.00")
    await productDialog.locator('select[name="categoryId"]').selectOption({ label: categoryName })
    await productDialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click()
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
        const shortName = "RTR-SHORT"

        try {
            await createAndActivateEvent(page, eventName)
            await configureCashPos(page, printerName, "127.0.0.1", cashBoxName, posName, { printerPort: "19199" })
            await createCatalogProduct(page, categoryName, productName, undefined, shortName)

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)
            await page.locator("button").filter({ hasText: shortName }).first().click()
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 })

            const feedbackModal = page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i })
            const feedbackOkButton = feedbackModal.getByRole("button", { name: "OK", exact: true }).first()
            if (await feedbackOkButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await feedbackOkButton.click()
            }

            await expect.poll(async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=20")
                if (!response.ok()) return 0
                const payload = await response.json() as {
                    jobs?: Array<{
                        source?: string
                        printType?: string
                        document?: { items?: Array<{ name?: string }>, copyLabel?: string, schemaVersion?: number }
                    }>
                }
                const orderJobs = (payload.jobs || []).filter((job) =>
                    job.source === "ORDER"
                    && ["CUSTOMER_ORDER", "CASHIER_SUMMARY"].includes(job.printType || "")
                )
                if (orderJobs.length < 2) return 0
                const allShortName = orderJobs.every((job) =>
                    Array.isArray(job.document?.items)
                    && job.document!.items!.some((item) => item.name === shortName)
                    && typeof job.document?.copyLabel === "string"
                    && job.document?.schemaVersion === 2
                )
                return allShortName ? orderJobs.length : 0
            }, {
                timeout: 30000
            }).toBeGreaterThanOrEqual(2)

            await page.goto("/admin/settings/hardware")
            await page.getByRole("tab", { name: "Monitor Stampa" }).click()
            await expect(page.locator("span", { hasText: "FAILED" }).first()).toBeVisible({ timeout: 15000 })

            const failedJobButton = page.locator("button").filter({ hasText: /FAILED/ }).first()
            await failedJobButton.click()
            await page.getByRole("button", { name: "Reinvia job fallito" }).click()
            await expect(page.getByText(/Reinvio/i)).toBeVisible()

            // Ripristina la stampante cassa verso emulatore raggiungibile e ritenta il retry
            await page.getByRole("tab", { name: "Stampanti" }).click()
            const printerCard = page.locator('[data-slot="card"]', { hasText: printerName }).first()
            await printerCard.getByRole("button", { name: "Modifica" }).click()
            const editDialog = page.getByRole("dialog")
            await editDialog.getByLabel("Indirizzo IP").fill("127.0.0.1")
            await editDialog.getByLabel("Porta TCP").fill("19100")
            await editDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click()
            await expect(printerCard).toContainText("127.0.0.1:19100", { timeout: 15000 })
            if (await editDialog.isVisible().catch(() => false)) {
                await editDialog.getByRole("button", { name: /close/i }).click()
                await expect(editDialog).not.toBeVisible({ timeout: 5000 })
            }

            await page.getByRole("tab", { name: "Monitor Stampa" }).click()
            await failedJobButton.click()
            await page.getByRole("button", { name: "Reinvia job fallito" }).click()
            await expect(page.getByText(/Reinvio/i)).toBeVisible()
        } finally {
            await deleteEvent(page, eventName)
        }
    })

    test("pos error modal exposes cashier-triggered retry action", async ({ page }) => {
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `Print Retry Event ${suffix}`;
        const printerName = `KitchenPrinter ${suffix}`;
        const cashBoxName = `MainCash ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `POS Cat ${suffix}`
        const productName = `POS Product ${suffix}`
        const shortName = "RTR-SHORT"

        try {
            await createAndActivateEvent(page, eventName)
            await configureCashPos(page, printerName, "127.0.0.1", cashBoxName, posName, { printerPort: "19199" })
            await createCatalogProduct(page, categoryName, productName, undefined, shortName)

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)

            await page.locator("button").filter({ hasText: shortName }).first().click()
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
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
