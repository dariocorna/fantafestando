import { expect, test, type Page } from "@playwright/test"
import mongoose from "mongoose"
import {
    createAndActivateEvent,
    configureCashPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    openCashSession,
    completeCashOrder,
    closeCashSession,
    deleteEvent,
    uniqueSuffix,
    localPrinterIp,
    dismissFeedbackModal,
} from "./utils/fixtures"
import { ensureDbConnection } from "./utils/db"

async function configureDiscountPresets(eventName: string) {
    await ensureDbConnection()
    const db = mongoose.connection.db
    if (!db) throw new Error("Connessione Mongo non disponibile per il setup sconti E2E")
    await db.collection("events").updateOne({ name: eventName }, {
        $set: {
            "settings.quickDiscountPresets": [
                { label: "Staff", type: "PERCENT", value: 50 },
                { label: "Promo Cassa", type: "FIXED", value: 2 }
            ]
        }
    })
}

async function completeDiscountedCashOrder(page: Page, productName: string, presetIndexes: number[]) {
    await page.locator("button").filter({ hasText: new RegExp(productName) }).first().click()
    const panel = page.locator("#pos-discount-presets")
    if (!(await panel.isVisible().catch(() => false))) {
        await page.locator("#discounts-tab-trigger").click()
    }
    for (const presetIndex of presetIndexes) {
        await page.locator(`#discount-preset-card-${presetIndex}`).click()
    }
    await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
    const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
    await expect(checkoutDialog).toBeVisible()
    await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
    await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
    await dismissFeedbackModal(page)
}

test.describe("Admin sessioni cassa", () => {
    test.describe.configure({ mode: "serial" })

    test("mostra sessione chiusa e permette download report CSV/XLS", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Cash Sessions Event ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `Cash Sessions Cat ${suffix}`
        const productName = `Cash Sessions Product ${suffix}`
        const productShortName = `CASH PROD ${suffix.slice(-6)}`.slice(0, 24)

        try {
            await createAndActivateEvent(page, eventName)
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName)
            await createCategoryAndProducts(page, categoryName, [{
                name: productName,
                shortName: productShortName,
                price: "8.00"
            }])
            await configureDiscountPresets(eventName)

            await openPosAndSelectDevice(page, posName)
            await openCashSession(page, "100")
            await completeCashOrder(page, productShortName)
            await completeDiscountedCashOrder(page, productShortName, [0])
            await completeDiscountedCashOrder(page, productShortName, [1])
            await completeDiscountedCashOrder(page, productShortName, [0, 1])
            await closeCashSession(page, "120")

            await page.goto("/admin")
            const sessionsTable = page.getByTestId("cash-sessions-table")
            await expect(sessionsTable).toBeVisible({ timeout: 10000 })
            const row = sessionsTable.locator("tr").filter({ hasText: new RegExp(posName) }).first()
            await expect(row).toBeVisible()
            await expect(row).toContainText(/Chiusa/i)
            await expect(row).toContainText(/120,00\s*€/i)

            const anteprimaBtn = row.getByRole("button", { name: "Anteprima" }).first()
            await expect(anteprimaBtn).toBeVisible()
            await anteprimaBtn.click()

            const previewDialog = page.getByRole("dialog")
            await expect(previewDialog).toBeVisible({ timeout: 5000 })
            await expect(previewDialog).toContainText("Anteprima Chiusura Cassa")
            await expect(previewDialog).toContainText("CHIUSURA CASSA")
            await expect(previewDialog).toContainText(posName)
            await expect(previewDialog).toContainText(productShortName)
            await expect(previewDialog).toContainText("PREZZO PIENO")
            await expect(previewDialog).toContainText("Staff")
            await expect(previewDialog).toContainText("Promo Cassa")
            await expect(previewDialog).toContainText("Lordo")
            await page.keyboard.press("Escape")
            await expect(previewDialog).toBeHidden()

            const csvLink = row.getByRole("link", { name: "CSV", exact: true }).first()
            const xlsLink = row.getByRole("link", { name: "XLS", exact: true }).first()

            const csvHref = await csvLink.getAttribute("href")
            const xlsHref = await xlsLink.getAttribute("href")
            expect(csvHref).toBeTruthy()
            expect(xlsHref).toBeTruthy()

            const csvResponse = await page.request.get(csvHref || "")
            expect(csvResponse.ok()).toBeTruthy()
            expect(csvResponse.headers()["content-type"]).toContain("text/csv")
            const csvPayload = await csvResponse.text()
            expect(csvPayload).toContain("Contante atteso (solo contanti)")
            expect(csvPayload).toContain("Totale incassi")
            expect(csvPayload).toContain("Codice ordine")
            expect(csvPayload).toContain("Sconto")
            expect(csvPayload).toContain("Totale netto")
            expect(csvPayload).toContain("Tipo riga,Categoria,Prodotto,Descrizione breve")
            expect(csvPayload).toContain("PREZZO PIENO")
            expect(csvPayload).toContain("Staff + Promo Cassa")
            expect(csvPayload).toContain("TOTALE CATEGORIA")
            expect(csvPayload).toContain("TOTALE GENERALE")
            expect(csvPayload).toContain("Riepilogo componenti sconto")
            expect(csvPayload).toContain(posName)
            expect(csvPayload).toContain("120.00")

            const xlsResponse = await page.request.get(xlsHref || "")
            expect(xlsResponse.ok()).toBeTruthy()
            expect(xlsResponse.headers()["content-type"]).toContain("application/vnd.ms-excel")
            const xlsPayload = await xlsResponse.text()
            expect(xlsPayload).toContain("Sezione\tValore")
            expect(xlsPayload).toContain("Totale incassi")
            expect(xlsPayload).toContain("Codice ordine")
            expect(xlsPayload).toContain("Tipo riga\tCategoria\tProdotto\tDescrizione breve")
            expect(xlsPayload).toContain("Staff + Promo Cassa")
            expect(xlsPayload).toContain(posName)

            const eventCsvResponse = await page.request.get("/admin/export?format=csv")
            expect(eventCsvResponse.ok()).toBeTruthy()
            const eventCsvPayload = await eventCsvResponse.text()
            expect(eventCsvPayload).toContain("Tipo riga,Categoria,Prodotto,Descrizione breve")
            expect(eventCsvPayload).toContain("PREZZO PIENO")
            expect(eventCsvPayload).toContain("Staff + Promo Cassa")
            expect(eventCsvPayload).toContain("Riepilogo componenti sconto")

            const eventXlsResponse = await page.request.get("/admin/export?format=xls")
            expect(eventXlsResponse.ok()).toBeTruthy()
            expect(await eventXlsResponse.text()).toContain("Tipo riga\tCategoria\tProdotto\tDescrizione breve")

            const jobsResponse = await page.request.get("/api/admin/print-jobs?limit=100")
            expect(jobsResponse.ok()).toBeTruthy()
            const jobsPayload = await jobsResponse.json() as {
                jobs?: Array<{
                    source?: string
                    printType?: string
                    document?: {
                        items?: Array<{ name?: string; groupLabel?: string; grossAmount?: number; discountAmount?: number }>
                        totals?: Array<{ label?: string }>
                    }
                }>
            }
            const closingJob = jobsPayload.jobs?.find((job) =>
                job.source === "CASH_SESSION" && job.printType === "CASH_SESSION_SUMMARY"
            )
            expect(closingJob).toBeTruthy()
            expect(closingJob?.document?.items).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: productShortName, groupLabel: "PREZZO PIENO" }),
                expect.objectContaining({ name: productShortName, groupLabel: "Staff + Promo Cassa" })
            ]))
            expect(closingJob?.document?.totals?.map((total) => total.label)).toEqual(expect.arrayContaining([
                "LORDO",
                "SCONTO STAFF",
                "SCONTO PROMO CASSA",
                "NETTO / INCASSI"
            ]))
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
