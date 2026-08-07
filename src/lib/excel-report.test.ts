import { describe, expect, test } from "vitest"
import ExcelJS from "exceljs"
import { buildCashSessionWorkbook, buildEventWorkbook } from "@/lib/excel-report"

const sales = {
    rows: [{
        categoryName: "Bar", categoryOrder: 1, productKey: "p1", productName: "Birra", displayName: "Birra",
        pricingRegime: "PREZZO PIENO" as const, discountLabel: "-", discountMode: "-", discountValue: "-", groupLabel: "PREZZO PIENO",
        quantitySold: 2, grossAmount: 10, discountAmount: 0, netAmount: 10
    }],
    discountSummaries: [],
    totals: { quantitySold: 2, grossAmount: 10, discountAmount: 0, netAmount: 10 }
}

describe("xlsx reports", () => {
    test("creates the event workbook with tabular sheets and numeric money cells", async () => {
        const buffer = await buildEventWorkbook({
            eventName: "Festa",
            sales,
            stats: {
                generatedAt: "2026-08-06T12:00:00.000Z",
                summary: { totalRevenue: 10, cashRevenue: 10, cardRevenue: 0, otherRevenue: 0, paidOrdersCount: 1, averageTicket: 10 },
                bestSellers: [{ productId: "p1", productName: "Birra", quantitySold: 2, ordersCount: 1 }],
                underperforming: [],
                paidOrders: [{ orderId: "o1", createdAt: "2026-08-06T12:00:00.000Z", paymentMethod: "CASH", totalAmount: 10, itemCount: 2 }]
            }
        })
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(buffer)
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Riepilogo", "Categorie", "Vendite", "Sconti", "Ordini", "Top prodotti", "Sotto soglia"])
        expect(workbook.getWorksheet("Categorie")?.getRow(1).values).toEqual([undefined, "Categoria", "Quantità", "Lordo", "Sconto", "Netto"])
        expect(workbook.getWorksheet("Categorie")?.getCell("B2").value).toBe(2)
        expect(workbook.getWorksheet("Categorie")?.getCell("C2").value).toBe(10)
    })

    test("marks TEST sessions and creates all session sheets", async () => {
        const buffer = await buildCashSessionWorkbook({
            eventName: "Festa", posDeviceName: "Cassa 1", sessionId: "s1", status: "CLOSED", isTest: true,
            paidOrdersCount: 1, cashSalesAmount: 10, salesBreakdown: sales
        })
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(buffer)
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Riepilogo", "Categorie", "Vendite", "Sconti", "Ordini", "Consumi"])
        expect(workbook.getWorksheet("Riepilogo")?.getCell("D2").value).toBe("TEST - NON CONTABILIZZARE")
    })
})
