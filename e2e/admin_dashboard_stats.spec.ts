import { expect, test } from "@playwright/test"
import ExcelJS from "exceljs"
import Event from "../src/models/Event"
import Order from "../src/models/Order"
import Product from "../src/models/Product"
import {
    createAndActivateEvent,
    configureCashPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    completeCashOrder,
    deleteEvent,
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
        const soldProducts = [
            { name: `Sold 1 ${suffix}`, quantity: 6 },
            { name: `Sold 2 ${suffix}`, quantity: 5 },
            { name: `Sold 3 ${suffix}`, quantity: 4 },
            { name: `Sold 4 ${suffix}`, quantity: 3 },
            { name: `Sold 5 ${suffix}`, quantity: 2 },
            { name: `Sold 6 ${suffix}`, quantity: 1 },
        ]
        const previousDayName = `Previous Day ${suffix}`
        const unsoldName = `Unsold ${suffix}`

        try {
            await createAndActivateEvent(page, eventName)

            const event = await Event.findOne({ name: eventName }).select("_id").lean<{ _id: string } | null>()
            expect(event?._id).toBeTruthy()
            const eventId = String(event!._id)

            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName)
            await createCategoryAndProducts(page, categoryName, [
                ...soldProducts.map(({ name }) => ({ name, price: "1.00" })),
                { name: previousDayName, price: "2.50" },
                { name: unsoldName, price: "3.00" },
            ])

            const previousDayProduct = await Product.findOne({ eventId, name: previousDayName }).select("_id").lean<{ _id: string } | null>()
            expect(previousDayProduct?._id).toBeTruthy()

            const yesterday = new Date()
            yesterday.setDate(yesterday.getDate() - 1)
            yesterday.setHours(12, 0, 0, 0)
            await Order.create({
                eventId,
                status: "PAID",
                paymentMethod: "CASH",
                totalAmount: 2.5,
                createdAt: yesterday,
                cart: [{
                    productId: previousDayProduct!._id,
                    snapshotName: previousDayName,
                    quantity: 1,
                    selectedOptions: [],
                }],
            })

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)
            await completeCashOrder(page, soldProducts)

            await page.goto("/admin")

            await expect(page.getByRole("heading", { name: /Dashboard Statistiche/i })).toBeVisible()
            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/23,50\s*€/)
            await expect(page.getByTestId("dashboard-kpi-cash")).toContainText(/23,50\s*€/)
            await expect(page.getByTestId("dashboard-kpi-card")).toContainText(/0,00\s*€/)
            await expect(page.getByTestId("dashboard-kpi-orders")).toContainText(/^2$/)
            await expect(page.getByTestId("dashboard-kpi-average")).toContainText(/11,75\s*€/)

            await expect(page.getByTestId("dashboard-today-kpi-total")).toContainText(/21,00\s*€/)
            await expect(page.getByTestId("dashboard-today-kpi-cash")).toContainText(/21,00\s*€/)
            await expect(page.getByTestId("dashboard-today-kpi-card")).toContainText(/0,00\s*€/)
            await expect(page.getByTestId("dashboard-today-kpi-orders")).toContainText(/^1$/)
            await expect(page.getByTestId("dashboard-today-kpi-average")).toContainText(/21,00\s*€/)

            const bestsellerRow = page.locator("tr").filter({ hasText: soldProducts[0].name }).first()
            await expect(bestsellerRow).toBeVisible()
            await expect(bestsellerRow).toContainText("6")

            const unsoldRow = page.locator("tr").filter({ hasText: unsoldName }).first()
            await expect(unsoldRow).toBeVisible()
            await expect(unsoldRow).toContainText("0")

            const eveningProducts = page.getByTestId("dashboard-evening-products")
            const eveningRows = eveningProducts.getByTestId("dashboard-evening-product-row")
            await expect(eveningProducts.getByText("Prodotti venduti nella serata", { exact: true })).toBeVisible()
            await expect(eveningRows).toHaveCount(6)
            for (let index = 0; index < soldProducts.length; index += 1) {
                const row = eveningRows.nth(index)
                await expect(row).toContainText(soldProducts[index].name)
                await expect(row.getByTestId("dashboard-evening-product-quantity")).toHaveText(String(soldProducts[index].quantity))
                if (index < 5) await expect(row).toBeVisible()
                else await expect(row).toBeHidden()
            }
            await expect(eveningProducts.getByText(previousDayName, { exact: true })).toHaveCount(0)
            await expect(eveningProducts.getByText(unsoldName, { exact: true })).toHaveCount(0)

            const eveningProductsToggle = eveningProducts.getByTestId("dashboard-evening-products-toggle")
            await expect(eveningProducts.getByText("Mostra tutti", { exact: true })).toBeVisible()
            await expect(eveningProducts.getByText("Riduci", { exact: true })).toBeHidden()
            await eveningProductsToggle.click()
            await expect(eveningRows.nth(5)).toBeVisible()
            await expect(eveningProducts.getByText("Mostra tutti", { exact: true })).toBeHidden()
            await expect(eveningProducts.getByText("Riduci", { exact: true })).toBeVisible()
            await eveningProductsToggle.click()
            await expect(eveningRows.nth(5)).toBeHidden()
            await expect(eveningProducts.getByText("Mostra tutti", { exact: true })).toBeVisible()

            const csvResponse = await page.request.get("/admin/export?format=csv")
            expect(csvResponse.ok()).toBeTruthy()
            expect(csvResponse.headers()["content-type"]).toContain("text/csv")
            expect(csvResponse.headers()["content-disposition"]).toContain(".csv")
            const csvPayload = await csvResponse.text()
            expect(csvPayload).toContain("Incasso totale")
            expect(csvPayload).toContain(soldProducts[0].name)
            expect(csvPayload).toContain("23.50")

            const xlsResponse = await page.request.get("/admin/export?format=xls")
            expect(xlsResponse.ok()).toBeTruthy()
            expect(xlsResponse.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            expect(xlsResponse.headers()["content-disposition"]).toContain(".xlsx")
            const workbook = new ExcelJS.Workbook()
            await workbook.xlsx.load(await xlsResponse.body())
            expect(workbook.worksheets.map((sheet) => sheet.name)).toContain("Categorie")
            expect(workbook.getWorksheet("Sotto soglia")?.getColumn(1).values).toContain(unsoldName)
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
