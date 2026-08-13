import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ingredientExistsMock,
    ingredientUpdateOneMock,
    orderExistsMock,
    orderFindOneMock,
    orderUpdateOneMock,
    productExistsMock,
    productUpdateOneMock,
    publishStockInvalidationMock
} = vi.hoisted(() => ({
    ingredientExistsMock: vi.fn(),
    ingredientUpdateOneMock: vi.fn(),
    orderExistsMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
    productExistsMock: vi.fn(),
    productUpdateOneMock: vi.fn(),
    publishStockInvalidationMock: vi.fn()
}))

vi.mock("@/models/Order", () => ({
    default: { updateOne: orderUpdateOneMock, exists: orderExistsMock, findOne: orderFindOneMock }
}))
vi.mock("@/models/Product", () => ({
    default: { updateOne: productUpdateOneMock, exists: productExistsMock }
}))
vi.mock("@/models/Ingredient", () => ({
    default: { updateOne: ingredientUpdateOneMock, exists: ingredientExistsMock }
}))
vi.mock("@/lib/pos-stock-realtime", () => ({
    publishStockInvalidation: publishStockInvalidationMock
}))

import { transitionSumUpOrderStock } from "@/lib/sumup-order-stock"

type StockTarget = "APPLIED" | "REVERTED"
type OrderState = {
    _id: string
    eventId: string
    status: "PENDING" | "PAID" | "CANCELLED"
    stockEffectStatus: StockTarget
    stockEffectClaim?: { token: string; target: StockTarget }
}

let order: OrderState
let crashOnProductId: string | undefined
const stocks = new Map<string, number>()
const operationKeys = new Map<string, Set<string>>()

describe("SumUp order stock transition", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        order = {
            _id: "o1",
            eventId: "e1",
            status: "PENDING",
            stockEffectStatus: "REVERTED"
        }
        crashOnProductId = undefined
        stocks.clear()
        operationKeys.clear()
        ingredientUpdateOneMock.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
        ingredientExistsMock.mockResolvedValue(null)

        orderUpdateOneMock.mockImplementation(async (rawQuery: unknown, rawUpdate: unknown) => {
            const query = rawQuery as {
                _id?: string
                eventId?: string
                status?: string
                stockEffectStatus?: { $ne?: StockTarget }
                $or?: Array<Record<string, unknown>>
                "stockEffectClaim.token"?: string
                "stockEffectClaim.target"?: StockTarget
            }
            const update = rawUpdate as {
                $set?: {
                    stockEffectClaim?: { token: string; target: StockTarget }
                    stockEffectStatus?: StockTarget
                }
                $unset?: { stockEffectClaim?: number }
            }
            if (query._id !== order._id
                || (query.eventId && query.eventId !== order.eventId)
                || (query.status && query.status !== order.status)
                || (query.stockEffectStatus?.$ne && order.stockEffectStatus === query.stockEffectStatus.$ne)
                || (query["stockEffectClaim.token"] && order.stockEffectClaim?.token !== query["stockEffectClaim.token"])
                || (query["stockEffectClaim.target"] && order.stockEffectClaim?.target !== query["stockEffectClaim.target"])) {
                return { matchedCount: 0, modifiedCount: 0 }
            }

            if (query.$or) {
                const requestedClaim = update.$set?.stockEffectClaim
                const claimAvailable = !order.stockEffectClaim
                    || Boolean(requestedClaim
                        && order.stockEffectClaim.token === requestedClaim.token
                        && order.stockEffectClaim.target === requestedClaim.target)
                if (!claimAvailable) return { matchedCount: 0, modifiedCount: 0 }
            }

            if (update.$set?.stockEffectClaim) order.stockEffectClaim = update.$set.stockEffectClaim
            if (update.$set?.stockEffectStatus) order.stockEffectStatus = update.$set.stockEffectStatus
            if (update.$unset?.stockEffectClaim) delete order.stockEffectClaim
            return { matchedCount: 1, modifiedCount: 1 }
        })
        orderExistsMock.mockImplementation(async (rawQuery: unknown) => {
            const query = rawQuery as {
                _id?: string
                eventId?: string
                status?: string
                stockEffectStatus?: StockTarget
                stockEffectClaim?: null
            }
            return query._id === order._id
                && (!query.eventId || query.eventId === order.eventId)
                && (!query.status || query.status === order.status)
                && (!query.stockEffectStatus || query.stockEffectStatus === order.stockEffectStatus)
                && (query.stockEffectClaim !== null || !order.stockEffectClaim)
                ? { _id: order._id }
                : null
        })
        orderFindOneMock.mockImplementation((rawQuery: unknown) => ({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockImplementation(async () => {
                    const query = rawQuery as {
                        _id?: string
                        eventId?: string
                        status?: string
                        stockEffectStatus?: StockTarget
                        "stockEffectClaim.target"?: StockTarget
                    }
                    return query._id === order._id
                        && query.eventId === order.eventId
                        && query.status === order.status
                        && query.stockEffectStatus === order.stockEffectStatus
                        && query["stockEffectClaim.target"] === order.stockEffectClaim?.target
                        ? { stockEffectClaim: order.stockEffectClaim }
                        : null
                })
            })
        }))

        productUpdateOneMock.mockImplementation(async (rawQuery: unknown, rawUpdate: unknown) => {
            if (Array.isArray(rawUpdate)) return { matchedCount: 1, modifiedCount: 1 }
            const query = rawQuery as {
                _id?: string
                stockQuantity?: { $gte?: number; $type?: string }
                stockOperationKeys?: string | { $ne?: string }
            }
            const update = rawUpdate as {
                $inc?: { stockQuantity?: number }
                $addToSet?: { stockOperationKeys?: string }
                $pull?: { stockOperationKeys?: string }
            }
            const productId = String(query._id)
            const key = update.$addToSet?.stockOperationKeys
            const compensationKey = update.$pull?.stockOperationKeys
            if (productId === crashOnProductId && key) {
                crashOnProductId = undefined
                throw new Error("crash simulato")
            }
            if (compensationKey) {
                if (!operationKeys.get(productId)?.has(compensationKey)
                    || (query.stockQuantity?.$gte !== undefined && (stocks.get(productId) || 0) < query.stockQuantity.$gte)
                    || (query.stockQuantity?.$type === "number" && !stocks.has(productId))) {
                    return { matchedCount: 0, modifiedCount: 0 }
                }
                operationKeys.get(productId)?.delete(compensationKey)
                stocks.set(productId, (stocks.get(productId) || 0) + (update.$inc?.stockQuantity || 0))
                return { matchedCount: 1, modifiedCount: 1 }
            }
            const excludedKey = typeof query.stockOperationKeys === "object"
                ? query.stockOperationKeys.$ne
                : undefined
            if (!stocks.has(productId)
                || (query.stockQuantity?.$gte !== undefined && (stocks.get(productId) || 0) < query.stockQuantity.$gte)
                || (excludedKey && operationKeys.get(productId)?.has(excludedKey))) {
                return { matchedCount: 0, modifiedCount: 0 }
            }
            if (key) operationKeys.get(productId)?.add(key)
            stocks.set(productId, (stocks.get(productId) || 0) + (update.$inc?.stockQuantity || 0))
            return { matchedCount: 1, modifiedCount: 1 }
        })
        productExistsMock.mockImplementation(async (rawQuery: unknown) => {
            const query = rawQuery as {
                _id?: string
                stockOperationKeys?: string
                stockQuantity?: { $type?: string }
            }
            const productId = String(query._id)
            if (query.stockOperationKeys) {
                return operationKeys.get(productId)?.has(query.stockOperationKeys) ? { _id: productId } : null
            }
            return query.stockQuantity?.$type === "number" && stocks.has(productId)
                ? { _id: productId }
                : null
        })
    })

    test("compensates a crash and lets the same token retry from the source state", async () => {
        stocks.set("p1", 2)
        stocks.set("p2", 2)
        operationKeys.set("p1", new Set())
        operationKeys.set("p2", new Set())
        crashOnProductId = "p2"
        const params = {
            eventId: "e1",
            orderId: "o1",
            token: "reserve",
            target: "APPLIED" as const,
            adjustments: [
                { entityType: "PRODUCT" as const, entityId: "p1", quantity: 1 },
                { entityType: "PRODUCT" as const, entityId: "p2", quantity: 1 }
            ]
        }

        await expect(transitionSumUpOrderStock(params)).rejects.toThrow("crash simulato")
        expect(stocks).toEqual(new Map([["p1", 2], ["p2", 2]]))
        expect(operationKeys.get("p1")).toEqual(new Set())
        expect(order.stockEffectStatus).toBe("REVERTED")
        expect(order.stockEffectClaim).toBeUndefined()

        await expect(transitionSumUpOrderStock(params)).resolves.toEqual({ success: true })
        expect(stocks).toEqual(new Map([["p1", 1], ["p2", 1]]))
        expect(operationKeys.get("p1")).toEqual(new Set(["reserve:o1:0"]))
        expect(operationKeys.get("p2")).toEqual(new Set(["reserve:o1:1"]))
        expect(order).toMatchObject({ stockEffectStatus: "APPLIED" })
        expect(order.stockEffectClaim).toBeUndefined()
    })

    test("compensates a returned transition failure before releasing the claim", async () => {
        stocks.set("p1", 2)
        stocks.set("p2", 0)
        operationKeys.set("p1", new Set())
        operationKeys.set("p2", new Set())

        const result = await transitionSumUpOrderStock({
            eventId: "e1",
            orderId: "o1",
            token: "reserve",
            target: "APPLIED",
            adjustments: [
                { entityType: "PRODUCT", entityId: "p1", quantity: 1 },
                { entityType: "PRODUCT", entityId: "p2", quantity: 1 }
            ]
        })

        expect(result).toEqual({ success: false, error: "Scorte cambiate durante l'operazione: correggile e riprova" })
        expect(stocks).toEqual(new Map([["p1", 2], ["p2", 0]]))
        expect(operationKeys.get("p1")).toEqual(new Set())
        expect(order.stockEffectStatus).toBe("REVERTED")
        expect(order.stockEffectClaim).toBeUndefined()
    })

    test("compensates a failed REVERTED transition with the inverse delta", async () => {
        order.stockEffectStatus = "APPLIED"
        stocks.set("p1", 1)
        stocks.set("p2", 1)
        operationKeys.set("p1", new Set())
        operationKeys.set("p2", new Set())
        crashOnProductId = "p2"

        await expect(transitionSumUpOrderStock({
            eventId: "e1",
            orderId: "o1",
            token: "release",
            target: "REVERTED",
            adjustments: [
                { entityType: "PRODUCT", entityId: "p1", quantity: 1 },
                { entityType: "PRODUCT", entityId: "p2", quantity: 1 }
            ]
        })).rejects.toThrow("crash simulato")

        expect(stocks).toEqual(new Map([["p1", 1], ["p2", 1]]))
        expect(operationKeys.get("p1")).toEqual(new Set())
        expect(order.stockEffectStatus).toBe("APPLIED")
        expect(order.stockEffectClaim).toBeUndefined()
    })

    test("does not touch stock claimed by a concurrent transition", async () => {
        order.stockEffectClaim = { token: "other", target: "APPLIED" }
        stocks.set("p1", 2)
        operationKeys.set("p1", new Set())

        const result = await transitionSumUpOrderStock({
            eventId: "e1",
            orderId: "o1",
            token: "reserve",
            target: "APPLIED",
            adjustments: [{ entityType: "PRODUCT", entityId: "p1", quantity: 1 }]
        })

        expect(result).toEqual({ success: false, error: "Ordine non disponibile o modifica scorte già in corso" })
        expect(stocks.get("p1")).toBe(2)
        expect(productUpdateOneMock).not.toHaveBeenCalled()
    })

    test("treats an order already at the target as successful", async () => {
        order.stockEffectStatus = "APPLIED"

        const result = await transitionSumUpOrderStock({
            eventId: "e1",
            orderId: "o1",
            token: "reserve",
            target: "APPLIED",
            adjustments: []
        })

        expect(result).toEqual({ success: true })
        expect(productUpdateOneMock).not.toHaveBeenCalled()
    })

    test("finishes an interrupted reservation before reverting its partial stock writes", async () => {
        order.stockEffectClaim = { token: "interrupted-reserve", target: "APPLIED" }
        stocks.set("p1", 1)
        stocks.set("p2", 2)
        operationKeys.set("p1", new Set(["interrupted-reserve:o1:0"]))
        operationKeys.set("p2", new Set())

        const result = await transitionSumUpOrderStock({
            eventId: "e1",
            orderId: "o1",
            token: "recovery-release",
            target: "REVERTED",
            adjustments: [
                { entityType: "PRODUCT", entityId: "p1", quantity: 1 },
                { entityType: "PRODUCT", entityId: "p2", quantity: 1 }
            ]
        })

        expect(result).toEqual({ success: true })
        expect(stocks).toEqual(new Map([["p1", 2], ["p2", 2]]))
        expect(operationKeys.get("p1")).toEqual(new Set([
            "interrupted-reserve:o1:0",
            "recovery-release:o1:0"
        ]))
        expect(operationKeys.get("p2")).toEqual(new Set([
            "interrupted-reserve:o1:1",
            "recovery-release:o1:1"
        ]))
        expect(order).toMatchObject({ stockEffectStatus: "REVERTED" })
        expect(order.stockEffectClaim).toBeUndefined()
    })
})
