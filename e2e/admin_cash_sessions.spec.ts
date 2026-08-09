import { expect, test } from "@playwright/test"
import mongoose from "mongoose"
import ExcelJS from "exceljs"
import {
    createAndActivateEvent,
    deleteEvent,
    localPrinterIp,
    uniqueSuffix,
} from "./utils/fixtures"
import { ensureDbConnection } from "./utils/db"

test.describe("Admin sessioni cassa", () => {
    test.describe.configure({ mode: "serial" })

    test("esporta più sessioni chiuse in un unico workbook aggregato", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Multi Cash Sessions ${suffix}`
        const firstPosName = `Cassa Nord ${suffix}`
        const secondPosName = `Cassa Sud ${suffix}`

        try {
            await createAndActivateEvent(page, eventName)
            await ensureDbConnection()
            const db = mongoose.connection.db
            if (!db) throw new Error("Connessione Mongo non disponibile per il setup multi-sessione")
            const event = await db.collection("events").findOne({ name: eventName })
            if (!event?._id) throw new Error("Evento multi-sessione non trovato")

            const now = new Date()
            const categoryId = new mongoose.Types.ObjectId()
            const productId = new mongoose.Types.ObjectId()
            const firstPosId = new mongoose.Types.ObjectId()
            const secondPosId = new mongoose.Types.ObjectId()
            const firstSessionId = new mongoose.Types.ObjectId()
            const secondSessionId = new mongoose.Types.ObjectId()

            await Promise.all([
                db.collection("categories").insertOne({
                    _id: categoryId,
                    eventId: event._id,
                    name: "Bar",
                    uiColor: "#ffffff",
                    printOrder: 1,
                    createdAt: now,
                    updatedAt: now
                }),
                db.collection("products").insertOne({
                    _id: productId,
                    eventId: event._id,
                    categoryId,
                    name: "Bibita",
                    shortName: "BIBITA",
                    basePrice: 5.55,
                    createdAt: now,
                    updatedAt: now
                }),
                db.collection("posdevices").insertMany([
                    { _id: firstPosId, eventId: event._id, name: firstPosName, printerId: new mongoose.Types.ObjectId(), createdAt: now, updatedAt: now },
                    { _id: secondPosId, eventId: event._id, name: secondPosName, printerId: new mongoose.Types.ObjectId(), createdAt: now, updatedAt: now }
                ]),
                db.collection("cashsessions").insertMany([
                    {
                        _id: firstSessionId,
                        eventId: event._id,
                        posDeviceId: firstPosId,
                        status: "CLOSED",
                        isTest: false,
                        stockEffectStatus: "APPLIED",
                        openedAt: new Date("2026-08-07T18:00:00.000Z"),
                        closedAt: new Date("2026-08-07T20:00:00.000Z"),
                        openingFloatAmount: 10,
                        paidOrdersCount: 1,
                        cashSalesAmount: 5.55,
                        cardSalesAmount: 0,
                        otherSalesAmount: 0,
                        expectedCashAmount: 15.55,
                        closingCountedCashAmount: 15.55,
                        varianceAmount: 0,
                        createdAt: now,
                        updatedAt: now
                    },
                    {
                        _id: secondSessionId,
                        eventId: event._id,
                        posDeviceId: secondPosId,
                        status: "CLOSED",
                        isTest: true,
                        stockEffectStatus: "REVERTED",
                        openedAt: new Date("2026-08-07T21:00:00.000Z"),
                        closedAt: new Date("2026-08-07T22:00:00.000Z"),
                        openingFloatAmount: 20,
                        paidOrdersCount: 1,
                        cashSalesAmount: 0,
                        cardSalesAmount: 7.45,
                        otherSalesAmount: 0,
                        expectedCashAmount: 20,
                        closingCountedCashAmount: 20,
                        varianceAmount: 0,
                        createdAt: now,
                        updatedAt: now
                    }
                ]),
                db.collection("orders").insertMany([
                    {
                        eventId: event._id,
                        cashSessionId: firstSessionId,
                        pickupNumber: 1,
                        status: "PAID",
                        totalAmount: 5.55,
                        discountApplied: 0,
                        paymentMethod: "CASH",
                        customer: {},
                        cart: [{ productId, snapshotName: "Bibita", quantity: 1, lineTotal: 5.55, selectedOptions: [] }],
                        createdAt: new Date("2026-08-07T19:00:00.000Z"),
                        updatedAt: now
                    },
                    {
                        eventId: event._id,
                        cashSessionId: secondSessionId,
                        pickupNumber: 2,
                        status: "PAID",
                        totalAmount: 7.45,
                        discountApplied: 0,
                        paymentMethod: "CARD",
                        customer: {},
                        cart: [{ productId, snapshotName: "Bibita", quantity: 1, lineTotal: 7.45, selectedOptions: [] }],
                        createdAt: new Date("2026-08-07T21:30:00.000Z"),
                        updatedAt: now
                    }
                ])
            ])

            await page.goto("/admin")
            await page.getByRole("button", { name: "Esporta selezionate XLSX", exact: true }).click()
            await expect(page.getByRole("alert").filter({ hasText: "Seleziona almeno una sessione chiusa" })).toBeVisible()
            await page.getByTestId(`cash-session-select-${firstSessionId}`).check()
            await page.getByTestId(`cash-session-select-${secondSessionId}`).check()

            const downloadPromise = page.waitForEvent("download")
            await page.getByRole("button", { name: "Esporta selezionate XLSX", exact: true }).click()
            const download = await downloadPromise
            expect(download.suggestedFilename()).toMatch(/^cash-sessions-.*\.xlsx$/)

            const downloadPath = await download.path()
            expect(downloadPath).toBeTruthy()
            const workbook = new ExcelJS.Workbook()
            await workbook.xlsx.readFile(downloadPath!)

            expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Riepilogo", "Categorie", "Vendite", "Sconti", "Ordini", "Consumi"])
            const summary = workbook.getWorksheet("Riepilogo")!
            expect(new Set([summary.getCell("C2").value, summary.getCell("C3").value])).toEqual(new Set([
                firstSessionId.toString(),
                secondSessionId.toString()
            ]))
            expect(summary.getCell("A4").value).toBe("TOTALE SESSIONI SELEZIONATE")
            expect(summary.getCell("D4").value).toContain("TEST")
            expect(summary.getRow(4).values.slice(7)).toEqual([2, 30, 5.55, 7.45, 0, 35.55, 35.55, 0])

            const orders = workbook.getWorksheet("Ordini")!
            expect(orders.getRow(1).values.slice(1, 3)).toEqual(["Sessione", "Postazione"])
            expect(new Set([orders.getCell("A2").value, orders.getCell("A3").value])).toEqual(new Set([
                firstSessionId.toString(),
                secondSessionId.toString()
            ]))
        } finally {
            await deleteEvent(page, eventName)
        }
    })

    test("mostra sessione chiusa e permette download report CSV/XLS", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Cash Sessions Event ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `Cash Sessions Cat ${suffix}`
        const productName = `Cash Sessions Product ${suffix}`
        const productShortName = `CASH PROD ${suffix.slice(-6)}`.slice(0, 24)

        try {
            await createAndActivateEvent(page, eventName)
            await ensureDbConnection()
            const db = mongoose.connection.db
            if (!db) throw new Error("Connessione Mongo non disponibile per il setup sessione cassa")
            const event = await db.collection("events").findOne({ name: eventName })
            if (!event?._id) throw new Error("Evento sessione cassa non trovato")

            const now = new Date()
            const categoryId = new mongoose.Types.ObjectId()
            const productId = new mongoose.Types.ObjectId()
            const printerId = new mongoose.Types.ObjectId()
            const posDeviceId = new mongoose.Types.ObjectId()
            const cashSessionId = new mongoose.Types.ObjectId()
            const orderSeeds = [
                { totalAmount: 8, discountApplied: 0, discountComponents: [] },
                {
                    totalAmount: 4,
                    discountApplied: 4,
                    discountMeta: { type: "PERCENT", label: "Staff", value: 50, baseAmount: 8, scope: "ORDER" },
                    discountComponents: [{ scope: "ORDER", type: "PERCENT", label: "Staff", value: 50, baseAmount: 8, appliedAmount: 4 }]
                },
                {
                    totalAmount: 6,
                    discountApplied: 2,
                    discountMeta: { type: "FIXED", label: "Promo Cassa", value: 2, baseAmount: 8, scope: "ORDER" },
                    discountComponents: [{ scope: "ORDER", type: "FIXED", label: "Promo Cassa", value: 2, baseAmount: 8, appliedAmount: 2 }]
                },
                {
                    totalAmount: 2,
                    discountApplied: 6,
                    discountMeta: { type: "FIXED", label: "Sconti: Staff, Promo Cassa", value: 6, baseAmount: 8, scope: "ORDER" },
                    discountComponents: [
                        { scope: "ORDER", type: "PERCENT", label: "Staff", value: 50, baseAmount: 8, appliedAmount: 4 },
                        { scope: "ORDER", type: "FIXED", label: "Promo Cassa", value: 2, baseAmount: 4, appliedAmount: 2 }
                    ]
                }
            ]

            await Promise.all([
                db.collection("categories").insertOne({
                    _id: categoryId,
                    eventId: event._id,
                    name: categoryName,
                    uiColor: "#ffffff",
                    printOrder: 1,
                    createdAt: now,
                    updatedAt: now
                }),
                db.collection("products").insertOne({
                    _id: productId,
                    eventId: event._id,
                    categoryId,
                    name: productName,
                    shortName: productShortName,
                    basePrice: 8,
                    stockQuantity: null,
                    createdAt: now,
                    updatedAt: now
                }),
                db.collection("printers").insertOne({
                    _id: printerId,
                    eventId: event._id,
                    name: `Cashier ${suffix}`,
                    ip: localPrinterIp(),
                    port: 19100,
                    isVirtual: false,
                    type: "CASHIER",
                    createdAt: now,
                    updatedAt: now
                }),
                db.collection("posdevices").insertOne({
                    _id: posDeviceId,
                    eventId: event._id,
                    name: posName,
                    printerId,
                    createdAt: now,
                    updatedAt: now
                }),
                db.collection("cashsessions").insertOne({
                    _id: cashSessionId,
                    eventId: event._id,
                    posDeviceId,
                    status: "CLOSED",
                    isTest: true,
                    stockEffectStatus: "REVERTED",
                    openedAt: new Date(now.getTime() - 60 * 60 * 1000),
                    closedAt: now,
                    openingFloatAmount: 100,
                    paidOrdersCount: 4,
                    cashSalesAmount: 20,
                    cardSalesAmount: 0,
                    otherSalesAmount: 0,
                    expectedCashAmount: 120,
                    closingCountedCashAmount: 120,
                    varianceAmount: 0,
                    createdAt: now,
                    updatedAt: now
                }),
                db.collection("orders").insertMany(orderSeeds.map((order, index) => ({
                    _id: new mongoose.Types.ObjectId(),
                    eventId: event._id,
                    cashSessionId,
                    posDeviceId,
                    pickupNumber: index + 1,
                    status: "PAID",
                    paymentMethod: "CASH",
                    customer: {},
                    pricingMode: "STANDARD",
                    ...order,
                    cart: [{
                        productId,
                        snapshotName: productName,
                        quantity: 1,
                        unitBasePrice: 8,
                        lineTotal: 8,
                        discountApplied: 0,
                        selectedOptions: []
                    }],
                    stockAdjustments: [],
                    stockEffectStatus: "REVERTED",
                    createdAt: new Date(now.getTime() - (4 - index) * 60 * 1000),
                    updatedAt: now
                })))
            ])

            await page.goto("/admin")
            const sessionsTable = page.getByTestId("cash-sessions-table")
            await expect(sessionsTable).toBeVisible({ timeout: 10000 })
            const row = sessionsTable.locator("tr").filter({ hasText: new RegExp(posName) }).first()
            await expect(row).toBeVisible()
            await expect(row).toContainText(/Chiusa/i)
            await expect(row).toContainText(/TEST/i)
            await expect(row).toContainText(/120,00\s*€/i)
            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/0,00\s*€/)
            const eveningProducts = page.getByTestId("dashboard-evening-products")
            await expect(eveningProducts.getByTestId("dashboard-evening-products-empty")).toBeVisible()
            await expect(eveningProducts.getByText(productName, { exact: true })).toHaveCount(0)

            const anteprimaBtn = row.getByRole("button", { name: "Anteprima" }).first()
            await expect(anteprimaBtn).toBeVisible()
            await anteprimaBtn.click()

            const previewDialog = page.getByRole("dialog")
            await expect(previewDialog).toBeVisible({ timeout: 5000 })
            await expect(previewDialog).toContainText("Anteprima Chiusura Cassa")
            await expect(previewDialog).toContainText("SESSIONE TEST - NON CONTABILIZZARE")
            await expect(previewDialog).toContainText(categoryName)
            await expect(previewDialog).toContainText(posName)
            await expect(previewDialog).toContainText(productShortName)
            await expect(previewDialog).toContainText("PREZZO PIENO")
            await expect(previewDialog).toContainText("Staff")
            await expect(previewDialog).toContainText("Promo Cassa")
            await expect(previewDialog).toContainText("Lordo")
            await page.keyboard.press("Escape")
            await expect(previewDialog).toBeHidden()

            const csvLink = row.getByRole("link", { name: "CSV", exact: true }).first()
            const xlsLink = row.getByRole("link", { name: "XLSX", exact: true }).first()

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
            expect(xlsResponse.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            const sessionWorkbook = new ExcelJS.Workbook()
            await sessionWorkbook.xlsx.load(await xlsResponse.body())
            expect(sessionWorkbook.worksheets.map((sheet) => sheet.name)).toEqual(["Riepilogo", "Categorie", "Vendite", "Sconti", "Ordini", "Consumi"])
            expect(sessionWorkbook.getWorksheet("Riepilogo")?.getCell("B2").value).toBe(posName)
            expect(sessionWorkbook.getWorksheet("Vendite")?.getColumn(4).values).toContain("Staff + Promo Cassa")

            const eventCsvResponse = await page.request.get("/admin/export?format=csv")
            expect(eventCsvResponse.ok()).toBeTruthy()
            const eventCsvPayload = await eventCsvResponse.text()
            expect(eventCsvPayload).toContain("Tipo riga,Categoria,Prodotto,Descrizione breve")
            expect(eventCsvPayload).not.toContain("Staff + Promo Cassa")

            const eventXlsResponse = await page.request.get("/admin/export?format=xls")
            expect(eventXlsResponse.ok()).toBeTruthy()
            const eventWorkbook = new ExcelJS.Workbook()
            await eventWorkbook.xlsx.load(await eventXlsResponse.body())
            expect(eventWorkbook.worksheets.map((sheet) => sheet.name)).toContain("Categorie")
            expect(eventWorkbook.getWorksheet("Vendite")?.rowCount).toBe(1)

            await row.getByRole("button", { name: "Ristampa", exact: true }).click()
            await expect(row.getByText("Riepilogo inviato")).toBeVisible({ timeout: 15000 })

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

            await row.getByRole("button", { name: "Rendi normale", exact: true }).click()
            await expect(row.getByRole("button", { name: "Segna TEST", exact: true })).toBeVisible({ timeout: 15000 })
            await expect(page.getByTestId("dashboard-kpi-total")).toContainText(/20,00\s*€/)
            const eveningProductRow = eveningProducts.getByTestId("dashboard-evening-product-row").filter({ hasText: productName })
            await expect(eveningProductRow).toBeVisible()
            await expect(eveningProductRow.getByTestId("dashboard-evening-product-quantity")).toHaveText("4")
            const reclassifiedEventCsv = await page.request.get("/admin/export?format=csv")
            expect(await reclassifiedEventCsv.text()).toContain("Staff + Promo Cassa")

            await row.getByRole("button", { name: "Segna TEST", exact: true }).click()
            await expect(row.getByRole("button", { name: "Rendi normale", exact: true })).toBeVisible({ timeout: 15000 })
            await row.getByRole("button", { name: "Rendi normale", exact: true }).click()
            await expect(row.getByRole("button", { name: "Segna TEST", exact: true })).toBeVisible({ timeout: 15000 })

            await row.getByRole("button", { name: "Elimina", exact: true }).click()
            const deleteDialog = page.getByRole("dialog").filter({ hasText: "Elimina definitivamente la sessione" })
            await deleteDialog.getByLabel("Conferma eliminazione sessione").fill("ELIMINA")
            await deleteDialog.getByRole("button", { name: "Elimina sessione", exact: true }).click()
            await expect(row).toHaveCount(0, { timeout: 15000 })
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
