export type DiscountType = "NONE" | "PERCENT" | "FIXED"

export interface DiscountInput {
    type?: string | null
    value?: number | null
    label?: string | null
}

export interface LineDiscountInput extends DiscountInput {
    productId: string
}

export interface DiscountableLineItem {
    productId: string
    quantity: number
    unitAmount: number
}

export interface OrderDiscountMeta {
    type: "PERCENT" | "FIXED"
    value: number
    label?: string
    baseAmount: number
    scope: "ORDER"
}

export interface LineDiscountMeta {
    type: "PERCENT" | "FIXED"
    value: number
    label?: string
    baseUnitAmount: number
}

export interface LineDiscountResult {
    productId: string
    quantity: number
    baseUnitAmount: number
    baseAmount: number
    discountApplied: number
    finalAmount: number
    discountMeta?: LineDiscountMeta
}

export interface OrderDiscountSummary {
    baseAmount: number
    lineDiscountAmount: number
    orderDiscountAmount: number
    discountApplied: number
    finalAmount: number
    orderDiscountMeta?: OrderDiscountMeta
    lineResults: LineDiscountResult[]
}

export type ComputeOrderDiscountsResult =
    | { success: true, summary: OrderDiscountSummary }
    | { success: false, error: string }

interface NormalizedDiscount {
    type: "PERCENT" | "FIXED"
    value: number
    label?: string
}

function toCents(amount: number): number {
    return Math.round(amount * 100)
}

function fromCents(value: number): number {
    return Number((value / 100).toFixed(2))
}

function normalizeText(value?: string | null): string | undefined {
    const normalized = value?.trim()
    return normalized || undefined
}

function normalizeDiscount(input?: DiscountInput | null): NormalizedDiscount | null {
    const rawType = input?.type?.trim().toUpperCase() || "NONE"
    if (rawType !== "PERCENT" && rawType !== "FIXED") return null

    const rawValue = Number(input?.value)
    if (!Number.isFinite(rawValue) || rawValue <= 0) return null

    const normalizedValue = rawType === "PERCENT"
        ? Math.min(100, Number(rawValue.toFixed(2)))
        : Number(rawValue.toFixed(2))

    if (normalizedValue <= 0) return null

    return {
        type: rawType,
        value: normalizedValue,
        label: normalizeText(input?.label)
    }
}

function computeDiscountCents(baseCents: number, discount: NormalizedDiscount): number {
    if (baseCents <= 0) return 0
    if (discount.type === "PERCENT") {
        return Math.min(baseCents, Math.round(baseCents * (discount.value / 100)))
    }
    return Math.min(baseCents, toCents(discount.value))
}

export function computeOrderDiscounts(options: {
    lines: DiscountableLineItem[]
    orderDiscount?: DiscountInput | null
    lineDiscounts?: LineDiscountInput[] | null
    allowStacking?: boolean
}): ComputeOrderDiscountsResult {
    const lines = options.lines || []
    if (lines.length === 0) {
        return { success: false, error: "Carrello non valido: nessuna riga disponibile" }
    }

    const hasInvalidLine = lines.some((line) =>
        !line.productId?.trim()
        || !Number.isFinite(line.quantity)
        || line.quantity <= 0
        || !Number.isFinite(line.unitAmount)
        || line.unitAmount < 0
    )
    if (hasInvalidLine) {
        return { success: false, error: "Carrello non valido: valori riga non coerenti" }
    }

    const normalizedOrderDiscount = normalizeDiscount(options.orderDiscount)

    const lineDiscountMap = new Map<string, NormalizedDiscount>()
    ;(options.lineDiscounts || []).forEach((entry) => {
        const productId = entry.productId?.trim()
        const normalized = normalizeDiscount(entry)
        if (!productId || !normalized) return
        lineDiscountMap.set(productId, normalized)
    })

    if (!options.allowStacking && normalizedOrderDiscount && lineDiscountMap.size > 0) {
        return {
            success: false,
            error: "Non è possibile combinare sconto ordine e sconti su singole righe"
        }
    }

    const lineProductIds = new Set(lines.map((line) => line.productId))
    const unknownLineDiscount = [...lineDiscountMap.keys()].find((productId) => !lineProductIds.has(productId))
    if (unknownLineDiscount) {
        return { success: false, error: "Sconto riga non valido: prodotto non presente nel carrello" }
    }

    let baseCents = 0
    let lineDiscountCents = 0
    const lineResults: LineDiscountResult[] = []

    lines.forEach((line) => {
        const productId = line.productId.trim()
        const quantity = Math.max(1, Math.floor(line.quantity))
        const unitCents = toCents(Math.max(0, Number(line.unitAmount)))
        const baseLineCents = unitCents * quantity
        const lineDiscount = lineDiscountMap.get(productId)
        const appliedLineDiscountCents = lineDiscount
            ? computeDiscountCents(baseLineCents, lineDiscount)
            : 0
        const finalLineCents = baseLineCents - appliedLineDiscountCents

        baseCents += baseLineCents
        lineDiscountCents += appliedLineDiscountCents

        lineResults.push({
            productId,
            quantity,
            baseUnitAmount: fromCents(unitCents),
            baseAmount: fromCents(baseLineCents),
            discountApplied: fromCents(appliedLineDiscountCents),
            finalAmount: fromCents(finalLineCents),
            discountMeta: lineDiscount
                ? {
                    type: lineDiscount.type,
                    value: lineDiscount.value,
                    label: lineDiscount.label,
                    baseUnitAmount: fromCents(unitCents)
                }
                : undefined
        })
    })

    const baseAfterLineCents = baseCents - lineDiscountCents
    const orderDiscountCents = normalizedOrderDiscount
        ? computeDiscountCents(baseAfterLineCents, normalizedOrderDiscount)
        : 0
    const totalDiscountCents = lineDiscountCents + orderDiscountCents
    const finalAmountCents = baseCents - totalDiscountCents

    return {
        success: true,
        summary: {
            baseAmount: fromCents(baseCents),
            lineDiscountAmount: fromCents(lineDiscountCents),
            orderDiscountAmount: fromCents(orderDiscountCents),
            discountApplied: fromCents(totalDiscountCents),
            finalAmount: fromCents(finalAmountCents),
            orderDiscountMeta: normalizedOrderDiscount
                ? {
                    type: normalizedOrderDiscount.type,
                    value: normalizedOrderDiscount.value,
                    label: normalizedOrderDiscount.label,
                    baseAmount: fromCents(baseAfterLineCents),
                    scope: "ORDER"
                }
                : undefined,
            lineResults
        }
    }
}
