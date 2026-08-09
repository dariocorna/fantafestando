import { expect, test } from "@playwright/test"
import ExcelJS from "exceljs"
import Event from "../src/models/Event"
import Order from "../src/models/Order"
import Product from "../src/models/Product"
import CashSession from "../src/models/CashSession"
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

function toRomeInput(value: Date): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    })
    const parts = Object.fromEntries(
        formatter
            .formatToParts(value)
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value])
    )
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function minutesFrom(value: Date, minutes: number): Date {
    return new Date(value.getTime() + (minutes * 60 * 1000))
}

async function createPaidOrder(params: {
    eventId: string
    cashSessionId: unknown
    posDeviceId: unknown
    productId: unknown
    productName: string
    totalAmount: number
    quantity: number
    createdAt: Date
    paidAt: Date
}) {
    await Order.create({
        eventId: params.eventId,
        cashSessionId: params.cashSessionId,
        posDeviceId: params.posDeviceId,
        status: "PAID",
        paymentMethod: "CASH",
        customer: {},
        pricingMode: "STANDARD",
        totalAmount: params.totalAmount,
        discountApplied: 0,
        cart: [{
            productId: params.productId,
            snapshotName: params.productName,
            quantity: params.quantity,
            unitBasePrice: Number((params.totalAmount / params.quantity).toFixed(2)),
            lineTotal: params.totalAmount,
            discountApplied: 0,
            selectedOptions: []
        }],
        ingredientPlan: [],
        dishTickets: [],
        stockAdjustments: [],
        stockEffectStatus: "REVERTED",
        createdAt: params.createdAt,
        paidAt: params.paidAt,
        updatedAt: params.paidAt
    })
}

test.describe("Dashboard statistiche e reportistica", () => {
    test.describe.configure({ mode: "serial" })

    test("applica filtri temporali condivisi a dashboard ed export", async ({ page, isMobile }) => {
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
        const testOnlyName = `Test Only ${suffix}`
        const realtimeExtraName = `Realtime Extra ${suffix}`
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
                { name: testOnlyName, price: "3.00" },
                { name: realtimeExtraName, price: "4.00" },
                { name: unsoldName, price: "5.00" },
            ])

            const [previousDayProduct, testOnlyProduct, realtimeExtraProduct] = await Promise.all([
                Product.findOne({ eventId, name: previousDayName }).select("_id").lean<{ _id: string } | null>(),
                Product.findOne({ eventId, name: testOnlyName }).select("_id").lean<{ _id: string } | null>(),
                Product.findOne({ eventId, name: realtimeExtraName }).select("_id").lean<{ _id: string } | null>(),
            ])
            expect(previousDayProduct?._id).toBeTruthy()
            expect(testOnlyProduct?._id).toBeTruthy()
            expect(realtimeExtraProduct?._id).toBeTruthy()

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)
            await completeCashOrder(page, soldProducts)

            const openSession = await CashSession.findOne({ eventId, status: "OPEN" })
                .sort({ openedAt: -1 })
                .select("_id posDeviceId openedAt")
                .lean<{ _id: unknown, posDeviceId: unknown, openedAt?: Date } | null>()
            expect(openSession?._id).toBeTruthy()
            expect(openSession?.posDeviceId).toBeTruthy()

            const currentOrder = await Order.findOne({ eventId, status: "PAID" })
                .sort({ createdAt: -1 })
                .select("_id paidAt")
                .lean<{ _id: unknown, paidAt?: Date } | null>()
            expect(currentOrder?._id).toBeTruthy()
            expect(currentOrder?.paidAt).toBeInstanceOf(Date)

            const now = new Date()
            const currentPaidAt = minutesFrom(now, -1)
            const currentCreatedAt = minutesFrom(currentPaidAt, -(24 * 60))
            await Order.updateOne(
                { _id: currentOrder!._id },
                { $set: { createdAt: currentCreatedAt, paidAt: currentPaidAt, updatedAt: currentPaidAt } }
            )

            const previousDayPaidAt = new Date(currentPaidAt)
            previousDayPaidAt.setUTCDate(previousDayPaidAt.getUTCDate() - 1)
            previousDayPaidAt.setUTCHours(10, 0, 0, 0)

            await createPaidOrder({
                eventId,
                cashSessionId: openSession!._id,
                posDeviceId: openSession!.posDeviceId,
                productId: previousDayProduct!._id,
                productName: previousDayName,
                totalAmount: 2.5,
                quantity: 1,
                createdAt: previousDayPaidAt,
                paidAt: previousDayPaidAt
            })

            const testSession = await CashSession.create({
                eventId,
                posDeviceId: openSession!.posDeviceId,
                status: "CLOSED",
                isTest: true,
                stockEffectStatus: "REVERTED",
                openedAt: minutesFrom(now, -30),
                closedAt: minutesFrom(now, -20),
                openingFloatAmount: 0,
                paidOrdersCount: 1,
                cashSalesAmount: 12,
                cardSalesAmount: 0,
                otherSalesAmount: 0,
                expectedCashAmount: 12,
                closingCountedCashAmount: 12,
                varianceAmount: 0
            })

            await createPaidOrder({
                eventId,
                cashSessionId: testSession._id,
                posDeviceId: openSession!.posDeviceId,
                productId: testOnlyProduct!._id,
                productName: testOnlyName,
                totalAmount: 12,
                quantity: 4,
                createdAt: currentPaidAt,
                paidAt: currentPaidAt
            })

            await page.goto("/admin?range=realtime")

            await expect(page.getByRole("heading", { name: /Dashboard Statistiche/i })).toBeVisible()
            await expect(page.getByTestId("dashboard-time-range-label")).toContainText("Tempo reale")
            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/21,00\s*€/)
            await expect(page.getByTestId("dashboard-kpi-cash")).toContainText(/21,00\s*€/)
            await expect(page.getByTestId("dashboard-kpi-card")).toContainText(/0,00\s*€/)
            await expect(page.getByTestId("dashboard-kpi-orders")).toContainText(/^1$/)
            await expect(page.getByTestId("dashboard-kpi-average")).toContainText(/21,00\s*€/)

            const eveningProducts = page.getByTestId("dashboard-evening-products")
            const eveningRows = eveningProducts.getByTestId("dashboard-evening-product-row")
            await expect(eveningProducts.getByText("Prodotti venduti nell'intervallo", { exact: true })).toBeVisible()
            await expect(eveningRows).toHaveCount(6)
            for (let index = 0; index < soldProducts.length; index += 1) {
                const row = eveningRows.nth(index)
                await expect(row).toContainText(soldProducts[index].name)
                await expect(row.getByTestId("dashboard-evening-product-quantity")).toHaveText(String(soldProducts[index].quantity))
                if (index < 5) await expect(row).toBeVisible()
                else await expect(row).toBeHidden()
            }
            await expect(eveningProducts.getByText(previousDayName, { exact: true })).toHaveCount(0)
            await expect(eveningProducts.getByText(testOnlyName, { exact: true })).toHaveCount(0)
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

            const customFrom = toRomeInput(minutesFrom(previousDayPaidAt, -30))
            const customTo = toRomeInput(minutesFrom(previousDayPaidAt, 30))
            const timeRangeCard = page.getByTestId("dashboard-time-range")
            const fromInput = timeRangeCard.locator('input[name="from"]')
            const toInput = timeRangeCard.locator('input[name="to"]')

            await fromInput.fill(customFrom)
            await toInput.fill(customTo)
            await page.getByRole("button", { name: "Applica filtro" }).click()

            await expect(page.getByTestId("dashboard-time-range-label")).toContainText("Intervallo personalizzato")
            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/2,50\s*€/)
            await expect(page.getByTestId("dashboard-kpi-orders")).toContainText(/^1$/)
            await expect(eveningProducts.getByText(previousDayName, { exact: true })).toBeVisible()
            await expect(eveningProducts.getByText(soldProducts[0].name, { exact: true })).toHaveCount(0)

            const customCsvResponse = await page.request.get(`/admin/export?format=csv&range=custom&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`)
            expect(customCsvResponse.ok()).toBeTruthy()
            expect(customCsvResponse.headers()["content-type"]).toContain("text/csv")
            expect(customCsvResponse.headers()["content-disposition"]).toContain(".csv")
            const customCsvPayload = await customCsvResponse.text()
            expect(customCsvPayload).toContain("Intervallo")
            expect(customCsvPayload).toContain("Intervallo personalizzato")
            expect(customCsvPayload).toContain(previousDayName)
            expect(customCsvPayload).toContain("Top prodotti")
            expect(customCsvPayload).toContain("2.50")

            const customXlsResponse = await page.request.get(`/admin/export?format=xls&range=custom&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`)
            expect(customXlsResponse.ok()).toBeTruthy()
            expect(customXlsResponse.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            expect(customXlsResponse.headers()["content-disposition"]).toContain(".xlsx")
            const workbook = new ExcelJS.Workbook()
            await workbook.xlsx.load(await customXlsResponse.body())
            expect(workbook.worksheets.map((sheet) => sheet.name)).toContain("Riepilogo")
            expect(String(workbook.getWorksheet("Riepilogo")?.getCell("B2").value || "")).toContain("Intervallo personalizzato")
            expect(workbook.getWorksheet("Sotto soglia")?.getColumn(1).values).toContain(unsoldName)

            const customPdfResponse = await page.request.get(`/admin/export?format=pdf&range=custom&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`)
            expect(customPdfResponse.ok()).toBeTruthy()
            expect(customPdfResponse.headers()["content-type"]).toBe("application/pdf")
            expect(customPdfResponse.headers()["content-disposition"]).toMatch(
                /^attachment; filename="report-Dashboard-Event-.+-\d{8}-\d{4}\.pdf"$/
            )
            expect((await customPdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-")

            await fromInput.fill(customTo)
            await toInput.fill(customFrom)
            await page.getByRole("button", { name: "Applica filtro" }).click()

            await expect(page.getByTestId("dashboard-time-range-error")).toHaveText("La data finale deve essere successiva a quella iniziale.")
            await expect(page.getByRole("alert")).toHaveText("La data finale deve essere successiva a quella iniziale.")
            await expect(fromInput).toHaveAttribute("aria-invalid", "true")
            await expect(fromInput).toHaveAttribute("aria-describedby", "dashboard-time-range-error-message")
            await expect(toInput).toHaveAttribute("aria-invalid", "true")
            await expect(toInput).toHaveAttribute("aria-describedby", "dashboard-time-range-error-message")
            await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled()
            await expect(page.getByRole("button", { name: "Export Excel" })).toBeDisabled()
            await expect(page.getByRole("button", { name: "Export PDF" })).toBeDisabled()

            const invalidExportResponse = await page.request.get(`/admin/export?format=csv&range=custom&from=${encodeURIComponent(customTo)}&to=${encodeURIComponent(customFrom)}`)
            expect(invalidExportResponse.status()).toBe(400)
            expect(await invalidExportResponse.json()).toEqual({
                error: "La data finale deve essere successiva a quella iniziale."
            })

            const invalidPdfResponse = await page.request.get(`/admin/export?format=pdf&range=custom&from=${encodeURIComponent(customTo)}&to=${encodeURIComponent(customFrom)}`)
            expect(invalidPdfResponse.status()).toBe(400)
            expect(await invalidPdfResponse.json()).toEqual({
                error: "La data finale deve essere successiva a quella iniziale."
            })

            await page.getByRole("link", { name: "Tempo reale" }).click()
            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/21,00\s*€/)

            const realtimeExtraPaidAt = new Date()
            await createPaidOrder({
                eventId,
                cashSessionId: openSession!._id,
                posDeviceId: openSession!.posDeviceId,
                productId: realtimeExtraProduct!._id,
                productName: realtimeExtraName,
                totalAmount: 4,
                quantity: 1,
                createdAt: minutesFrom(realtimeExtraPaidAt, -(24 * 60)),
                paidAt: realtimeExtraPaidAt
            })

            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/25,00\s*€/, { timeout: 10000 })

            await page.getByRole("link", { name: "Serata corrente" }).click()
            await expect(page.getByTestId("dashboard-time-range-label")).toContainText("Serata corrente")
            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/25,00\s*€/)

            await page.getByRole("link", { name: "Intera festa" }).click()
            await expect(page.getByTestId("dashboard-time-range-label")).toHaveText("Intera festa")
            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/27,50\s*€/)
            await expect(page.getByTestId("dashboard-kpi-orders")).toContainText(/^3$/)
            await expect(eveningProducts.getByText(testOnlyName, { exact: true })).toHaveCount(0)
            await expect(eveningProducts.getByText(unsoldName, { exact: true })).toHaveCount(0)
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
