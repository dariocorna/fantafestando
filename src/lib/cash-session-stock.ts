import Ingredient from "@/models/Ingredient"
import Order from "@/models/Order"
import Product from "@/models/Product"
import { aggregateStockAdjustments, buildDemandMap, type StockAdjustment } from "@/lib/stock-operations"

type SessionOrder = {
    _id: { toString(): string }
    stockAdjustments?: Array<{ entityType: "PRODUCT" | "INGREDIENT"; entityId: { toString(): string } | string; quantity: number }>
    stockEffectStatus?: "APPLIED" | "REVERTED"
    cart?: Array<{
        productId: { toString(): string } | string
        snapshotName: string
        quantity: number
        includedComponents?: Array<{ productId: { toString(): string } | string; snapshotName: string; quantity: number }>
    }>
    ingredientPlan?: Array<{ ingredientId?: { toString(): string } | string; quantity: number }>
}

type TransitionResult =
    | { success: true }
    | { success: false; error: string }

function adjustmentsForOrder(order: SessionOrder): { adjustments: StockAdjustment[]; approximate: boolean } {
    if (Array.isArray(order.stockAdjustments)) {
        return {
            adjustments: order.stockAdjustments.map((entry) => ({ ...entry, entityId: entry.entityId.toString() })),
            approximate: false
        }
    }
    const productDemand = buildDemandMap((order.cart || []).map((item) => ({
        ...item,
        productId: item.productId.toString(),
        includedComponents: item.includedComponents?.map((entry) => ({ ...entry, productId: entry.productId.toString() }))
    })))
    return {
        adjustments: [
            ...[...productDemand].map(([entityId, quantity]) => ({ entityType: "PRODUCT" as const, entityId, quantity })),
            ...(order.ingredientPlan || []).flatMap((entry) => entry.ingredientId
                ? [{ entityType: "INGREDIENT" as const, entityId: entry.ingredientId.toString(), quantity: entry.quantity }]
                : [])
        ],
        approximate: true
    }
}

export async function transitionCashSessionStock(params: {
    eventId: string
    sessionId: string
    token: string
    target: "APPLIED" | "REVERTED"
}) {
    const source = params.target === "APPLIED" ? "REVERTED" : "APPLIED"
    const orders = await Order.find({ cashSessionId: params.sessionId, status: "PAID", stockEffectStatus: { $ne: params.target } })
        .select("_id cart ingredientPlan stockAdjustments stockEffectStatus")
        .lean() as SessionOrder[]
    const plans = orders.map((order) => ({ order, ...adjustmentsForOrder(order) }))
    const total = aggregateStockAdjustments(plans.flatMap((plan) => plan.adjustments))

    if (params.target === "APPLIED") {
        const shortages: Array<{ entityType: string; entityId: string; entityName: string; required: number; available: number }> = []
        for (const entityType of ["PRODUCT", "INGREDIENT"] as const) {
            const Model = entityType === "PRODUCT" ? Product : Ingredient
            const demands = plans.flatMap(({ order, adjustments }) => aggregateStockAdjustments(adjustments)
                .map((entry, index) => ({ ...entry, key: `${params.token}:${order._id.toString()}:${index}` }))
                .filter((entry) => entry.entityType === entityType))
            const docs = await Model.find({ eventId: params.eventId, _id: { $in: demands.map((entry) => entry.entityId) } })
                .select("_id name stockQuantity stockOperationKeys").lean() as Array<{ _id: { toString(): string }; name?: string; stockQuantity?: number | null; stockOperationKeys?: string[] }>
            const stocks = new Map(docs.map((doc) => [doc._id.toString(), { name: doc.name || doc._id.toString(), quantity: doc.stockQuantity, operationKeys: doc.stockOperationKeys || [] }]))
            for (const demand of aggregateStockAdjustments(demands.filter((entry) => !stocks.get(entry.entityId)?.operationKeys.includes(entry.key)))) {
                const stock = stocks.get(demand.entityId)
                if (typeof stock?.quantity === "number" && stock.quantity < demand.quantity) shortages.push({ ...demand, entityName: stock.name, required: demand.quantity, available: stock.quantity })
            }
        }
        if (shortages.length) return { success: false as const, error: "Scorte insufficienti", shortages }
    }

    for (const { order } of plans) {
        const claimed = await Order.updateOne(
            {
                _id: order._id,
                status: "PAID",
                stockEffectStatus: { $ne: params.target },
                $or: [
                    { stockEffectClaim: { $exists: false } },
                    { stockEffectClaim: null },
                    { "stockEffectClaim.token": params.token, "stockEffectClaim.target": params.target }
                ]
            },
            { $set: { stockEffectClaim: { token: params.token, target: params.target } } }
        )
        if ((claimed.matchedCount ?? claimed.modifiedCount) !== 1) {
            return { success: false as const, error: "Un ordine della sessione ha già una modifica scorte in corso" }
        }
    }

    for (const { order, adjustments } of plans) {
        const result = await transitionClaimedOrderStock({
            eventId: params.eventId,
            orderId: order._id.toString(),
            token: params.token,
            target: params.target,
            adjustments,
            releaseClaim: true
        })
        if (!result.success) return result
    }

    const productIds = total.filter((entry) => entry.entityType === "PRODUCT").map((entry) => entry.entityId)
    if (productIds.length) {
        const products = await Product.find({ eventId: params.eventId, _id: { $in: productIds } }).select("_id stockQuantity").lean() as Array<{ _id: { toString(): string }; stockQuantity?: number | null }>
        for (const product of products) {
            await Product.updateOne({ _id: product._id }, { $set: { isSoldOut: typeof product.stockQuantity === "number" && product.stockQuantity <= 0 } })
        }
    }
    return { success: true as const, approximateOrders: plans.filter((plan) => plan.approximate).length, source }
}

export async function transitionClaimedOrderStock(params: {
    eventId: string
    orderId: string
    token: string
    target: "APPLIED" | "REVERTED"
    adjustments: StockAdjustment[]
    releaseClaim: boolean
}): Promise<TransitionResult> {
    const aggregated = aggregateStockAdjustments(params.adjustments)
    for (let index = 0; index < aggregated.length; index += 1) {
        const adjustment = aggregated[index]
        const Model = adjustment.entityType === "PRODUCT" ? Product : Ingredient
        const key = `${params.token}:${params.orderId}:${index}`
        const delta = params.target === "APPLIED" ? -adjustment.quantity : adjustment.quantity
        const result = await Model.updateOne(
            {
                eventId: params.eventId,
                _id: adjustment.entityId,
                stockQuantity: params.target === "APPLIED" ? { $gte: adjustment.quantity } : { $ne: null },
                stockOperationKeys: { $ne: key }
            },
            { $inc: { stockQuantity: delta }, $addToSet: { stockOperationKeys: key } }
        )
        if ((result.matchedCount ?? result.modifiedCount) !== 1) {
            const alreadyApplied = await Model.exists({ eventId: params.eventId, _id: adjustment.entityId, stockOperationKeys: key })
            const unlimited = await Model.exists({ eventId: params.eventId, _id: adjustment.entityId, stockQuantity: null })
            if (!alreadyApplied && !unlimited) return { success: false, error: "Scorte cambiate durante l'operazione: correggile e riprova" }
        }
    }

    const finalized = await Order.updateOne(
        {
            _id: params.orderId,
            stockEffectStatus: { $ne: params.target },
            "stockEffectClaim.token": params.token,
            "stockEffectClaim.target": params.target
        },
        {
            $set: { stockEffectStatus: params.target },
            ...(params.releaseClaim ? { $unset: { stockEffectClaim: 1 } } : {})
        }
    )
    if ((finalized.matchedCount ?? finalized.modifiedCount) !== 1) {
        const alreadyFinalized = await Order.exists({ _id: params.orderId, stockEffectStatus: params.target })
        if (!alreadyFinalized) return { success: false, error: "Ordine cambiato durante l'operazione: riprova" }
    }
    return { success: true }
}
