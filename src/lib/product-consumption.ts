export interface ProductConsumptionCatalogEntry {
    name?: string | null
    basePrice?: number | null
}

export interface ProductConsumptionCartItem {
    productId?: string | { toString(): string } | null
    snapshotName?: string | null
    quantity?: number | null
    selectedOptions?: Array<{ priceVariation?: number | null } | null> | null
    discountApplied?: number | null
    lineTotal?: number | null
}

export interface ProductConsumptionOrder {
    totalAmount?: number | null
    discountApplied?: number | null
    cart?: ProductConsumptionCartItem[] | null
}

export interface ProductConsumptionMetric {
    productId?: string
    productKey: string
    productName: string
    quantityConsumed: number
    revenueAmount: number
}

function toCents(value: number | null | undefined): number {
    if (!Number.isFinite(value)) return 0
    return Math.round(Math.max(0, Number(value)) * 100)
}

function fromCents(value: number): number {
    return Number((Math.max(0, value) / 100).toFixed(2))
}

function getProductId(value: ProductConsumptionCartItem["productId"]): string | undefined {
    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed || undefined
    }

    if (value && typeof value === "object" && typeof value.toString === "function") {
        const stringValue = value.toString().trim()
        return stringValue || undefined
    }

    return undefined
}

function normalizeQuantity(value: number | null | undefined): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.floor(Number(value)))
}

function getOptionAdjustmentsCents(item: ProductConsumptionCartItem): number {
    if (!Array.isArray(item.selectedOptions) || item.selectedOptions.length === 0) return 0
    return item.selectedOptions.reduce((sum, option) => {
        return sum + toCents(option?.priceVariation)
    }, 0)
}

function hasPersistedLineTotal(item: ProductConsumptionCartItem): boolean {
    return Number.isFinite(item.lineTotal) && Number(item.lineTotal) >= 0
}

function computeItemRevenueCents(
    item: ProductConsumptionCartItem,
    catalogEntry?: ProductConsumptionCatalogEntry
): number {
    const quantity = normalizeQuantity(item.quantity)
    if (quantity <= 0) return 0

    if (hasPersistedLineTotal(item)) {
        // Historical line totals are authoritative when available.
        return toCents(item.lineTotal)
    }

    const basePriceCents = catalogEntry ? toCents(catalogEntry.basePrice) : 0
    const unitPriceCents = basePriceCents + getOptionAdjustmentsCents(item)
    const grossAmountCents = unitPriceCents * quantity
    const discountCents = toCents(item.discountApplied)
    return Math.max(0, grossAmountCents - discountCents)
}

function allocateCentsByWeights(totalCents: number, weights: number[]): number[] {
    if (weights.length === 0 || totalCents <= 0) return weights.map(() => 0)

    const sanitizedWeights = weights.map((weight) => Math.max(0, Math.floor(weight)))
    let weightSum = sanitizedWeights.reduce((sum, weight) => sum + weight, 0)
    const effectiveWeights = weightSum > 0 ? sanitizedWeights : sanitizedWeights.map(() => 1)
    weightSum = effectiveWeights.reduce((sum, weight) => sum + weight, 0)

    const provisional = effectiveWeights.map((weight, index) => {
        const weighted = totalCents * weight
        const cents = Math.floor(weighted / weightSum)
        const remainder = weighted % weightSum
        return { index, cents, remainder }
    })

    let remaining = totalCents - provisional.reduce((sum, entry) => sum + entry.cents, 0)
    provisional
        .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
        .forEach((entry) => {
            if (remaining <= 0) return
            entry.cents += 1
            remaining -= 1
        })

    return provisional
        .sort((left, right) => left.index - right.index)
        .map((entry) => entry.cents)
}

function getOrderTargetRevenueCents(
    order: ProductConsumptionOrder,
    preliminaryRevenueCents: number,
    lineDiscountCents: number
): number {
    if (Number.isFinite(order.totalAmount)) {
        return toCents(order.totalAmount)
    }

    const residualOrderDiscountCents = Math.max(0, toCents(order.discountApplied) - lineDiscountCents)
    return Math.max(0, preliminaryRevenueCents - residualOrderDiscountCents)
}

export function aggregateOrderProductConsumptions(options: {
    orders: ProductConsumptionOrder[]
    catalogByProductId?: Map<string, ProductConsumptionCatalogEntry>
}): ProductConsumptionMetric[] {
    const resultByKey = new Map<string, ProductConsumptionMetric & { revenueCents: number }>()
    const catalogByProductId = options.catalogByProductId || new Map<string, ProductConsumptionCatalogEntry>()

    for (const order of options.orders) {
        const orderLines: Array<{
            productId?: string
            productKey: string
            productName: string
            quantityConsumed: number
            revenueCents: number
            weightCents: number
        }> = []
        let preliminaryRevenueCents = 0
        let lineDiscountCents = 0

        for (const item of order.cart || []) {
            const quantity = normalizeQuantity(item.quantity)
            if (quantity <= 0) continue

            const productId = getProductId(item.productId)
            const snapshotName = item.snapshotName?.trim()
            const productKey = productId ? `product:${productId}` : `snapshot:${snapshotName || "unknown"}`
            const catalogEntry = productId ? catalogByProductId.get(productId) : undefined
            const productName = catalogEntry?.name?.trim() || snapshotName || "Prodotto"
            const revenueCents = computeItemRevenueCents(item, catalogEntry)
            const weightCents = revenueCents > 0 ? revenueCents : quantity

            preliminaryRevenueCents += revenueCents
            if (!hasPersistedLineTotal(item)) {
                lineDiscountCents += toCents(item.discountApplied)
            }

            orderLines.push({
                productId,
                productKey,
                productName,
                quantityConsumed: quantity,
                revenueCents,
                weightCents
            })
        }

        if (orderLines.length === 0) continue

        const targetRevenueCents = getOrderTargetRevenueCents(order, preliminaryRevenueCents, lineDiscountCents)
        const allocatedRevenueCents = allocateCentsByWeights(
            targetRevenueCents,
            orderLines.map((line) => line.weightCents)
        )

        orderLines.forEach((line, index) => {
            const existing = resultByKey.get(line.productKey)
            if (existing) {
                existing.quantityConsumed += line.quantityConsumed
                existing.revenueCents += allocatedRevenueCents[index]
                return
            }

            resultByKey.set(line.productKey, {
                productId: line.productId,
                productKey: line.productKey,
                productName: line.productName,
                quantityConsumed: line.quantityConsumed,
                revenueAmount: 0,
                revenueCents: allocatedRevenueCents[index]
            })
        })
    }

    return Array.from(resultByKey.values())
        .map((metric) => ({
            productId: metric.productId,
            productKey: metric.productKey,
            productName: metric.productName,
            quantityConsumed: metric.quantityConsumed,
            revenueAmount: fromCents(metric.revenueCents)
        }))
        .sort((left, right) => {
            if (right.quantityConsumed !== left.quantityConsumed) {
                return right.quantityConsumed - left.quantityConsumed
            }
            if (right.revenueAmount !== left.revenueAmount) {
                return right.revenueAmount - left.revenueAmount
            }
            return left.productName.localeCompare(right.productName, "it")
        })
}
