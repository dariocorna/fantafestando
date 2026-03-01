import { expect, test } from "@playwright/test"
import {
    createAndActivateEvent,
    configureCashPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    completeCashOrder,
    uniqueSuffix,
    localPrinterIp,
} from "./utils/fixtures"

test.describe("Dashboard statistiche e reportistica", () => {
    test.describe.configure({ mode: "serial" })

    test("mostra KPI corretti e rende disponibili export CSV/XLS", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Dashboard Event ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `Dashboard Cat ${suffix}`
        const bestsellerName = `Best Seller ${suffix}`
        const supportingName = `Supporting ${suffix}`
        const unsoldName = `Unsold ${suffix}`

        await createAndActivateEvent(page, eventName)
        await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName)
        await createCategoryAndProducts(page, categoryName, [
            { name: bestsellerName, price: "4.00" },
            { name: supportingName, price: "3.00" },
            { name: unsoldName, price: "6.50" },
        ])

        await openPosAndSelectDevice(page, posName)
        await openCashSessionIfRequired(page)
        await completeCashOrder(page, [
            { name: bestsellerName, quantity: 2 },
            { name: supportingName, quantity: 1 },
        ])

        await page.goto("/admin")

        await expect(page.getByRole("heading", { name: /Dashboard Statistiche/i })).toBeVisible()
        await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/11,00\s*€/)
        await expect(page.getByTestId("dashboard-kpi-cash")).toContainText(/11,00\s*€/)
        await expect(page.getByTestId("dashboard-kpi-card")).toContainText(/0,00\s*€/)
        await expect(page.getByTestId("dashboard-kpi-orders")).toContainText(/^1$/)
        await expect(page.getByTestId("dashboard-kpi-average")).toContainText(/11,00\s*€/)

        const bestsellerRow = page.locator("tr").filter({ hasText: bestsellerName }).first()
        await expect(bestsellerRow).toBeVisible()
        await expect(bestsellerRow).toContainText("2")

        const unsoldRow = page.locator("tr").filter({ hasText: unsoldName }).first()
        await expect(unsoldRow).toBeVisible()
        await expect(unsoldRow).toContainText("0")

        const csvResponse = await page.request.get("/admin/export?format=csv")
        expect(csvResponse.ok()).toBeTruthy()
        expect(csvResponse.headers()["content-type"]).toContain("text/csv")
        expect(csvResponse.headers()["content-disposition"]).toContain(".csv")
        const csvPayload = await csvResponse.text()
        expect(csvPayload).toContain("Incasso totale")
        expect(csvPayload).toContain(bestsellerName)
        expect(csvPayload).toContain("11.00")

        const xlsResponse = await page.request.get("/admin/export?format=xls")
        expect(xlsResponse.ok()).toBeTruthy()
        expect(xlsResponse.headers()["content-type"]).toContain("application/vnd.ms-excel")
        expect(xlsResponse.headers()["content-disposition"]).toContain(".xls")
        const xlsPayload = await xlsResponse.text()
        expect(xlsPayload).toContain("Sezione\tValore")
        expect(xlsPayload).toContain(unsoldName)
    })
})
