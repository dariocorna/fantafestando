export interface ProductConsumptionCatalogEntry {
    name?: string | null
    shortName?: string | null
    basePrice?: number | null
    categoryKey?: string | null
    categoryName?: string | null
    categoryOrder?: number | null
}

export interface ProductDiscountMetaInput {
    type?: string | null
    label?: string | null
    value?: number | null
}

export interface ProductDiscountComponentInput extends ProductDiscountMetaInput {
    scope?: string | null
    baseAmount?: number | null
    appliedAmount?: number | null
    productId?: string | { toString(): string } | null
}

export interface ProductConsumptionCartItem {
    productId?: string | { toString(): string } | null
    snapshotName?: string | null
    quantity?: number | null
    selectedOptions?: Array<{ priceVariation?: number | null } | null> | null
    discountApplied?: number | null
    discountMeta?: ProductDiscountMetaInput | null
    lineTotal?: number | null
}

export interface ProductConsumptionOrder {
    pricingMode?: string | null
    totalAmount?: number | null
    discountApplied?: number | null
    discountMeta?: ProductDiscountMetaInput | null
    discountComponents?: ProductDiscountComponentInput[] | null
    cart?: ProductConsumptionCartItem[] | null
}

export interface ProductConsumptionMetric {
    productId?: string
    productKey: string
    productName: string
    quantityConsumed: number
    revenueAmount: number
}

export interface ProductSalesBreakdownRow {
    categoryKey?: string
    categoryName: string
    categoryOrder: number
    productId?: string
    productKey: string
    productName: string
    displayName: string
    pricingRegime: "PREZZO PIENO" | "SCONTATO"
    discountLabel: string
    discountMode: string
    discountValue: string
    groupLabel: string
    quantitySold: number
    grossAmount: number
    discountAmount: number
    netAmount: number
}

export interface DiscountSalesSummary {
    label: string
    mode: string
    value: string
    ordersCount: number
    discountAmount: number
}

export interface ProductSalesBreakdownResult {
    rows: ProductSalesBreakdownRow[]
    discountSummaries: DiscountSalesSummary[]
    totals: {
        quantitySold: number
        grossAmount: number
        discountAmount: number
        netAmount: number
    }
}

export interface ProductSalesCategorySummary {
    key: string
    name: string
    quantitySold: number
    grossAmount: number
    discountAmount: number
    netAmount: number
}

export type ProductSalesExportRow = Array<string | number>

export interface ProductSalesPrintRow {
    categoryName: string
    name: string
    qty: number
    lineTotal: number
    groupLabel: string
    grossAmount: number
    discountAmount: number
}

function toCents(value: number | null | undefined): number {
    if (!Number.isFinite(value)) return 0
    return Math.round(Math.max(0, Number(value)) * 100)
}

function fromCents(value: number): number {
    return Number((Math.max(0, value) / 100).toFixed(2))
}

function productSalesCategoryKey(row: ProductSalesBreakdownRow): string {
    return row.categoryKey?.trim() ? `key:${row.categoryKey.trim()}` : `name:${row.categoryName}`
}

export function buildProductSalesCategorySummaries(result: ProductSalesBreakdownResult): ProductSalesCategorySummary[] {
    const summaries = new Map<string, ProductSalesCategorySummary & {
        grossCents: number
        discountCents: number
        netCents: number
    }>()

    for (const row of result.rows) {
        const key = productSalesCategoryKey(row)
        const current = summaries.get(key) || {
            key,
            name: row.categoryName,
            quantitySold: 0,
            grossAmount: 0,
            discountAmount: 0,
            netAmount: 0,
            grossCents: 0,
            discountCents: 0,
            netCents: 0
        }
        current.quantitySold += row.quantitySold
        current.grossCents += toCents(row.grossAmount)
        current.discountCents += toCents(row.discountAmount)
        current.netCents += toCents(row.netAmount)
        summaries.set(key, current)
    }

    return [...summaries.values()].map(({ grossCents, discountCents, netCents, ...summary }) => ({
        ...summary,
        grossAmount: fromCents(grossCents),
        discountAmount: fromCents(discountCents),
        netAmount: fromCents(netCents)
    }))
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

function computeItemGrossCents(
    item: ProductConsumptionCartItem,
    catalogEntry?: ProductConsumptionCatalogEntry
): number {
    const quantity = normalizeQuantity(item.quantity)
    if (quantity <= 0) return 0

    if (hasPersistedLineTotal(item)) {
        return toCents(item.lineTotal) + toCents(item.discountApplied)
    }

    const basePriceCents = catalogEntry ? toCents(catalogEntry.basePrice) : 0
    const unitPriceCents = basePriceCents + getOptionAdjustmentsCents(item)
    return unitPriceCents * quantity
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

function allocateCentsWithinCapacities(totalCents: number, weights: number[], capacities: number[]): number[] {
    const result = capacities.map(() => 0)
    let remaining = Math.min(
        Math.max(0, Math.floor(totalCents)),
        capacities.reduce((sum, capacity) => sum + Math.max(0, Math.floor(capacity)), 0)
    )

    while (remaining > 0) {
        const activeIndexes = capacities
            .map((capacity, index) => ({ capacity: Math.max(0, Math.floor(capacity)) - result[index], index }))
            .filter((entry) => entry.capacity > 0)

        if (activeIndexes.length === 0) break

        const allocation = allocateCentsByWeights(
            remaining,
            activeIndexes.map((entry) => weights[entry.index])
        )
        let allocated = 0
        activeIndexes.forEach((entry, allocationIndex) => {
            const amount = Math.min(entry.capacity, allocation[allocationIndex])
            result[entry.index] += amount
            allocated += amount
        })

        if (allocated === 0) {
            const first = activeIndexes[0]
            result[first.index] += 1
            allocated = 1
        }
        remaining -= allocated
    }

    return result
}

interface NormalizedDiscountComponent {
    label: string
    mode: string
    value: string
    appliedCents: number
}

function normalizeDiscountComponent(
    input: ProductDiscountMetaInput,
    appliedCents: number,
    fallbackLabel = "Sconto non classificato"
): NormalizedDiscountComponent {
    const type = input.type?.trim().toUpperCase()
    const numericValue = Number(input.value)
    const combined = input.label?.trim().toLowerCase().startsWith("sconti:")
    const label = combined
        ? "Sconto combinato"
        : input.label?.trim() || (type === "PERCENT" ? "Sconto percentuale" : type === "FIXED" ? "Sconto fisso" : fallbackLabel)

    return {
        label,
        mode: combined ? "Combinato" : type === "PERCENT" ? "Percentuale" : type === "FIXED" ? "Fisso" : "Non classificato",
        value: combined || !Number.isFinite(numericValue)
            ? "-"
            : type === "PERCENT"
                ? `${Number(numericValue.toFixed(2))}%`
                : type === "FIXED"
                    ? `${fromCents(toCents(numericValue)).toFixed(2)} EUR`
                    : "-",
        appliedCents
    }
}

function buildPricingGroup(components: NormalizedDiscountComponent[]): Pick<
    ProductSalesBreakdownRow,
    "pricingRegime" | "discountLabel" | "discountMode" | "discountValue" | "groupLabel"
> {
    if (components.length === 0) {
        return {
            pricingRegime: "PREZZO PIENO",
            discountLabel: "-",
            discountMode: "-",
            discountValue: "-",
            groupLabel: "PREZZO PIENO"
        }
    }

    return {
        pricingRegime: "SCONTATO",
        discountLabel: components.map((component) => component.label).join(" + "),
        discountMode: components.length > 1 ? "Combinato" : components[0].mode,
        discountValue: components.map((component) => component.value).join(" + "),
        groupLabel: components.map((component) => component.label).join(" + ")
    }
}

export function aggregateOrderProductSales(options: {
    orders: ProductConsumptionOrder[]
    catalogByProductId?: Map<string, ProductConsumptionCatalogEntry>
}): ProductSalesBreakdownResult {
    const resultByKey = new Map<string, ProductSalesBreakdownRow & {
        grossCents: number
        discountCents: number
        netCents: number
    }>()
    const discountSummaryByKey = new Map<string, DiscountSalesSummary & {
        discountCents: number
        orderIndexes: Set<number>
    }>()
    const catalogByProductId = options.catalogByProductId || new Map<string, ProductConsumptionCatalogEntry>()

    options.orders.forEach((order, orderIndex) => {
        const orderLines: Array<{
            item: ProductConsumptionCartItem
            productId?: string
            productKey: string
            productName: string
            displayName: string
            categoryKey?: string
            categoryName: string
            categoryOrder: number
            quantitySold: number
            grossCents: number
            lineDiscountCents: number
            weightCents: number
        }> = []

        for (const item of order.cart || []) {
            const quantity = normalizeQuantity(item.quantity)
            if (quantity <= 0) continue

            const productId = getProductId(item.productId)
            const snapshotName = item.snapshotName?.trim()
            const productKey = productId ? `product:${productId}` : `snapshot:${snapshotName || "unknown"}`
            const catalogEntry = productId ? catalogByProductId.get(productId) : undefined
            const productName = catalogEntry?.name?.trim() || snapshotName || "Prodotto"
            const grossCents = computeItemGrossCents(item, catalogEntry)

            orderLines.push({
                item,
                productId,
                productKey,
                productName,
                displayName: (catalogEntry?.shortName?.trim() || productName).slice(0, 24),
                categoryKey: catalogEntry?.categoryKey?.trim() || undefined,
                categoryName: catalogEntry?.categoryName?.trim() || "Non categorizzato",
                categoryOrder: Number.isFinite(catalogEntry?.categoryOrder)
                    ? Number(catalogEntry?.categoryOrder)
                    : Number.MAX_SAFE_INTEGER,
                quantitySold: quantity,
                grossCents,
                lineDiscountCents: toCents(item.discountApplied),
                weightCents: grossCents > 0 ? grossCents : quantity
            })
        }

        if (orderLines.length === 0) return

        const preliminaryGrossCents = orderLines.reduce((sum, line) => sum + line.grossCents, 0)
        const declaredLineDiscountCents = orderLines.reduce((sum, line) => sum + line.lineDiscountCents, 0)
        const componentDiscountCents = (order.discountComponents || []).reduce(
            (sum, component) => sum + toCents(component.appliedAmount),
            0
        )
        const totalDiscountCents = Math.min(
            Number.isFinite(order.totalAmount)
                ? toCents(order.totalAmount) + Math.max(
                    toCents(order.discountApplied),
                    declaredLineDiscountCents,
                    componentDiscountCents
                )
                : preliminaryGrossCents,
            Math.max(toCents(order.discountApplied), declaredLineDiscountCents, componentDiscountCents)
        )
        const targetNetCents = Number.isFinite(order.totalAmount)
            ? toCents(order.totalAmount)
            : Math.max(0, preliminaryGrossCents - totalDiscountCents)
        const targetGrossCents = targetNetCents + totalDiscountCents
        const allocatedGrossCents = allocateCentsByWeights(
            targetGrossCents,
            orderLines.map((line) => line.weightCents)
        )
        const lineDiscountTargetCents = Math.min(totalDiscountCents, declaredLineDiscountCents)
        const allocatedLineDiscountCents = allocateCentsWithinCapacities(
            lineDiscountTargetCents,
            orderLines.map((line) => line.lineDiscountCents),
            allocatedGrossCents
        )
        const afterLineCapacities = allocatedGrossCents.map((grossCents, index) => (
            grossCents - allocatedLineDiscountCents[index]
        ))
        const allocatedOrderDiscountCents = allocateCentsWithinCapacities(
            totalDiscountCents - allocatedLineDiscountCents.reduce((sum, value) => sum + value, 0),
            afterLineCapacities,
            afterLineCapacities
        )

        const modernComponents = (order.discountComponents || [])
            .filter((component) => toCents(component.appliedAmount) > 0)

        orderLines.forEach((line, lineIndex) => {
            const rowDiscountCents = allocatedLineDiscountCents[lineIndex] + allocatedOrderDiscountCents[lineIndex]
            const lineComponents = modernComponents
                .filter((component) => {
                    if (component.scope?.toUpperCase() === "ORDER") return true
                    return getProductId(component.productId) === line.productId
                })
                .map((component) => normalizeDiscountComponent(
                    component,
                    toCents(component.appliedAmount),
                    component.scope?.toUpperCase() === "VOLUNTEER" ? "Volontari" : undefined
                ))

            if (lineComponents.length === 0 && line.lineDiscountCents > 0) {
                lineComponents.push(normalizeDiscountComponent(
                    line.item.discountMeta || {},
                    line.lineDiscountCents,
                    order.pricingMode?.toUpperCase() === "VOLUNTEER" ? "Volontari" : undefined
                ))
            }

            const residualOrderDiscountCents = Math.max(0, totalDiscountCents - declaredLineDiscountCents)
            if (modernComponents.length === 0 && residualOrderDiscountCents > 0) {
                lineComponents.push(normalizeDiscountComponent(
                    order.discountMeta || {},
                    residualOrderDiscountCents
                ))
            }
            if (lineComponents.length === 0 && rowDiscountCents > 0) {
                lineComponents.push(normalizeDiscountComponent({}, rowDiscountCents))
            }

            const pricingGroup = buildPricingGroup(lineComponents)
            const resultKey = [
                line.categoryKey ? `key:${line.categoryKey}` : `name:${line.categoryName}`,
                line.productKey,
                pricingGroup.pricingRegime,
                pricingGroup.discountLabel,
                pricingGroup.discountMode,
                pricingGroup.discountValue
            ].join("\u0000")
            const existing = resultByKey.get(resultKey)
            if (existing) {
                existing.quantitySold += line.quantitySold
                existing.grossCents += allocatedGrossCents[lineIndex]
                existing.discountCents += rowDiscountCents
                existing.netCents += allocatedGrossCents[lineIndex] - rowDiscountCents
                return
            }

            resultByKey.set(resultKey, {
                categoryKey: line.categoryKey,
                categoryName: line.categoryName,
                categoryOrder: line.categoryOrder,
                productId: line.productId,
                productKey: line.productKey,
                productName: line.productName,
                displayName: line.displayName,
                ...pricingGroup,
                quantitySold: line.quantitySold,
                grossAmount: 0,
                discountAmount: 0,
                netAmount: 0,
                grossCents: allocatedGrossCents[lineIndex],
                discountCents: rowDiscountCents,
                netCents: allocatedGrossCents[lineIndex] - rowDiscountCents
            })
        })

        const summaryComponents = modernComponents.length > 0
            ? modernComponents.map((component) => normalizeDiscountComponent(
                component,
                toCents(component.appliedAmount),
                component.scope?.toUpperCase() === "VOLUNTEER" ? "Volontari" : undefined
            ))
            : [
                ...orderLines
                    .filter((line) => line.lineDiscountCents > 0)
                    .map((line) => normalizeDiscountComponent(
                        line.item.discountMeta || {},
                        line.lineDiscountCents,
                        order.pricingMode?.toUpperCase() === "VOLUNTEER" ? "Volontari" : undefined
                    )),
                ...(totalDiscountCents > declaredLineDiscountCents
                    ? [normalizeDiscountComponent(
                        order.discountMeta || {},
                        totalDiscountCents - declaredLineDiscountCents
                    )]
                    : [])
            ]

        const knownSummaryCents = summaryComponents.reduce((sum, component) => sum + component.appliedCents, 0)
        if (knownSummaryCents < totalDiscountCents) {
            summaryComponents.push(normalizeDiscountComponent({}, totalDiscountCents - knownSummaryCents))
        }

        summaryComponents.forEach((component) => {
            const summaryKey = [component.label, component.mode, component.value].join("\u0000")
            const existing = discountSummaryByKey.get(summaryKey)
            if (existing) {
                existing.discountCents += component.appliedCents
                existing.orderIndexes.add(orderIndex)
                return
            }
            discountSummaryByKey.set(summaryKey, {
                label: component.label,
                mode: component.mode,
                value: component.value,
                ordersCount: 0,
                discountAmount: 0,
                discountCents: component.appliedCents,
                orderIndexes: new Set([orderIndex])
            })
        })
    })

    const rows = Array.from(resultByKey.values())
        .map((row) => ({
            categoryKey: row.categoryKey,
            categoryName: row.categoryName,
            categoryOrder: row.categoryOrder,
            productId: row.productId,
            productKey: row.productKey,
            productName: row.productName,
            displayName: row.displayName,
            pricingRegime: row.pricingRegime,
            discountLabel: row.discountLabel,
            discountMode: row.discountMode,
            discountValue: row.discountValue,
            groupLabel: row.groupLabel,
            quantitySold: row.quantitySold,
            grossAmount: fromCents(row.grossCents),
            discountAmount: fromCents(row.discountCents),
            netAmount: fromCents(row.netCents)
        }))
        .sort((left, right) => {
            if (left.categoryOrder !== right.categoryOrder) return left.categoryOrder - right.categoryOrder
            const categoryComparison = left.categoryName.localeCompare(right.categoryName, "it")
            if (categoryComparison !== 0) return categoryComparison
            const categoryKeyComparison = productSalesCategoryKey(left).localeCompare(productSalesCategoryKey(right), "it")
            if (categoryKeyComparison !== 0) return categoryKeyComparison
            const productComparison = left.productName.localeCompare(right.productName, "it")
            if (productComparison !== 0) return productComparison
            if (left.pricingRegime !== right.pricingRegime) {
                return left.pricingRegime === "PREZZO PIENO" ? -1 : 1
            }
            return left.discountLabel.localeCompare(right.discountLabel, "it")
        })

    const totals = rows.reduce((result, row) => ({
        quantitySold: result.quantitySold + row.quantitySold,
        grossAmount: Number((result.grossAmount + row.grossAmount).toFixed(2)),
        discountAmount: Number((result.discountAmount + row.discountAmount).toFixed(2)),
        netAmount: Number((result.netAmount + row.netAmount).toFixed(2))
    }), { quantitySold: 0, grossAmount: 0, discountAmount: 0, netAmount: 0 })

    return {
        rows,
        discountSummaries: Array.from(discountSummaryByKey.values())
            .map((summary) => ({
                label: summary.label,
                mode: summary.mode,
                value: summary.value,
                ordersCount: summary.orderIndexes.size,
                discountAmount: fromCents(summary.discountCents)
            }))
            .sort((left, right) => left.label.localeCompare(right.label, "it")),
        totals
    }
}

export function aggregateOrderProductConsumptions(options: {
    orders: ProductConsumptionOrder[]
    catalogByProductId?: Map<string, ProductConsumptionCatalogEntry>
}): ProductConsumptionMetric[] {
    const byProductKey = new Map<string, ProductConsumptionMetric>()

    aggregateOrderProductSales(options).rows.forEach((row) => {
        const existing = byProductKey.get(row.productKey)
        if (existing) {
            existing.quantityConsumed += row.quantitySold
            existing.revenueAmount = Number((existing.revenueAmount + row.netAmount).toFixed(2))
            return
        }
        byProductKey.set(row.productKey, {
            productId: row.productId,
            productKey: row.productKey,
            productName: row.productName,
            quantityConsumed: row.quantitySold,
            revenueAmount: row.netAmount
        })
    })

    return Array.from(byProductKey.values()).sort((left, right) => {
        if (right.quantityConsumed !== left.quantityConsumed) {
            return right.quantityConsumed - left.quantityConsumed
        }
        if (right.revenueAmount !== left.revenueAmount) {
            return right.revenueAmount - left.revenueAmount
        }
        return left.productName.localeCompare(right.productName, "it")
    })
}

export function buildProductSalesExportRows(result: ProductSalesBreakdownResult): ProductSalesExportRow[] {
    const rows: ProductSalesExportRow[] = [["Vendite per categoria - prodotto e regime"], [
        "Tipo riga",
        "Categoria",
        "Prodotto",
        "Descrizione breve",
        "Regime prezzo",
        "Etichetta sconto",
        "Modalità sconto",
        "Valore sconto",
        "Quantità venduta",
        "Lordo",
        "Sconto",
        "Netto"
    ]]
    let currentCategoryKey: string | null = null
    let currentCategoryName: string | null = null
    let categoryRows: ProductSalesBreakdownRow[] = []

    const appendCategoryTotal = () => {
        if (!currentCategoryName) return
        const totals = categoryRows.reduce((sum, row) => ({
            quantity: sum.quantity + row.quantitySold,
            grossCents: sum.grossCents + toCents(row.grossAmount),
            discountCents: sum.discountCents + toCents(row.discountAmount),
            netCents: sum.netCents + toCents(row.netAmount)
        }), { quantity: 0, grossCents: 0, discountCents: 0, netCents: 0 })
        rows.push([
            "TOTALE CATEGORIA", currentCategoryName, "", "", "", "", "", "",
            totals.quantity,
            fromCents(totals.grossCents).toFixed(2),
            fromCents(totals.discountCents).toFixed(2),
            fromCents(totals.netCents).toFixed(2)
        ])
    }

    result.rows.forEach((row) => {
        const categoryKey = productSalesCategoryKey(row)
        if (currentCategoryKey !== categoryKey) {
            appendCategoryTotal()
            currentCategoryKey = categoryKey
            currentCategoryName = row.categoryName
            categoryRows = []
        }
        categoryRows.push(row)
        rows.push([
            "DETTAGLIO",
            row.categoryName,
            row.productName,
            row.displayName,
            row.pricingRegime,
            row.discountLabel,
            row.discountMode,
            row.discountValue,
            row.quantitySold,
            row.grossAmount.toFixed(2),
            row.discountAmount.toFixed(2),
            row.netAmount.toFixed(2)
        ])
    })
    appendCategoryTotal()
    rows.push([
        "TOTALE GENERALE", "", "", "", "", "", "", "",
        result.totals.quantitySold,
        result.totals.grossAmount.toFixed(2),
        result.totals.discountAmount.toFixed(2),
        result.totals.netAmount.toFixed(2)
    ])
    rows.push([], ["Riepilogo componenti sconto"], [
        "Etichetta sconto",
        "Modalità sconto",
        "Valore sconto",
        "Ordini coinvolti",
        "Sconto applicato"
    ])
    if (result.discountSummaries.length === 0) {
        rows.push(["Nessuno", "-", "-", 0, "0.00"])
    } else {
        result.discountSummaries.forEach((summary) => rows.push([
            summary.label,
            summary.mode,
            summary.value,
            summary.ordersCount,
            summary.discountAmount.toFixed(2)
        ]))
    }

    return rows
}

export function buildProductSalesPrintRows(result: ProductSalesBreakdownResult): ProductSalesPrintRow[] {
    return result.rows
        .slice()
        .sort((left, right) => {
            if (left.categoryOrder !== right.categoryOrder) return left.categoryOrder - right.categoryOrder
            const categoryComparison = left.categoryName.localeCompare(right.categoryName, "it")
            if (categoryComparison !== 0) return categoryComparison
            if (left.pricingRegime !== right.pricingRegime) {
                return left.pricingRegime === "PREZZO PIENO" ? -1 : 1
            }
            const groupComparison = left.groupLabel.localeCompare(right.groupLabel, "it")
            if (groupComparison !== 0) return groupComparison
            return left.productName.localeCompare(right.productName, "it")
        })
        .map((row) => ({
            categoryName: row.categoryName,
            name: row.displayName,
            qty: row.quantitySold,
            lineTotal: row.netAmount,
            groupLabel: row.groupLabel,
            grossAmount: row.grossAmount,
            discountAmount: row.discountAmount
        }))
}
