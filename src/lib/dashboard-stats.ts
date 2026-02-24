export type DashboardPaymentMethod = "CASH" | "CARD" | "OTHER"

export interface DashboardOrderItemInput {
    productId?: string | null
    snapshotName?: string | null
    quantity?: number | null
}

export interface DashboardOrderInput {
    id?: string | null
    status?: string | null
    createdAt?: Date | string | null
    totalAmount?: number | null
    paymentMethod?: string | null
    cart?: DashboardOrderItemInput[] | null
}

export interface DashboardProductInput {
    id: string
    name: string
}

export interface DashboardSummary {
    totalRevenue: number
    cashRevenue: number
    cardRevenue: number
    otherRevenue: number
    paidOrdersCount: number
    averageTicket: number
}

export interface DashboardProductMetric {
    productId: string
    productName: string
    quantitySold: number
    ordersCount: number
}

export interface DashboardPaidOrderMetric {
    orderId: string
    createdAt: string | null
    paymentMethod: DashboardPaymentMethod
    totalAmount: number
    itemCount: number
}

export interface DashboardStatsResult {
    generatedAt: string
    summary: DashboardSummary
    bestSellers: DashboardProductMetric[]
    underperforming: DashboardProductMetric[]
    paidOrders: DashboardPaidOrderMetric[]
}

export interface ComputeDashboardStatsOptions {
    orders: DashboardOrderInput[]
    products: DashboardProductInput[]
    bestSellerLimit?: number
    underperformingLimit?: number
    underperformingThreshold?: number
    includeOnlyPaid?: boolean
}

export interface DashboardExportOptions {
    eventName: string
    timezone?: string
}

const DEFAULT_LIMIT = 5
const DEFAULT_UNDERPERFORMING_THRESHOLD = 1
const FALLBACK_PRODUCT_NAME = "Prodotto senza nome"

interface ProductSalesAccumulator {
    quantitySold: number
    ordersCount: number
    fallbackName: string | null
}

interface SortablePaidOrderMetric extends DashboardPaidOrderMetric {
    createdAtMs: number
}

function sanitizeLimit(value: number | undefined): number {
    if (!Number.isFinite(value)) return DEFAULT_LIMIT
    const normalized = Math.floor(value as number)
    return Math.min(Math.max(normalized, 1), 50)
}

function toCents(amount: number): number {
    return Math.round(amount * 100)
}

function fromCents(cents: number): number {
    return Number((cents / 100).toFixed(2))
}

function normalizeAmount(value: number | null | undefined): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Number(value))
}

function normalizeQuantity(value: number | null | undefined): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.floor(Number(value)))
}

function normalizeProductName(value: string | null | undefined): string {
    const normalized = value?.trim()
    return normalized || FALLBACK_PRODUCT_NAME
}

function normalizeProductId(value: string | null | undefined): string | null {
    const normalized = value?.trim()
    return normalized || null
}

function parseDateToMs(value: Date | string | null | undefined): number | null {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    const dateMs = date.getTime()
    return Number.isFinite(dateMs) ? dateMs : null
}

function toIsoDate(value: Date | string | null | undefined): string | null {
    const dateMs = parseDateToMs(value)
    if (dateMs === null) return null
    return new Date(dateMs).toISOString()
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

function normalizeOrdersForComputation(
    orders: DashboardOrderInput[],
    includeOnlyPaid: boolean
): DashboardOrderInput[] {
    if (!includeOnlyPaid) return orders

    return orders.filter((order) => {
        const status = order.status?.trim().toUpperCase()
        return !status || status === "PAID"
    })
}

export function normalizePaymentMethod(paymentMethod: string | null | undefined): DashboardPaymentMethod {
    const normalized = paymentMethod?.trim().toUpperCase()
    if (normalized === "CASH") return "CASH"
    if (normalized === "CARD") return "CARD"
    return "OTHER"
}

export function getPaymentMethodLabel(paymentMethod: DashboardPaymentMethod): string {
    if (paymentMethod === "CASH") return "Contanti"
    if (paymentMethod === "CARD") return "Carta / POS"
    return "Altro"
}

export function formatDashboardDateTime(
    value: Date | string | null | undefined,
    timezone = "Europe/Rome"
): string {
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

export function computeDashboardStats(options: ComputeDashboardStatsOptions): DashboardStatsResult {
    const bestSellerLimit = sanitizeLimit(options.bestSellerLimit)
    const underperformingLimit = sanitizeLimit(options.underperformingLimit)
    const underperformingThreshold = Math.max(
        0,
        Math.floor(options.underperformingThreshold ?? DEFAULT_UNDERPERFORMING_THRESHOLD)
    )
    const includeOnlyPaid = options.includeOnlyPaid !== false
    const orders = normalizeOrdersForComputation(options.orders, includeOnlyPaid)

    const productNameById = new Map<string, string>()
    for (const product of options.products) {
        const productId = normalizeProductId(product.id)
        if (!productId) continue
        productNameById.set(productId, normalizeProductName(product.name))
    }

    const salesByProductId = new Map<string, ProductSalesAccumulator>()
    let totalRevenueCents = 0
    let cashRevenueCents = 0
    let cardRevenueCents = 0
    let otherRevenueCents = 0

    const paidOrders: SortablePaidOrderMetric[] = []

    orders.forEach((order, index) => {
        const amount = normalizeAmount(order.totalAmount)
        const amountCents = toCents(amount)
        const paymentMethod = normalizePaymentMethod(order.paymentMethod)
        const cart = Array.isArray(order.cart) ? order.cart : []
        let itemCount = 0

        const seenProductsInOrder = new Set<string>()

        for (const item of cart) {
            const quantity = normalizeQuantity(item.quantity)
            if (quantity <= 0) continue

            itemCount += quantity
            const productId = normalizeProductId(item.productId)
            if (!productId) continue

            const current = salesByProductId.get(productId) || {
                quantitySold: 0,
                ordersCount: 0,
                fallbackName: null
            }

            current.quantitySold += quantity
            if (!seenProductsInOrder.has(productId)) {
                current.ordersCount += 1
                seenProductsInOrder.add(productId)
            }
            if (!current.fallbackName) {
                const fallbackName = item.snapshotName?.trim()
                if (fallbackName) current.fallbackName = fallbackName
            }

            salesByProductId.set(productId, current)
        }

        totalRevenueCents += amountCents
        if (paymentMethod === "CASH") cashRevenueCents += amountCents
        else if (paymentMethod === "CARD") cardRevenueCents += amountCents
        else otherRevenueCents += amountCents

        const orderId = normalizeProductId(order.id) || `order-${index + 1}`
        const createdAtMs = parseDateToMs(order.createdAt) ?? 0
        paidOrders.push({
            orderId,
            createdAt: toIsoDate(order.createdAt),
            createdAtMs,
            paymentMethod,
            totalAmount: fromCents(amountCents),
            itemCount
        })
    })

    const bestSellers: DashboardProductMetric[] = Array.from(salesByProductId.entries())
        .map(([productId, acc]) => ({
            productId,
            productName: productNameById.get(productId) || normalizeProductName(acc.fallbackName),
            quantitySold: acc.quantitySold,
            ordersCount: acc.ordersCount
        }))
        .sort((a, b) => {
            if (b.quantitySold !== a.quantitySold) return b.quantitySold - a.quantitySold
            if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount
            return a.productName.localeCompare(b.productName, "it")
        })
        .slice(0, bestSellerLimit)

    const underperforming: DashboardProductMetric[] = Array.from(productNameById.entries())
        .map(([productId, productName]) => {
            const acc = salesByProductId.get(productId)
            return {
                productId,
                productName,
                quantitySold: acc?.quantitySold ?? 0,
                ordersCount: acc?.ordersCount ?? 0
            }
        })
        .filter((metric) => metric.quantitySold <= underperformingThreshold)
        .sort((a, b) => {
            if (a.quantitySold !== b.quantitySold) return a.quantitySold - b.quantitySold
            if (a.ordersCount !== b.ordersCount) return a.ordersCount - b.ordersCount
            return a.productName.localeCompare(b.productName, "it")
        })
        .slice(0, underperformingLimit)

    paidOrders.sort((a, b) => b.createdAtMs - a.createdAtMs)

    const paidOrdersCount = paidOrders.length
    const summary: DashboardSummary = {
        totalRevenue: fromCents(totalRevenueCents),
        cashRevenue: fromCents(cashRevenueCents),
        cardRevenue: fromCents(cardRevenueCents),
        otherRevenue: fromCents(otherRevenueCents),
        paidOrdersCount,
        averageTicket: paidOrdersCount > 0 ? fromCents(Math.round(totalRevenueCents / paidOrdersCount)) : 0
    }

    return {
        generatedAt: new Date().toISOString(),
        summary,
        bestSellers,
        underperforming,
        paidOrders: paidOrders.map((metric) => ({
            orderId: metric.orderId,
            createdAt: metric.createdAt,
            paymentMethod: metric.paymentMethod,
            totalAmount: metric.totalAmount,
            itemCount: metric.itemCount
        }))
    }
}

function buildDashboardExport(
    stats: DashboardStatsResult,
    exportOptions: DashboardExportOptions,
    delimiter: "," | "\t"
): string {
    const eventName = exportOptions.eventName.trim() || "Evento non specificato"
    const timezone = exportOptions.timezone || "Europe/Rome"
    const rows: string[] = []

    rows.push(serializeRow(["Sezione", "Valore"], delimiter))
    rows.push(serializeRow(["Evento", eventName], delimiter))
    rows.push(serializeRow(["Generato il", formatDashboardDateTime(stats.generatedAt, timezone)], delimiter))
    rows.push(serializeRow(["Incasso totale", stats.summary.totalRevenue.toFixed(2)], delimiter))
    rows.push(serializeRow(["Incasso contanti", stats.summary.cashRevenue.toFixed(2)], delimiter))
    rows.push(serializeRow(["Incasso carta", stats.summary.cardRevenue.toFixed(2)], delimiter))
    rows.push(serializeRow(["Incasso altro", stats.summary.otherRevenue.toFixed(2)], delimiter))
    rows.push(serializeRow(["Ordini saldati", stats.summary.paidOrdersCount], delimiter))
    rows.push(serializeRow(["Ticket medio", stats.summary.averageTicket.toFixed(2)], delimiter))
    rows.push("")

    rows.push("Top prodotti")
    rows.push(serializeRow(["Posizione", "Prodotto", "Quantita", "Ordini"], delimiter))
    if (stats.bestSellers.length === 0) {
        rows.push(serializeRow(["-", "Nessun dato", 0, 0], delimiter))
    } else {
        stats.bestSellers.forEach((metric, index) => {
            rows.push(
                serializeRow(
                    [index + 1, metric.productName, metric.quantitySold, metric.ordersCount],
                    delimiter
                )
            )
        })
    }
    rows.push("")

    rows.push("Prodotti sotto-performanti")
    rows.push(serializeRow(["Posizione", "Prodotto", "Quantita", "Ordini"], delimiter))
    if (stats.underperforming.length === 0) {
        rows.push(serializeRow(["-", "Nessun dato", 0, 0], delimiter))
    } else {
        stats.underperforming.forEach((metric, index) => {
            rows.push(
                serializeRow(
                    [index + 1, metric.productName, metric.quantitySold, metric.ordersCount],
                    delimiter
                )
            )
        })
    }
    rows.push("")

    rows.push("Ordini saldati")
    rows.push(serializeRow(["ID Ordine", "Data", "Pagamento", "Importo", "Articoli"], delimiter))
    if (stats.paidOrders.length === 0) {
        rows.push(serializeRow(["-", "-", "-", "0.00", 0], delimiter))
    } else {
        stats.paidOrders.forEach((order) => {
            rows.push(
                serializeRow(
                    [
                        order.orderId,
                        formatDashboardDateTime(order.createdAt, timezone),
                        getPaymentMethodLabel(order.paymentMethod),
                        order.totalAmount.toFixed(2),
                        order.itemCount
                    ],
                    delimiter
                )
            )
        })
    }

    return `\uFEFF${rows.join("\n")}`
}

export function buildDashboardCsvContent(
    stats: DashboardStatsResult,
    exportOptions: DashboardExportOptions
): string {
    return buildDashboardExport(stats, exportOptions, ",")
}

export function buildDashboardXlsCompatibleContent(
    stats: DashboardStatsResult,
    exportOptions: DashboardExportOptions
): string {
    return buildDashboardExport(stats, exportOptions, "\t")
}
