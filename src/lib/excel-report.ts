import ExcelJS from "exceljs"
import { formatDashboardDateTime, type DashboardStatsResult } from "@/lib/dashboard-stats"
import type { CashSessionReportInput } from "@/lib/cash-session"
import type { ProductSalesBreakdownResult } from "@/lib/product-consumption"

type Cell = string | number | boolean | Date | null

function addSheet(workbook: ExcelJS.Workbook, name: string, headers: string[], rows: Cell[][]) {
    const sheet = workbook.addWorksheet(name)
    sheet.addRow(headers)
    rows.forEach((row) => sheet.addRow(row))
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headers.length } }
    sheet.getRow(1).font = { bold: true }
    sheet.getRow(1).alignment = { vertical: "middle" }
    headers.forEach((header, index) => {
        const column = sheet.getColumn(index + 1)
        column.width = Math.min(42, Math.max(12, header.length + 2, ...rows.map((row) => String(row[index] ?? "").length + 2)))
        if (/importo|incasso|lordo|sconto|netto|prezzo|totale|fondo|contante|differenza|ricavo/i.test(header)) column.numFmt = '#,##0.00 "€"'
    })
    return sheet
}

function categoryRows(sales: ProductSalesBreakdownResult) {
    const totals = new Map<string, { quantity: number; gross: number; discount: number; net: number }>()
    for (const row of sales.rows) {
        const current = totals.get(row.categoryName) || { quantity: 0, gross: 0, discount: 0, net: 0 }
        current.quantity += row.quantitySold
        current.gross += row.grossAmount
        current.discount += row.discountAmount
        current.net += row.netAmount
        totals.set(row.categoryName, current)
    }
    return [
        ...[...totals].map(([category, value]) => [category, value.quantity, value.gross, value.discount, value.net] as Cell[]),
        ["TOTALE GENERALE", sales.totals.quantitySold, sales.totals.grossAmount, sales.totals.discountAmount, sales.totals.netAmount]
    ]
}

function salesRows(sales: ProductSalesBreakdownResult): Cell[][] {
    return sales.rows.map((row) => [row.categoryName, row.displayName, row.pricingRegime, row.discountLabel, row.quantitySold, row.grossAmount, row.discountAmount, row.netAmount])
}

function toCents(value: number | null | undefined) {
    return Number.isFinite(value) ? Math.round(Number(value) * 100) : 0
}

function fromCents(value: number) {
    return Number((value / 100).toFixed(2))
}

function sumMoney(reports: CashSessionReportInput[], amount: (report: CashSessionReportInput) => number | null | undefined) {
    return fromCents(reports.reduce((total, report) => total + toCents(amount(report)), 0))
}

function cashSessionCategoryRows(reports: CashSessionReportInput[]): Cell[][] {
    const rows: Cell[][] = []
    for (const report of reports) {
        const sales = report.salesBreakdown || { rows: [], discountSummaries: [], totals: { quantitySold: 0, grossAmount: 0, discountAmount: 0, netAmount: 0 } }
        const categories = new Map<string, { quantity: number; gross: number; discount: number; net: number }>()
        for (const sale of sales.rows) {
            const current = categories.get(sale.categoryName) || { quantity: 0, gross: 0, discount: 0, net: 0 }
            current.quantity += sale.quantitySold
            current.gross += toCents(sale.grossAmount)
            current.discount += toCents(sale.discountAmount)
            current.net += toCents(sale.netAmount)
            categories.set(sale.categoryName, current)
        }
        for (const [category, value] of categories) {
            rows.push([report.sessionId, report.posDeviceName, category, value.quantity, fromCents(value.gross), fromCents(value.discount), fromCents(value.net)])
        }
        rows.push([
            report.sessionId, report.posDeviceName, "TOTALE SESSIONE", sales.totals.quantitySold,
            fromCents(toCents(sales.totals.grossAmount)), fromCents(toCents(sales.totals.discountAmount)), fromCents(toCents(sales.totals.netAmount))
        ])
    }
    rows.push([
        "", "", "TOTALE COMPLESSIVO",
        reports.reduce((total, report) => total + Number(report.salesBreakdown?.totals.quantitySold || 0), 0),
        sumMoney(reports, (report) => report.salesBreakdown?.totals.grossAmount),
        sumMoney(reports, (report) => report.salesBreakdown?.totals.discountAmount),
        sumMoney(reports, (report) => report.salesBreakdown?.totals.netAmount)
    ])
    return rows
}

export async function buildEventWorkbook(input: { eventName: string; stats: DashboardStatsResult; sales: ProductSalesBreakdownResult; intervalLabel?: string; timezone?: string }) {
    const workbook = new ExcelJS.Workbook()
    addSheet(workbook, "Riepilogo", ["Evento", "Intervallo", "Generato il", "Ordini", "Incasso totale", "Contanti", "Carta", "Altro", "Scontrino medio"], [[
        input.eventName, input.intervalLabel || "Intera festa", formatDashboardDateTime(input.stats.generatedAt, input.timezone), input.stats.summary.paidOrdersCount, input.stats.summary.totalRevenue,
        input.stats.summary.cashRevenue, input.stats.summary.cardRevenue, input.stats.summary.otherRevenue, input.stats.summary.averageTicket
    ]])
    addSheet(workbook, "Categorie", ["Categoria", "Quantità", "Lordo", "Sconto", "Netto"], categoryRows(input.sales))
    addSheet(workbook, "Vendite", ["Categoria", "Prodotto", "Regime", "Sconto", "Quantità", "Lordo", "Sconto importo", "Netto"], salesRows(input.sales))
    addSheet(workbook, "Sconti", ["Sconto", "Tipo", "Valore", "Ordini", "Importo sconto"], input.sales.discountSummaries.map((row) => [row.label, row.mode, row.value, row.ordersCount, row.discountAmount]))
    addSheet(workbook, "Ordini", ["Data", "ID ordine", "Pagamento", "Articoli", "Totale"], input.stats.paidOrders.map((row) => [row.createdAt ? formatDashboardDateTime(row.createdAt, input.timezone) : null, row.orderId, row.paymentMethod, row.itemCount, row.totalAmount]))
    addSheet(workbook, "Top prodotti", ["Prodotto", "Quantità", "Ordini"], input.stats.bestSellers.map((row) => [row.productName, row.quantitySold, row.ordersCount]))
    addSheet(workbook, "Sotto soglia", ["Prodotto", "Quantità", "Ordini"], input.stats.underperforming.map((row) => [row.productName, row.quantitySold, row.ordersCount]))
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function buildCashSessionWorkbook(report: CashSessionReportInput) {
    const workbook = new ExcelJS.Workbook()
    const sales = report.salesBreakdown || { rows: [], discountSummaries: [], totals: { quantitySold: 0, grossAmount: 0, discountAmount: 0, netAmount: 0 } }
    addSheet(workbook, "Riepilogo", ["Evento", "Postazione", "Sessione", "Stato", "Apertura", "Chiusura", "Ordini", "Fondo", "Contanti", "Carta", "Altro", "Atteso", "Contato", "Differenza"], [[
        report.eventName, report.posDeviceName, report.sessionId, report.isTest ? "TEST - NON CONTABILIZZARE" : report.status,
        report.openedAt ? new Date(report.openedAt) : null, report.closedAt ? new Date(report.closedAt) : null, Number(report.paidOrdersCount || 0),
        Number(report.openingFloatAmount || 0), Number(report.cashSalesAmount || 0), Number(report.cardSalesAmount || 0), Number(report.otherSalesAmount || 0),
        Number(report.expectedCashAmount || 0), Number(report.closingCountedCashAmount || 0), Number(report.varianceAmount || 0)
    ]])
    addSheet(workbook, "Categorie", ["Categoria", "Quantità", "Lordo", "Sconto", "Netto"], categoryRows(sales))
    addSheet(workbook, "Vendite", ["Categoria", "Prodotto", "Regime", "Sconto", "Quantità", "Lordo", "Sconto importo", "Netto"], salesRows(sales))
    addSheet(workbook, "Sconti", ["Sconto", "Tipo", "Valore", "Ordini", "Importo sconto"], sales.discountSummaries.map((row) => [row.label, row.mode, row.value, row.ordersCount, row.discountAmount]))
    addSheet(workbook, "Ordini", ["Data", "Codice", "ID", "Pagamento", "Cliente", "Tavolo", "Sconto", "Netto"], (report.orders || []).map((row) => [row.createdAt ? new Date(row.createdAt) : null, row.orderCode || "", row.id || "", row.paymentMethod || "OTHER", row.customerName || "", row.customerTable || "", Number(row.discountAmount || 0), Number(row.netAmount ?? row.totalAmount ?? 0)]))
    addSheet(workbook, "Consumi", ["ID prodotto", "Prodotto", "Quantità", "Ricavo"], (report.productConsumptions || []).map((row) => [row.productId || "", row.productName, row.quantityConsumed, row.revenueAmount]))
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function buildCashSessionsWorkbook(reports: CashSessionReportInput[]) {
    const workbook = new ExcelJS.Workbook()
    const summaryRows: Cell[][] = reports.map((report) => [
        report.eventName, report.posDeviceName, report.sessionId, report.isTest ? "TEST - NON CONTABILIZZARE" : report.status,
        report.openedAt ? new Date(report.openedAt) : null, report.closedAt ? new Date(report.closedAt) : null, Number(report.paidOrdersCount || 0),
        Number(report.openingFloatAmount || 0), Number(report.cashSalesAmount || 0), Number(report.cardSalesAmount || 0), Number(report.otherSalesAmount || 0),
        Number(report.expectedCashAmount || 0), Number(report.closingCountedCashAmount || 0), Number(report.varianceAmount || 0)
    ])
    summaryRows.push([
        "TOTALE SESSIONI SELEZIONATE", "", "", reports.some((report) => report.isTest) ? "INCLUDE SESSIONI TEST - NON CONTABILIZZARE" : "TOTALE",
        null, null, reports.reduce((total, report) => total + Number(report.paidOrdersCount || 0), 0),
        sumMoney(reports, (report) => report.openingFloatAmount), sumMoney(reports, (report) => report.cashSalesAmount),
        sumMoney(reports, (report) => report.cardSalesAmount), sumMoney(reports, (report) => report.otherSalesAmount),
        sumMoney(reports, (report) => report.expectedCashAmount), sumMoney(reports, (report) => report.closingCountedCashAmount),
        sumMoney(reports, (report) => report.varianceAmount)
    ])

    addSheet(workbook, "Riepilogo", ["Evento", "Postazione", "Sessione", "Stato", "Apertura", "Chiusura", "Ordini", "Fondo", "Contanti", "Carta", "Altro", "Atteso", "Contato", "Differenza"], summaryRows)
    addSheet(workbook, "Categorie", ["Sessione", "Postazione", "Categoria", "Quantità", "Lordo", "Sconto", "Netto"], cashSessionCategoryRows(reports))
    addSheet(workbook, "Vendite", ["Sessione", "Postazione", "Categoria", "Prodotto", "Regime", "Sconto", "Quantità", "Lordo", "Sconto importo", "Netto"], reports.flatMap((report) => salesRows(report.salesBreakdown || { rows: [], discountSummaries: [], totals: { quantitySold: 0, grossAmount: 0, discountAmount: 0, netAmount: 0 } }).map((row) => [report.sessionId, report.posDeviceName, ...row])))
    addSheet(workbook, "Sconti", ["Sessione", "Postazione", "Sconto", "Tipo", "Valore", "Ordini", "Importo sconto"], reports.flatMap((report) => (report.salesBreakdown?.discountSummaries || []).map((row) => [report.sessionId, report.posDeviceName, row.label, row.mode, row.value, row.ordersCount, row.discountAmount])))
    addSheet(workbook, "Ordini", ["Sessione", "Postazione", "Data", "Codice", "ID", "Pagamento", "Cliente", "Tavolo", "Sconto", "Netto"], reports.flatMap((report) => (report.orders || []).map((row) => [report.sessionId, report.posDeviceName, row.createdAt ? new Date(row.createdAt) : null, row.orderCode || "", row.id || "", row.paymentMethod || "OTHER", row.customerName || "", row.customerTable || "", Number(row.discountAmount || 0), Number(row.netAmount ?? row.totalAmount ?? 0)])))
    addSheet(workbook, "Consumi", ["Sessione", "Postazione", "ID prodotto", "Prodotto", "Quantità", "Ricavo"], reports.flatMap((report) => (report.productConsumptions || []).map((row) => [report.sessionId, report.posDeviceName, row.productId || "", row.productName, row.quantityConsumed, row.revenueAmount])))
    return Buffer.from(await workbook.xlsx.writeBuffer())
}
