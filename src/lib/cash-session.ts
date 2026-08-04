import {
    buildProductSalesExportRows,
    type ProductSalesBreakdownResult
} from "./product-consumption"

export type CashSessionPaymentMethod = "CASH" | "CARD" | "OTHER"

export interface CashSessionOrderInput {
    status?: string | null
    paymentMethod?: string | null
    totalAmount?: number | null
}

export interface CashSessionComputedSummary {
    paidOrdersCount: number
    cashSalesAmount: number
    cardSalesAmount: number
    otherSalesAmount: number
    expectedCashAmount: number
    varianceAmount: number
}

export interface ComputeCashSessionSummaryOptions {
    openingFloatAmount: number
    closingCountedCashAmount: number
    orders: CashSessionOrderInput[]
}

export interface CashSessionReportOrderInput {
    id?: string | null
    orderCode?: string | null
    createdAt?: Date | string | null
    paymentMethod?: string | null
    totalAmount?: number | null
    discountAmount?: number | null
    netAmount?: number | null
    customerName?: string | null
    customerTable?: string | null
}

export interface CashSessionReportInput {
    eventName: string
    posDeviceName: string
    sessionId: string
    status: "OPEN" | "CLOSED"
    openedAt?: Date | string | null
    closedAt?: Date | string | null
    openingFloatAmount?: number | null
    closingCountedCashAmount?: number | null
    paidOrdersCount?: number | null
    cashSalesAmount?: number | null
    cardSalesAmount?: number | null
    otherSalesAmount?: number | null
    expectedCashAmount?: number | null
    varianceAmount?: number | null
    openingNotes?: string | null
    closingNotes?: string | null
    orders?: CashSessionReportOrderInput[]
    productConsumptions?: Array<{
        productId?: string | null
        productName: string
        quantityConsumed: number
        revenueAmount: number
    }>
    salesBreakdown?: ProductSalesBreakdownResult
}

interface CashSessionReportBuildOptions {
    timezone?: string
}

function normalizeAmount(value: number | null | undefined): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Number(value))
}

function toCents(amount: number): number {
    return Math.round(amount * 100)
}

function fromCents(cents: number): number {
    return Number((cents / 100).toFixed(2))
}

function normalizePaymentMethod(value: string | null | undefined): CashSessionPaymentMethod {
    const normalized = value?.trim().toUpperCase()
    if (normalized === "CASH") return "CASH"
    if (normalized === "CARD") return "CARD"
    return "OTHER"
}

function getPaymentMethodLabel(value: string | null | undefined): string {
    const method = normalizePaymentMethod(value)
    if (method === "CASH") return "Contanti"
    if (method === "CARD") return "Carta / POS"
    return "Altro"
}

function parseDateToMs(value: Date | string | null | undefined): number | null {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    const dateMs = date.getTime()
    return Number.isFinite(dateMs) ? dateMs : null
}

function formatDateTime(value: Date | string | null | undefined, timezone = "Europe/Rome"): string {
    const dateMs = parseDateToMs(value)
    if (dateMs === null) return "-"
    return new Intl.DateTimeFormat("it-IT", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(dateMs))
}

function normalizeText(value: string | null | undefined, fallback = "-"): string {
    const normalized = value?.trim()
    return normalized || fallback
}

function normalizeId(value: string | null | undefined): string {
    return normalizeText(value, "n/d")
}

function escapeDelimitedValue(value: string, delimiter: "," | "\t"): string {
    const mustQuote =
        value.includes(delimiter) ||
        value.includes('"') ||
        value.includes("\n") ||
        value.includes("\r")

    if (!mustQuote) return value
    return `"${value.replace(/"/g, '""')}"`
}

function serializeRow(cells: Array<string | number>, delimiter: "," | "\t"): string {
    return cells
        .map((cell) => escapeDelimitedValue(String(cell), delimiter))
        .join(delimiter)
}

export function computeCashSessionSummary(
    options: ComputeCashSessionSummaryOptions
): CashSessionComputedSummary {
    const openingFloatCents = toCents(normalizeAmount(options.openingFloatAmount))
    const countedCashCents = toCents(normalizeAmount(options.closingCountedCashAmount))

    let paidOrdersCount = 0
    let cashSalesCents = 0
    let cardSalesCents = 0
    let otherSalesCents = 0

    options.orders.forEach((order) => {
        const status = order.status?.trim().toUpperCase()
        if (status && status !== "PAID") return

        paidOrdersCount += 1
        const amountCents = toCents(normalizeAmount(order.totalAmount))
        const paymentMethod = normalizePaymentMethod(order.paymentMethod)

        if (paymentMethod === "CASH") cashSalesCents += amountCents
        else if (paymentMethod === "CARD") cardSalesCents += amountCents
        else otherSalesCents += amountCents
    })

    const expectedCashCents = openingFloatCents + cashSalesCents
    const varianceCents = countedCashCents - expectedCashCents

    return {
        paidOrdersCount,
        cashSalesAmount: fromCents(cashSalesCents),
        cardSalesAmount: fromCents(cardSalesCents),
        otherSalesAmount: fromCents(otherSalesCents),
        expectedCashAmount: fromCents(expectedCashCents),
        varianceAmount: fromCents(varianceCents)
    }
}

function buildCashSessionExport(
    report: CashSessionReportInput,
    options: CashSessionReportBuildOptions,
    delimiter: "," | "\t"
): string {
    const timezone = options.timezone || "Europe/Rome"
    const rows: string[] = []
    const sortedOrders = (report.orders || []).slice().sort((a, b) => {
        const aMs = parseDateToMs(a.createdAt) ?? 0
        const bMs = parseDateToMs(b.createdAt) ?? 0
        return bMs - aMs
    })

    rows.push(serializeRow(["Sezione", "Valore"], delimiter))
    rows.push(serializeRow(["Evento", normalizeText(report.eventName, "Evento non specificato")], delimiter))
    rows.push(serializeRow(["Postazione cassa", normalizeText(report.posDeviceName, "Postazione non specificata")], delimiter))
    rows.push(serializeRow(["Sessione ID", normalizeId(report.sessionId)], delimiter))
    rows.push(serializeRow(["Stato", report.status === "CLOSED" ? "Chiusa" : "Aperta"], delimiter))
    rows.push(serializeRow(["Apertura", formatDateTime(report.openedAt, timezone)], delimiter))
    rows.push(serializeRow(["Chiusura", formatDateTime(report.closedAt, timezone)], delimiter))
    rows.push(serializeRow(["Fondo iniziale", normalizeAmount(report.openingFloatAmount).toFixed(2)], delimiter))
    rows.push(serializeRow(["Incasso contanti", normalizeAmount(report.cashSalesAmount).toFixed(2)], delimiter))
    rows.push(serializeRow(["Incasso elettronico", normalizeAmount(report.cardSalesAmount).toFixed(2)], delimiter))
    rows.push(serializeRow(["Incasso altro", normalizeAmount(report.otherSalesAmount).toFixed(2)], delimiter))
    rows.push(serializeRow([
        "Totale incassi",
        (
            normalizeAmount(report.cashSalesAmount)
            + normalizeAmount(report.cardSalesAmount)
            + normalizeAmount(report.otherSalesAmount)
        ).toFixed(2)
    ], delimiter))
    rows.push(serializeRow(["Contante atteso (solo contanti)", normalizeAmount(report.expectedCashAmount).toFixed(2)], delimiter))
    rows.push(serializeRow(["Contante contato", normalizeAmount(report.closingCountedCashAmount).toFixed(2)], delimiter))
    rows.push(serializeRow(["Differenza", Number((report.varianceAmount ?? 0).toFixed(2)).toFixed(2)], delimiter))
    rows.push(serializeRow(["Ordini saldati", Math.max(0, Math.floor(Number(report.paidOrdersCount ?? 0)))], delimiter))
    rows.push(serializeRow(["Note apertura", normalizeText(report.openingNotes)], delimiter))
    rows.push(serializeRow(["Note chiusura", normalizeText(report.closingNotes)], delimiter))
    rows.push("")

    const productConsumptions = (report.productConsumptions || [])
        .filter((metric) => metric.quantityConsumed > 0)
        .sort((a, b) => {
            if (b.quantityConsumed !== a.quantityConsumed) return b.quantityConsumed - a.quantityConsumed
            if (b.revenueAmount !== a.revenueAmount) return b.revenueAmount - a.revenueAmount
            return a.productName.localeCompare(b.productName, "it")
        })

    rows.push("Consumo prodotti sessione")
    rows.push(serializeRow(["Prodotto", "Quantita consumata", "Incasso"], delimiter))
    if (productConsumptions.length === 0) {
        rows.push(serializeRow(["Nessun consumo registrato", 0, "0.00"], delimiter))
    } else {
        productConsumptions.forEach((metric) => {
            rows.push(serializeRow([
                normalizeText(metric.productName, "Prodotto senza nome"),
                Math.max(0, Math.floor(Number(metric.quantityConsumed) || 0)),
                normalizeAmount(metric.revenueAmount).toFixed(2)
            ], delimiter))
        })
    }
    rows.push("")

    if (report.salesBreakdown) {
        buildProductSalesExportRows(report.salesBreakdown).forEach((row) => {
            rows.push(serializeRow(row, delimiter))
        })
        rows.push("")
    }

    rows.push("Ordini sessione")
    rows.push(serializeRow(["Data", "Codice ordine", "Ordine", "Pagamento", "Cliente", "Tavolo", "Sconto", "Totale netto"], delimiter))
    if (sortedOrders.length === 0) {
        rows.push(serializeRow(["-", "-", "-", "-", "-", "-", "0.00", "0.00"], delimiter))
    } else {
        sortedOrders.forEach((order) => {
            rows.push(serializeRow([
                formatDateTime(order.createdAt, timezone),
                normalizeText(order.orderCode, "-"),
                normalizeId(order.id),
                getPaymentMethodLabel(order.paymentMethod),
                normalizeText(order.customerName),
                normalizeText(order.customerTable),
                normalizeAmount(order.discountAmount).toFixed(2),
                normalizeAmount(order.netAmount ?? order.totalAmount).toFixed(2)
            ], delimiter))
        })
    }

    return `\uFEFF${rows.join("\n")}`
}

export function buildCashSessionCsvContent(
    report: CashSessionReportInput,
    options: CashSessionReportBuildOptions = {}
): string {
    return buildCashSessionExport(report, options, ",")
}

export function buildCashSessionXlsCompatibleContent(
    report: CashSessionReportInput,
    options: CashSessionReportBuildOptions = {}
): string {
    return buildCashSessionExport(report, options, "\t")
}
