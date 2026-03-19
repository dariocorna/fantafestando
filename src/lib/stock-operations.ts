import Product from "@/models/Product"
import {
    aggregateCartQuantities,
    collectStockShortages,
    isStockTracked,
    normalizeStockQuantity,
    type CartStockItem,
    type ProductStockInfo,
    type StockMode,
    type StockShortage
} from "@/lib/inventory"

export interface OrderCartPayloadItem {
    productId: string
    snapshotName: string
    quantity: number
    selectedOptions?: Array<{ name: string, priceVariation: number }>
    includedComponents?: Array<{
        productId: string
        snapshotName: string
        quantity: number
    }>
}

export interface StockAdjustment {
    productId: string
    quantity: number
}

export interface StockOperationResult {
    success: boolean
    error?: string
    stockShortages?: StockShortage[]
    appliedAdjustments?: StockAdjustment[]
}

export function buildDemandMap(cart: OrderCartPayloadItem[]): Map<string, number> {
    const demandItems: CartStockItem[] = cart.flatMap((item) => {
        if (Array.isArray(item.includedComponents) && item.includedComponents.length > 0) {
            return item.includedComponents.map((component) => ({
                productId: component.productId,
                quantity: component.quantity * item.quantity,
                snapshotName: component.snapshotName
            }))
        }

        return [{
            productId: item.productId,
            quantity: item.quantity,
            snapshotName: item.snapshotName
        }]
    })
    return aggregateCartQuantities(demandItems)
}

export async function loadProductStocks(eventId: string, productIds: string[]): Promise<Map<string, ProductStockInfo>> {
    const docs = await Product.find({
        eventId,
        _id: { $in: productIds }
    }).select("_id name stockQuantity isSoldOut").lean() as Array<{
        _id: string | { toString(): string }
        name: string
        stockQuantity?: number | null
        isSoldOut?: boolean
    }>

    return new Map(
        docs.map((doc) => [
            doc._id.toString(),
            {
                id: doc._id.toString(),
                name: doc.name,
                stockQuantity: normalizeStockQuantity(doc.stockQuantity ?? null),
                isSoldOut: Boolean(doc.isSoldOut)
            }
        ])
    )
}

export function splitMissingShortages(shortages: StockShortage[]) {
    const missing = shortages.filter((entry) => entry.productName === "Prodotto non trovato")
    const stock = shortages.filter((entry) => entry.productName !== "Prodotto non trovato")
    return { missing, stock }
}

export async function syncSoldOutFlags(eventId: string, productIds: string[]) {
    const uniqueProductIds = [...new Set(productIds)]
    if (uniqueProductIds.length === 0) return

    const docs = await Product.find({
        eventId,
        _id: { $in: uniqueProductIds }
    }).select("_id stockQuantity").lean() as Array<{ _id: string | { toString(): string }, stockQuantity?: number | null }>

    for (const doc of docs) {
        const normalizedStock = normalizeStockQuantity(doc.stockQuantity ?? null)
        await Product.updateOne(
            { eventId, _id: doc._id.toString() },
            {
                $set: {
                    stockQuantity: normalizedStock,
                    isSoldOut: normalizedStock !== null ? normalizedStock <= 0 : false
                }
            }
        )
    }
}

export function aggregateStockAdjustments(adjustments: StockAdjustment[]): StockAdjustment[] {
    const totals = new Map<string, number>()
    for (const adjustment of adjustments) {
        const productId = adjustment.productId?.trim()
        const quantity = Number(adjustment.quantity)
        if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue
        totals.set(productId, (totals.get(productId) || 0) + quantity)
    }
    return [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity }))
}

export async function rollbackStockAdjustments(eventId: string, adjustments: StockAdjustment[]) {
    const aggregatedAdjustments = aggregateStockAdjustments(adjustments)
    if (aggregatedAdjustments.length === 0) return

    const targetProductIds = aggregatedAdjustments.map((entry) => entry.productId)
    const currentStocks = await Product.find({
        eventId,
        _id: { $in: targetProductIds }
    }).select("_id stockQuantity").lean() as Array<{
        _id: string | { toString(): string }
        stockQuantity?: number | null
    }>

    const trackedProductIds = new Set(
        currentStocks
            .filter((product) => isStockTracked(normalizeStockQuantity(product.stockQuantity ?? null)))
            .map((product) => product._id.toString())
    )

    if (trackedProductIds.size === 0) return

    const updatedTrackedProductIds: string[] = []
    for (const adjustment of aggregatedAdjustments) {
        if (!trackedProductIds.has(adjustment.productId)) continue
        await Product.updateOne(
            { eventId, _id: adjustment.productId },
            { $inc: { stockQuantity: adjustment.quantity } }
        )
        updatedTrackedProductIds.push(adjustment.productId)
    }

    await syncSoldOutFlags(eventId, updatedTrackedProductIds)
}

async function decrementTrackedStocksStrict(
    eventId: string,
    demands: Map<string, number>,
    products: Map<string, ProductStockInfo>
): Promise<StockOperationResult> {
    const applied: StockAdjustment[] = []

    for (const [productId, requestedQuantity] of demands.entries()) {
        const product = products.get(productId)
        if (!product || !isStockTracked(product.stockQuantity)) continue

        const updated = await Product.findOneAndUpdate(
            {
                eventId,
                _id: productId,
                stockQuantity: { $gte: requestedQuantity }
            },
            { $inc: { stockQuantity: -requestedQuantity } },
            { new: true }
        ).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

        if (!updated) {
            await rollbackStockAdjustments(eventId, applied)

            const refreshedStocks = await loadProductStocks(eventId, [...demands.keys()])
            const refreshedShortages = collectStockShortages(demands, refreshedStocks)
            return {
                success: false,
                error: "Scorte non sufficienti per completare l'operazione",
                stockShortages: refreshedShortages,
                appliedAdjustments: []
            }
        }

        applied.push({ productId, quantity: requestedQuantity })
    }

    await syncSoldOutFlags(eventId, applied.map((entry) => entry.productId))
    return { success: true, appliedAdjustments: applied }
}

/**
 * Override mode: uses atomic $inc to avoid race conditions between concurrent orders.
 * The stock is decremented atomically and then clamped to 0 if negative.
 */
async function decrementTrackedStocksOverride(
    eventId: string,
    demands: Map<string, number>,
    products: Map<string, ProductStockInfo>
): Promise<StockOperationResult> {
    const touched: string[] = []
    const applied: StockAdjustment[] = []

    for (const [productId, requestedQuantity] of demands.entries()) {
        const product = products.get(productId)
        if (!product || !isStockTracked(product.stockQuantity)) continue

        // Atomic decrement — avoids race conditions between concurrent orders
        const updated = await Product.findOneAndUpdate(
            { eventId, _id: productId },
            { $inc: { stockQuantity: -requestedQuantity } },
            { new: true }
        ).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

        if (!updated) {
            await rollbackStockAdjustments(eventId, applied)
            return {
                success: false,
                error: "Prodotto non trovato durante l'aggiornamento scorte",
                stockShortages: [{
                    productId,
                    productName: product.name,
                    requestedQuantity,
                    availableQuantity: 0
                }],
                appliedAdjustments: []
            }
        }

        // Clamp to 0 if stock went negative
        const resultStock = normalizeStockQuantity(updated.stockQuantity ?? null)
        if (isStockTracked(resultStock) && resultStock < 0) {
            await Product.updateOne(
                { eventId, _id: productId },
                { $set: { stockQuantity: 0 } }
            )
        }

        const appliedQty = Math.min(requestedQuantity, isStockTracked(product.stockQuantity) ? product.stockQuantity : requestedQuantity)
        if (appliedQty > 0) {
            applied.push({ productId, quantity: appliedQty })
        }
        touched.push(productId)
    }

    await syncSoldOutFlags(eventId, touched)
    return { success: true, appliedAdjustments: applied }
}

export async function applyStockForPaidOrder(
    eventId: string,
    cart: OrderCartPayloadItem[],
    mode: StockMode
): Promise<StockOperationResult> {
    const demands = buildDemandMap(cart)
    if (demands.size === 0) return { success: true }

    const productIds = [...demands.keys()]
    const productStocks = await loadProductStocks(eventId, productIds)
    const shortages = collectStockShortages(demands, productStocks)
    const { missing, stock } = splitMissingShortages(shortages)

    if (missing.length > 0) {
        return {
            success: false,
            error: "Alcuni prodotti non sono più disponibili",
            stockShortages: shortages
        }
    }

    if (mode === "strict" && stock.length > 0) {
        return {
            success: false,
            error: "Scorte non sufficienti per completare l'operazione",
            stockShortages: stock
        }
    }

    if (mode === "strict") {
        return decrementTrackedStocksStrict(eventId, demands, productStocks)
    }

    return decrementTrackedStocksOverride(eventId, demands, productStocks)
}

export async function validateStockForPendingOrder(
    eventId: string,
    cart: OrderCartPayloadItem[],
    mode: StockMode
): Promise<StockOperationResult> {
    const demands = buildDemandMap(cart)
    if (demands.size === 0) return { success: true }

    const productStocks = await loadProductStocks(eventId, [...demands.keys()])
    const shortages = collectStockShortages(demands, productStocks)
    const { missing, stock } = splitMissingShortages(shortages)

    if (missing.length > 0) {
        return {
            success: false,
            error: "Alcuni prodotti non sono più disponibili",
            stockShortages: shortages
        }
    }

    if (mode === "strict" && stock.length > 0) {
        return {
            success: false,
            error: "Scorte non sufficienti per completare l'operazione",
            stockShortages: stock
        }
    }

    return { success: true }
}
