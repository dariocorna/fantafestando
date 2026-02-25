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
