import { beforeEach, describe, expect, test, vi } from "vitest"

const { orderFindMock, orderUpdateOneMock, productFindMock, productUpdateOneMock, ingredientFindMock, ingredientUpdateOneMock } = vi.hoisted(() => ({
    orderFindMock: vi.fn(), orderUpdateOneMock: vi.fn(), productFindMock: vi.fn(), productUpdateOneMock: vi.fn(),
    ingredientFindMock: vi.fn(), ingredientUpdateOneMock: vi.fn()
}))

vi.mock("@/models/Order", () => ({ default: { find: orderFindMock, updateOne: orderUpdateOneMock } }))
vi.mock("@/models/Product", () => ({ default: { find: productFindMock, updateOne: productUpdateOneMock } }))
vi.mock("@/models/Ingredient", () => ({ default: { find: ingredientFindMock, updateOne: ingredientUpdateOneMock } }))

import { transitionCashSessionStock } from "@/lib/cash-session-stock"

function queryResult(value: unknown) {
    return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) }
}

describe("cash session stock transitions", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ingredientFindMock.mockReturnValue(queryResult([]))
        ingredientUpdateOneMock.mockResolvedValue({ modifiedCount: 0 })
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
            if (key && keys.get(id)?.has(key)) return { modifiedCount: 0 }
            if (key) keys.get(id)?.add(key)
            if (typeof update.$inc?.stockQuantity === "number") stocks.set(id, (stocks.get(id) || 0) + update.$inc.stockQuantity)
            return { modifiedCount: 1 }
        })

        await expect(transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "t1", target: "APPLIED" })).rejects.toThrow("crash simulato")
        expect(stocks.get("p1")).toBe(1)
        expect(stocks.get("p2")).toBe(2)

        await expect(transitionCashSessionStock({ eventId: "e1", sessionId: "s1", token: "t1", target: "APPLIED" })).resolves.toMatchObject({ success: true })
        expect(stocks.get("p1")).toBe(1)
        expect(stocks.get("p2")).toBe(1)
        expect(orderUpdateOneMock).toHaveBeenCalledWith(expect.anything(), { $set: { stockEffectStatus: "APPLIED" } })
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
})
