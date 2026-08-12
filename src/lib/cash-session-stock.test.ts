import { beforeEach, describe, expect, test, vi } from "vitest"

const { orderFindMock, orderUpdateOneMock, orderExistsMock, productFindMock, productUpdateOneMock, productExistsMock, ingredientFindMock, ingredientUpdateOneMock, ingredientExistsMock, publishStockInvalidationMock } = vi.hoisted(() => ({
    orderFindMock: vi.fn(), orderUpdateOneMock: vi.fn(), productFindMock: vi.fn(), productUpdateOneMock: vi.fn(),
    orderExistsMock: vi.fn(), productExistsMock: vi.fn(), ingredientFindMock: vi.fn(), ingredientUpdateOneMock: vi.fn(), ingredientExistsMock: vi.fn(),
    publishStockInvalidationMock: vi.fn()
}))

vi.mock("@/models/Order", () => ({ default: { find: orderFindMock, updateOne: orderUpdateOneMock, exists: orderExistsMock } }))
vi.mock("@/models/Product", () => ({ default: { find: productFindMock, updateOne: productUpdateOneMock, exists: productExistsMock } }))
vi.mock("@/models/Ingredient", () => ({ default: { find: ingredientFindMock, updateOne: ingredientUpdateOneMock, exists: ingredientExistsMock } }))
vi.mock("@/lib/pos-stock-realtime", () => ({ publishStockInvalidation: publishStockInvalidationMock }))

import { transitionCashSessionStock, transitionClaimedOrderStock } from "@/lib/cash-session-stock"

function queryResult(value: unknown) {
    return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) }
}

describe("cash session stock transitions", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ingredientFindMock.mockReturnValue(queryResult([]))
        ingredientUpdateOneMock.mockResolvedValue({ modifiedCount: 0 })
        orderUpdateOneMock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        orderExistsMock.mockResolvedValue(null)
        productExistsMock.mockResolvedValue(null)
        ingredientExistsMock.mockResolvedValue(null)
    })

    test("resumes a partial crash without decrementing an already processed adjustment twice", async () => {
        const stocks = new Map([["p1", 2], ["p2", 2]])
        const keys = new Map<string, Set<string>>([["p1", new Set()], ["p2", new Set()]])
        let crashOnce = true
        const order = {
            _id: { toString: () => "o1" },
            stockAdjustments: [
                { entityType: "PRODUCT" as const, entityId: "p1", quantity: 1 },
                { entityType: "PRODUCT" as const, entityId: "p2", quantity: 1 }
            ],
            stockEffectStatus: "REVERTED" as const
        }
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([order]) }) })
        productFindMock.mockImplementation(() => queryResult([...stocks].map(([id, stockQuantity]) => ({ _id: { toString: () => id }, stockQuantity }))))
        productUpdateOneMock.mockImplementation(async (query, update) => {
            const id = String(query._id)
            const key = String(update.$addToSet?.stockOperationKeys || "")
            if (id === "p2" && crashOnce) {
                crashOnce = false
                throw new Error("crash simulato")
            }
            if (key && keys.get(id)?.has(key)) return { matchedCount: 0, modifiedCount: 0 }
            if (key) keys.get(id)?.add(key)
            if (typeof update.$inc?.stockQuantity === "number") stocks.set(id, (stocks.get(id) || 0) + update.$inc.stockQuantity)
            return { matchedCount: 1, modifiedCount: 1 }
        })
        productExistsMock.mockImplementation(async (query) => keys.get(String(query._id))?.has(String(query.stockOperationKeys)) || null)

        await expect(transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "t1", target: "APPLIED" })).rejects.toThrow("crash simulato")
        expect(stocks.get("p1")).toBe(1)
        expect(stocks.get("p2")).toBe(2)

        await expect(transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "t1", target: "APPLIED" })).resolves.toMatchObject({ success: true })
        expect(stocks.get("p1")).toBe(1)
        expect(stocks.get("p2")).toBe(1)
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({ "stockEffectClaim.token": "t1" }),
            { $set: { stockEffectStatus: "APPLIED" }, $unset: { stockEffectClaim: 1 } }
        )
        expect(publishStockInvalidationMock).toHaveBeenCalledOnce()
        expect(publishStockInvalidationMock).toHaveBeenCalledWith("e1")
    })

    test("does not start TEST to normal when aggregate stock is insufficient", async () => {
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{
            _id: { toString: () => "o1" },
            stockAdjustments: [{ entityType: "PRODUCT", entityId: "p1", quantity: 3 }]
        }]) }) })
        productFindMock.mockReturnValue(queryResult([{ _id: { toString: () => "p1" }, stockQuantity: 2 }]))

        const result = await transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "t2", target: "APPLIED" })
        expect(result).toMatchObject({ success: false, error: "Scorte insufficienti", shortages: [{ entityId: "p1", required: 3, available: 2 }] })
        expect(productUpdateOneMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).not.toHaveBeenCalled()
        expect(publishStockInvalidationMock).not.toHaveBeenCalled()
    })

    test("marks legacy cart reconstruction as approximate and uses included menu components", async () => {
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{
            _id: { toString: () => "o1" },
            cart: [{ productId: "menu", snapshotName: "Menu", quantity: 2, includedComponents: [{ productId: "p1", snapshotName: "Panino", quantity: 1 }] }]
        }]) }) })
        productFindMock.mockReturnValue(queryResult([{ _id: { toString: () => "p1" }, stockQuantity: 10 }]))
        productUpdateOneMock.mockResolvedValue({ modifiedCount: 1 })

        const result = await transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "t3", target: "REVERTED" })
        expect(result).toMatchObject({ success: true, approximateOrders: 1 })
        expect(productUpdateOneMock).toHaveBeenCalledWith(expect.objectContaining({ _id: "p1" }), expect.objectContaining({ $inc: { stockQuantity: 2 } }))
    })

    test("treats an explicitly empty adjustment snapshot as exact", async () => {
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{
            _id: { toString: () => "o1" },
            stockAdjustments: [],
            cart: [{ productId: "p1", snapshotName: "Panino", quantity: 2 }]
        }]) }) })

        const result = await transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "t4", target: "REVERTED" })

        expect(result).toMatchObject({ success: true, approximateOrders: 0 })
        expect(productFindMock).not.toHaveBeenCalled()
        expect(productUpdateOneMock).not.toHaveBeenCalled()
    })

    test("does not advance the order when a concurrent stock change rejects the conditional write", async () => {
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{
            _id: { toString: () => "o1" },
            stockAdjustments: [{ entityType: "PRODUCT", entityId: "p1", quantity: 2 }],
            stockEffectStatus: "REVERTED"
        }]) }) })
        productFindMock.mockReturnValue(queryResult([{ _id: { toString: () => "p1" }, name: "Panino", stockQuantity: 2 }]))
        productUpdateOneMock.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
        // the product still exists with a numeric stock: a real conflict, not a deleted/unlimited no-op
        productExistsMock.mockImplementation(async (query) => query.stockQuantity ? { _id: "p1" } : null)

        const result = await transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "race", target: "APPLIED" })

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("Scorte cambiate") })
        expect(orderUpdateOneMock).not.toHaveBeenCalledWith(
            expect.objectContaining({ "stockEffectClaim.token": "race" }),
            expect.objectContaining({ $set: { stockEffectStatus: "APPLIED" } })
        )
    })

    test("does not touch stock when another operation already claimed an order", async () => {
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{
            _id: { toString: () => "o1" },
            stockAdjustments: [{ entityType: "PRODUCT", entityId: "p1", quantity: 1 }]
        }]) }) })
        productFindMock.mockReturnValue(queryResult([{ _id: { toString: () => "p1" }, stockQuantity: 5 }]))
        orderUpdateOneMock.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 })

        const result = await transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "session", target: "REVERTED" })

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("modifica scorte in corso") })
        expect(productUpdateOneMock).not.toHaveBeenCalled()
    })

    test("skips an unlimited product while reverting a session", async () => {
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{
            _id: { toString: () => "o1" },
            stockAdjustments: [{ entityType: "PRODUCT", entityId: "p1", quantity: 1 }]
        }]) }) })
        productFindMock.mockReturnValue(queryResult([{ _id: { toString: () => "p1" }, stockQuantity: null }]))
        productUpdateOneMock.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
        productExistsMock.mockImplementation((query) => query.stockQuantity === null ? { _id: "p1" } : null)

        await expect(transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "unlimited", target: "REVERTED" })).resolves.toMatchObject({ success: true })
    })

    test("skips a deleted product while reverting a session", async () => {
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{
            _id: { toString: () => "o1" },
            stockAdjustments: [{ entityType: "PRODUCT", entityId: "gone", quantity: 1 }]
        }]) }) })
        productFindMock.mockReturnValue(queryResult([]))
        productUpdateOneMock.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
        productExistsMock.mockResolvedValue(null)

        await expect(transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "deleted", target: "REVERTED" })).resolves.toMatchObject({ success: true })
    })

    test("does not require stock already applied by the same retry token", async () => {
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{
            _id: { toString: () => "o1" },
            stockAdjustments: [{ entityType: "PRODUCT", entityId: "p1", quantity: 2 }],
            stockEffectStatus: "REVERTED"
        }]) }) })
        productFindMock.mockReturnValue(queryResult([{
            _id: { toString: () => "p1" },
            name: "Panino",
            stockQuantity: 0,
            stockOperationKeys: ["retry:o1:0"]
        }]))
        productUpdateOneMock.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
        productExistsMock.mockResolvedValue({ _id: "p1" })

        const result = await transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "retry", target: "APPLIED" })

        expect(result).toMatchObject({ success: true })
    })

    test("synchronizes sold-out flags for a direct claimed-order transition", async () => {
        productUpdateOneMock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })

        const result = await transitionClaimedOrderStock({
            eventId: "e1",
            orderId: "o1",
            token: "STORNO",
            target: "APPLIED",
            adjustments: [{ entityType: "PRODUCT", entityId: "p1", quantity: 1 }],
            releaseClaim: false
        })

        expect(result).toEqual({ success: true })
        expect(productUpdateOneMock).toHaveBeenLastCalledWith(
            { eventId: "e1", _id: "p1" },
            [
                { $set: { isSoldOut: { $and: [{ $ne: ["$stockQuantity", null] }, { $lte: ["$stockQuantity", 0] }] } } }
            ],
            { updatePipeline: true }
        )
        expect(publishStockInvalidationMock).toHaveBeenCalledWith("e1")
    })

    test("publishes a completed stock mutation even if order finalization loses its claim", async () => {
        productUpdateOneMock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
        orderUpdateOneMock.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
        orderExistsMock.mockResolvedValue(null)

        const result = await transitionClaimedOrderStock({
            eventId: "e1",
            orderId: "o1",
            token: "STORNO",
            target: "REVERTED",
            adjustments: [{ entityType: "PRODUCT", entityId: "p1", quantity: 1 }],
            releaseClaim: false
        })

        expect(result).toEqual({ success: false, error: "Ordine cambiato durante l'operazione: riprova" })
        expect(publishStockInvalidationMock).toHaveBeenCalledWith("e1")
    })
})
