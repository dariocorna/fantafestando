import { transitionClaimedOrderStock } from "@/lib/cash-session-stock"
import { publishStockInvalidation } from "@/lib/pos-stock-realtime"
import {
    aggregateStockAdjustments,
    syncSoldOutFlags,
    type StockAdjustment
} from "@/lib/stock-operations"
import Ingredient from "@/models/Ingredient"
import Order from "@/models/Order"
import Product from "@/models/Product"

type SumUpOrderStockTransitionResult =
    | { success: true }
    | { success: false; error: string }

async function isSumUpOrderAtTarget(params: {
    eventId: string
    orderId: string
    target: "APPLIED" | "REVERTED"
}) {
    return Boolean(await Order.exists({
        _id: params.orderId,
        eventId: params.eventId,
        status: "PENDING",
        stockEffectStatus: params.target,
        stockEffectClaim: null
    }))
}

async function resumeInterruptedOpposingTransition(params: {
    eventId: string
    orderId: string
    target: "APPLIED" | "REVERTED"
    adjustments: StockAdjustment[]
}) {
    const interrupted = await Order.findOne({
        _id: params.orderId,
        eventId: params.eventId,
        status: "PENDING",
        stockEffectStatus: params.target,
        "stockEffectClaim.target": params.target === "APPLIED" ? "REVERTED" : "APPLIED"
    }).select("stockEffectClaim").lean() as ({
        stockEffectClaim?: { token?: string; target?: "APPLIED" | "REVERTED" }
    } | null)
    const token = interrupted?.stockEffectClaim?.token
    const target = interrupted?.stockEffectClaim?.target
    if (!token || !target) return null

    return transitionClaimedOrderStock({
        eventId: params.eventId,
        orderId: params.orderId,
        token,
        target,
        adjustments: params.adjustments,
        releaseClaim: true
    })
}

async function compensateSumUpOrderStock(params: {
    eventId: string
    orderId: string
    token: string
    target: "APPLIED" | "REVERTED"
    adjustments: StockAdjustment[]
}) {
    const aggregated = aggregateStockAdjustments(params.adjustments)
    let compensated = false
    for (let index = 0; index < aggregated.length; index += 1) {
        const adjustment = aggregated[index]
        const Model = adjustment.entityType === "PRODUCT" ? Product : Ingredient
        const key = `${params.token}:${params.orderId}:${index}`
        const result = await Model.updateOne(
            {
                eventId: params.eventId,
                _id: adjustment.entityId,
                stockOperationKeys: key,
                stockQuantity: params.target === "REVERTED"
                    ? { $gte: adjustment.quantity }
                    : { $type: "number" }
            },
            {
                $inc: {
                    stockQuantity: params.target === "APPLIED"
                        ? adjustment.quantity
                        : -adjustment.quantity
                },
                $pull: { stockOperationKeys: key }
            }
        )
        if ((result.matchedCount ?? result.modifiedCount) === 1) {
            compensated = true
            continue
        }
        const uncompensated = await Model.exists({
            eventId: params.eventId,
            _id: adjustment.entityId,
            stockOperationKeys: key
        })
        if (uncompensated) {
            throw new Error("Scorte cambiate durante il recupero SumUp: correggile e riprova")
        }
    }

    await syncSoldOutFlags(
        params.eventId,
        aggregated.filter((entry) => entry.entityType === "PRODUCT").map((entry) => entry.entityId)
    )
    if (compensated) publishStockInvalidation(params.eventId)

    const source = params.target === "APPLIED" ? "REVERTED" : "APPLIED"
    const released = await Order.updateOne(
        {
            _id: params.orderId,
            eventId: params.eventId,
            status: "PENDING",
            stockEffectStatus: { $ne: params.target },
            "stockEffectClaim.token": params.token,
            "stockEffectClaim.target": params.target
        },
        {
            $set: { stockEffectStatus: source },
            $unset: { stockEffectClaim: 1 }
        }
    )
    if ((released.matchedCount ?? released.modifiedCount) === 1) return

    const alreadyReleased = await Order.exists({
        _id: params.orderId,
        eventId: params.eventId,
        status: "PENDING",
        stockEffectStatus: source,
        stockEffectClaim: null
    })
    if (!alreadyReleased) throw new Error("Impossibile completare il recupero scorte SumUp")
}

export async function transitionSumUpOrderStock(params: {
    eventId: string
    orderId: string
    token: string
    target: "APPLIED" | "REVERTED"
    adjustments: StockAdjustment[]
}): Promise<SumUpOrderStockTransitionResult> {
    const claimed = await Order.updateOne(
        {
            _id: params.orderId,
            eventId: params.eventId,
            status: "PENDING",
            stockEffectStatus: { $ne: params.target },
            $or: [
                { stockEffectClaim: null },
                {
                    "stockEffectClaim.token": params.token,
                    "stockEffectClaim.target": params.target
                }
            ]
        },
        { $set: { stockEffectClaim: { token: params.token, target: params.target } } }
    )
    if ((claimed.matchedCount ?? claimed.modifiedCount) !== 1) {
        if (await isSumUpOrderAtTarget(params)) return { success: true }
        const resumed = await resumeInterruptedOpposingTransition(params)
        if (resumed) {
            if (!resumed.success) return resumed
            return transitionSumUpOrderStock(params)
        }
        return { success: false, error: "Ordine non disponibile o modifica scorte già in corso" }
    }

    let result: Awaited<ReturnType<typeof transitionClaimedOrderStock>>
    try {
        result = await transitionClaimedOrderStock({
            ...params,
            releaseClaim: true
        })
    } catch (error) {
        if (await isSumUpOrderAtTarget(params)) return { success: true }
        await compensateSumUpOrderStock(params)
        throw error
    }
    if (!result.success) await compensateSumUpOrderStock(params)
    return result
}
