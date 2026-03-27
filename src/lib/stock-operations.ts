import Ingredient from "@/models/Ingredient"
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
    entityType: "PRODUCT" | "INGREDIENT"
    entityId: string
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

export function buildIngredientDemandMap(
    ingredientPlan: Array<{ ingredientId?: string, quantity: number }>
): Map<string, number> {
    return aggregateCartQuantities(
        ingredientPlan.flatMap((entry) => {
            const ingredientId = entry.ingredientId?.trim()
            if (!ingredientId) return []
            return [{
                productId: ingredientId,
                quantity: entry.quantity
            }]
        })
    )
}

function normalizeRawTrackedStock(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.floor(value)
        : null
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
    const missing = shortages.filter((entry) => /non trovato$/i.test(entry.productName))
    const stock = shortages.filter((entry) => !/non trovato$/i.test(entry.productName))
    return { missing, stock }
}

export async function loadIngredientStocks(eventId: string, ingredientIds: string[]): Promise<Map<string, ProductStockInfo>> {
    const docs = await Ingredient.find({
        eventId,
        _id: { $in: ingredientIds }
    }).select("_id name stockQuantity").lean() as Array<{
        _id: string | { toString(): string }
        name: string
        stockQuantity?: number | null
    }>

    return new Map(
        docs.map((doc) => [
            doc._id.toString(),
            {
                id: doc._id.toString(),
                name: doc.name,
                stockQuantity: normalizeStockQuantity(doc.stockQuantity ?? null),
                isSoldOut: false
            }
        ])
    )
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
        const entityId = adjustment.entityId?.trim()
        const quantity = Number(adjustment.quantity)
        if (!entityId || !Number.isFinite(quantity) || quantity <= 0) continue
        const aggregationKey = `${adjustment.entityType}:${entityId}`
        totals.set(aggregationKey, (totals.get(aggregationKey) || 0) + quantity)
    }
    return [...totals.entries()].map(([aggregationKey, quantity]) => {
        const [entityType, entityId] = aggregationKey.split(":")
        return {
            entityType: entityType === "INGREDIENT" ? "INGREDIENT" : "PRODUCT",
            entityId,
            quantity
        }
    })
}

export async function rollbackStockAdjustments(eventId: string, adjustments: StockAdjustment[]) {
    const aggregatedAdjustments = aggregateStockAdjustments(adjustments)
    if (aggregatedAdjustments.length === 0) return

    const productAdjustments = aggregatedAdjustments.filter((entry) => entry.entityType === "PRODUCT")
    const ingredientAdjustments = aggregatedAdjustments.filter((entry) => entry.entityType === "INGREDIENT")

    const targetProductIds = productAdjustments.map((entry) => entry.entityId)
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

    const updatedTrackedProductIds: string[] = []
    for (const adjustment of productAdjustments) {
        if (!trackedProductIds.has(adjustment.entityId)) continue
        await Product.updateOne(
            { eventId, _id: adjustment.entityId },
            { $inc: { stockQuantity: adjustment.quantity } }
        )
        updatedTrackedProductIds.push(adjustment.entityId)
    }

    if (ingredientAdjustments.length > 0) {
        const targetIngredientIds = ingredientAdjustments.map((entry) => entry.entityId)
        const currentIngredientStocks = await Ingredient.find({
            eventId,
            _id: { $in: targetIngredientIds }
        }).select("_id stockQuantity").lean() as Array<{
            _id: string | { toString(): string }
            stockQuantity?: number | null
        }>

        const trackedIngredientIds = new Set(
            currentIngredientStocks
                .filter((ingredient) => isStockTracked(normalizeStockQuantity(ingredient.stockQuantity ?? null)))
                .map((ingredient) => ingredient._id.toString())
        )

        for (const adjustment of ingredientAdjustments) {
            if (!trackedIngredientIds.has(adjustment.entityId)) continue
            await Ingredient.updateOne(
                { eventId, _id: adjustment.entityId },
                { $inc: { stockQuantity: adjustment.quantity } }
            )
        }
    }

    if (updatedTrackedProductIds.length > 0) {
        await syncSoldOutFlags(eventId, updatedTrackedProductIds)
    }
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

        applied.push({ entityType: "PRODUCT", entityId: productId, quantity: requestedQuantity })
    }

    await syncSoldOutFlags(eventId, applied.map((entry) => entry.entityId))
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
        const resultStock = normalizeRawTrackedStock(updated.stockQuantity)
        if (resultStock !== null && resultStock < 0) {
            await Product.updateOne(
                { eventId, _id: productId },
                { $set: { stockQuantity: 0 } }
            )
        }

        const appliedQty = Math.min(requestedQuantity, isStockTracked(product.stockQuantity) ? product.stockQuantity : requestedQuantity)
        if (appliedQty > 0) {
            applied.push({ entityType: "PRODUCT", entityId: productId, quantity: appliedQty })
        }
        touched.push(productId)
    }

    await syncSoldOutFlags(eventId, touched)
    return { success: true, appliedAdjustments: applied }
}

async function decrementTrackedIngredientStocksStrict(
    eventId: string,
    demands: Map<string, number>,
    ingredients: Map<string, ProductStockInfo>
): Promise<StockOperationResult> {
    const applied: StockAdjustment[] = []

    for (const [ingredientId, requestedQuantity] of demands.entries()) {
        const ingredient = ingredients.get(ingredientId)
        if (!ingredient || !isStockTracked(ingredient.stockQuantity)) continue

        const updated = await Ingredient.findOneAndUpdate(
            {
                eventId,
                _id: ingredientId,
                stockQuantity: { $gte: requestedQuantity }
            },
            { $inc: { stockQuantity: -requestedQuantity } },
            { new: true }
        ).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

        if (!updated) {
            await rollbackStockAdjustments(eventId, applied)

            const refreshedStocks = await loadIngredientStocks(eventId, [...demands.keys()])
            const refreshedShortages = collectStockShortages(demands, refreshedStocks).map((entry) => ({
                ...entry,
                productName: entry.productName === "Prodotto non trovato" ? "Ingrediente non trovato" : entry.productName
            }))
            return {
                success: false,
                error: "Scorte ingredienti non sufficienti per completare l'operazione",
                stockShortages: refreshedShortages,
                appliedAdjustments: []
            }
        }

        applied.push({ entityType: "INGREDIENT", entityId: ingredientId, quantity: requestedQuantity })
    }

    return { success: true, appliedAdjustments: applied }
}

async function decrementTrackedIngredientStocksOverride(
    eventId: string,
    demands: Map<string, number>,
    ingredients: Map<string, ProductStockInfo>
): Promise<StockOperationResult> {
    const applied: StockAdjustment[] = []

    for (const [ingredientId, requestedQuantity] of demands.entries()) {
        const ingredient = ingredients.get(ingredientId)
        if (!ingredient || !isStockTracked(ingredient.stockQuantity)) continue

        const updated = await Ingredient.findOneAndUpdate(
            { eventId, _id: ingredientId },
            { $inc: { stockQuantity: -requestedQuantity } },
            { new: true }
        ).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

        if (!updated) {
            await rollbackStockAdjustments(eventId, applied)
            return {
                success: false,
                error: "Ingrediente non trovato durante l'aggiornamento scorte",
                stockShortages: [{
                    productId: ingredientId,
                    productName: ingredient.name,
                    requestedQuantity,
                    availableQuantity: 0
                }],
                appliedAdjustments: []
            }
        }

        const resultStock = normalizeRawTrackedStock(updated.stockQuantity)
        if (resultStock !== null && resultStock < 0) {
            await Ingredient.updateOne(
                { eventId, _id: ingredientId },
                { $set: { stockQuantity: 0 } }
            )
        }

        const appliedQty = Math.min(requestedQuantity, isStockTracked(ingredient.stockQuantity) ? ingredient.stockQuantity : requestedQuantity)
        if (appliedQty > 0) {
            applied.push({ entityType: "INGREDIENT", entityId: ingredientId, quantity: appliedQty })
        }
    }

    return { success: true, appliedAdjustments: applied }
}

export async function applyStockForPaidOrder(
    eventId: string,
    cart: OrderCartPayloadItem[],
    mode: StockMode,
    ingredientPlan: Array<{ ingredientId?: string, quantity: number }> = []
): Promise<StockOperationResult> {
    const demands = buildDemandMap(cart)
    const ingredientDemands = buildIngredientDemandMap(ingredientPlan)
    if (demands.size === 0 && ingredientDemands.size === 0) return { success: true }

    const productIds = [...demands.keys()]
    const productStocks = await loadProductStocks(eventId, productIds)
    const ingredientIds = [...ingredientDemands.keys()]
    const ingredientStocks = await loadIngredientStocks(eventId, ingredientIds)
    const shortages = [
        ...collectStockShortages(demands, productStocks),
        ...collectStockShortages(ingredientDemands, ingredientStocks).map((entry) => ({
            ...entry,
            productName: entry.productName === "Prodotto non trovato" ? "Ingrediente non trovato" : entry.productName
        }))
    ]
    const { missing, stock } = splitMissingShortages(shortages)

    if (missing.length > 0) {
        return {
            success: false,
            error: "Alcuni articoli di magazzino non sono più disponibili",
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
        const productResult = await decrementTrackedStocksStrict(eventId, demands, productStocks)
        if (!productResult.success) return productResult

        const ingredientResult = await decrementTrackedIngredientStocksStrict(eventId, ingredientDemands, ingredientStocks)
        if (!ingredientResult.success) {
            await rollbackStockAdjustments(eventId, productResult.appliedAdjustments || [])
            return ingredientResult
        }

        return {
            success: true,
            appliedAdjustments: [
                ...(productResult.appliedAdjustments || []),
                ...(ingredientResult.appliedAdjustments || [])
            ]
        }
    }

    const productResult = await decrementTrackedStocksOverride(eventId, demands, productStocks)
    if (!productResult.success) return productResult

    const ingredientResult = await decrementTrackedIngredientStocksOverride(eventId, ingredientDemands, ingredientStocks)
    if (!ingredientResult.success) {
        await rollbackStockAdjustments(eventId, productResult.appliedAdjustments || [])
        return ingredientResult
    }

    return {
        success: true,
        appliedAdjustments: [
            ...(productResult.appliedAdjustments || []),
            ...(ingredientResult.appliedAdjustments || [])
        ]
    }
}

export async function validateStockForPendingOrder(
    eventId: string,
    cart: OrderCartPayloadItem[],
    mode: StockMode,
    ingredientPlan: Array<{ ingredientId?: string, quantity: number }> = []
): Promise<StockOperationResult> {
    const demands = buildDemandMap(cart)
    const ingredientDemands = buildIngredientDemandMap(ingredientPlan)
    if (demands.size === 0 && ingredientDemands.size === 0) return { success: true }

    const productStocks = demands.size > 0
        ? await loadProductStocks(eventId, [...demands.keys()])
        : new Map<string, ProductStockInfo>()
    const ingredientStocks = ingredientDemands.size > 0
        ? await loadIngredientStocks(eventId, [...ingredientDemands.keys()])
        : new Map<string, ProductStockInfo>()
    const shortages = [
        ...collectStockShortages(demands, productStocks),
        ...collectStockShortages(ingredientDemands, ingredientStocks).map((entry) => ({
            ...entry,
            productName: entry.productName === "Prodotto non trovato" ? "Ingrediente non trovato" : entry.productName
        }))
    ]
    const { missing, stock } = splitMissingShortages(shortages)

    if (missing.length > 0) {
        return {
            success: false,
            error: "Alcuni articoli di magazzino non sono più disponibili",
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
