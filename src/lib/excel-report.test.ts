import { describe, expect, test } from "vitest"
import ExcelJS from "exceljs"
import { buildCashSessionWorkbook, buildCashSessionsWorkbook, buildEventWorkbook } from "@/lib/excel-report"

function rowValues(sheet: ExcelJS.Worksheet, row: number, firstColumn: number, lastColumn: number) {
    return Array.from({ length: lastColumn - firstColumn + 1 }, (_, index) => sheet.getRow(row).getCell(firstColumn + index).value)
}

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

    test("keeps the single-session workbook layout and TEST marker unchanged", async () => {
        const buffer = await buildCashSessionWorkbook({
            eventName: "Festa", posDeviceName: "Cassa 1", sessionId: "s1", status: "CLOSED", isTest: true,
            paidOrdersCount: 1, cashSalesAmount: 10, salesBreakdown: sales
        })
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(buffer)
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Riepilogo", "Categorie", "Vendite", "Sconti", "Ordini", "Consumi"])
        expect(workbook.getWorksheet("Riepilogo")?.getCell("D2").value).toBe("TEST - NON CONTABILIZZARE")
        expect(workbook.getWorksheet("Categorie")?.getRow(1).values).toEqual([undefined, "Categoria", "Quantità", "Lordo", "Sconto", "Netto"])
        expect(workbook.getWorksheet("Vendite")?.getRow(1).values).toEqual([undefined, "Categoria", "Prodotto", "Regime", "Sconto", "Quantità", "Lordo", "Sconto importo", "Netto"])
    })

    test("aggregates two traceable sessions in cents and flags TEST data", async () => {
        const testSales = {
            rows: [{
                ...sales.rows[0], categoryName: "Cucina", categoryOrder: 2, productKey: "p2", productName: "Panino", displayName: "Panino",
                quantitySold: 1, grossAmount: 0.2, discountAmount: 0.1, netAmount: 0.1
            }],
            discountSummaries: [{ label: "Staff", mode: "Percentuale", value: "50%", ordersCount: 1, discountAmount: 0.1 }],
            totals: { quantitySold: 1, grossAmount: 0.2, discountAmount: 0.1, netAmount: 0.1 }
        }
        const buffer = await buildCashSessionsWorkbook([
            {
                eventName: "Festa", posDeviceName: "Cassa 1", sessionId: "s1", status: "CLOSED",
                paidOrdersCount: 1, openingFloatAmount: 0.1, cashSalesAmount: 0.1, cardSalesAmount: 0.2, otherSalesAmount: 0.3,
                expectedCashAmount: 0.2, closingCountedCashAmount: 0.2, varianceAmount: 0, salesBreakdown: sales,
                orders: [{ id: "o1", orderCode: "A1", paymentMethod: "CASH", netAmount: 0.1 }],
                productConsumptions: [{ productId: "p1", productName: "Birra", quantityConsumed: 2, revenueAmount: 10 }]
            },
            {
                eventName: "Festa", posDeviceName: "Cassa 2", sessionId: "s2", status: "CLOSED", isTest: true,
                paidOrdersCount: 2, openingFloatAmount: 0.2, cashSalesAmount: 0.2, cardSalesAmount: 0.3, otherSalesAmount: 0.4,
                expectedCashAmount: 0.4, closingCountedCashAmount: 0.3, varianceAmount: -0.1, salesBreakdown: testSales,
                orders: [{ id: "o2", orderCode: "A2", paymentMethod: "CARD", netAmount: 0.1 }],
                productConsumptions: [{ productId: "p2", productName: "Panino", quantityConsumed: 1, revenueAmount: 0.1 }]
            }
        ])
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(buffer)

        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Riepilogo", "Categorie", "Vendite", "Sconti", "Ordini", "Consumi"])
        const summary = workbook.getWorksheet("Riepilogo")!
        expect(summary.getCell("C2").value).toBe("s1")
        expect(summary.getCell("C3").value).toBe("s2")
        expect(summary.getCell("D3").value).toBe("TEST - NON CONTABILIZZARE")
        expect(summary.getCell("A4").value).toBe("TOTALE SESSIONI SELEZIONATE")
        expect(summary.getCell("D4").value).toContain("TEST")
        expect(rowValues(summary, 4, 7, 14)).toEqual([3, 0.3, 0.3, 0.5, 0.7, 0.6, 0.5, -0.1])

        const categories = workbook.getWorksheet("Categorie")!
        expect(rowValues(categories, 1, 1, 2)).toEqual(["Sessione", "Postazione"])
        expect(rowValues(categories, 2, 1, 3)).toEqual(["s1", "Cassa 1", "Bar"])
        expect(rowValues(categories, 3, 1, 3)).toEqual(["s1", "Cassa 1", "TOTALE SESSIONE"])
        expect(rowValues(categories, 4, 1, 3)).toEqual(["s2", "Cassa 2", "Cucina"])
        expect(rowValues(categories, 5, 1, 3)).toEqual(["s2", "Cassa 2", "TOTALE SESSIONE"])
        expect(rowValues(categories, 6, 3, 7)).toEqual(["TOTALE COMPLESSIVO", 3, 10.2, 0.1, 10.1])

        for (const sheetName of ["Vendite", "Sconti", "Ordini", "Consumi"]) {
            expect(rowValues(workbook.getWorksheet(sheetName)!, 1, 1, 2)).toEqual(["Sessione", "Postazione"])
        }
        expect(rowValues(workbook.getWorksheet("Vendite")!, 3, 1, 3)).toEqual(["s2", "Cassa 2", "Cucina"])
        expect(rowValues(workbook.getWorksheet("Sconti")!, 2, 1, 2)).toEqual(["s2", "Cassa 2"])
        expect(rowValues(workbook.getWorksheet("Ordini")!, 3, 1, 2)).toEqual(["s2", "Cassa 2"])
        expect(rowValues(workbook.getWorksheet("Consumi")!, 3, 1, 2)).toEqual(["s2", "Cassa 2"])
    })
})
