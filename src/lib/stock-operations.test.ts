import { beforeEach, describe, expect, test, vi } from "vitest"

const productStore = new Map<string, { _id: string, eventId: string, name: string, stockQuantity: number | null, isSoldOut?: boolean }>()
const ingredientStore = new Map<string, { _id: string, eventId: string, name: string, stockQuantity: number | null }>()

function selectFields<T extends Record<string, unknown>>(doc: T, fields: string) {
    const keys = fields.split(/\s+/).filter(Boolean)
    return keys.reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = doc[key]
        return acc
    }, {})
}

vi.mock("@/models/Product", () => ({
    default: {
        find(query: { eventId: string, _id: { $in: string[] } }) {
            return {
                select(fields: string) {
                    return {
                        lean: async () => query._id.$in
                            .map((id) => productStore.get(id))
                            .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
                            .map((doc) => selectFields(doc, fields))
                    }
                }
            }
        },
        async updateOne(query: { _id: string }, update: { $inc?: { stockQuantity: number }, $set?: { stockQuantity?: number | null, isSoldOut?: boolean } }) {
            const current = productStore.get(query._id)
            if (!current) return { acknowledged: true, matchedCount: 0 }
            if (update.$inc?.stockQuantity) current.stockQuantity = (current.stockQuantity ?? 0) + update.$inc.stockQuantity
            if (update.$set) {
                if (Object.prototype.hasOwnProperty.call(update.$set, "stockQuantity")) current.stockQuantity = update.$set.stockQuantity ?? null
                if (Object.prototype.hasOwnProperty.call(update.$set, "isSoldOut")) current.isSoldOut = Boolean(update.$set.isSoldOut)
            }
            productStore.set(query._id, current)
            return { acknowledged: true, matchedCount: 1 }
        },
        findOneAndUpdate(query: { _id: string, stockQuantity?: { $gte: number } }, update: { $inc: { stockQuantity: number } }) {
            return {
                select(fields: string) {
                    return {
                        lean: async () => {
                            const current = productStore.get(query._id)
                            if (!current) return null
                            if (query.stockQuantity?.$gte !== undefined && (current.stockQuantity ?? 0) < query.stockQuantity.$gte) {
                                return null
                            }
                            current.stockQuantity = (current.stockQuantity ?? 0) + update.$inc.stockQuantity
                            productStore.set(query._id, current)
                            return selectFields(current, fields)
                        }
                    }
                }
            }
        }
    }
}))

vi.mock("@/models/Ingredient", () => ({
    default: {
        find(query: { eventId: string, _id: { $in: string[] } }) {
            return {
                select(fields: string) {
                    return {
                        lean: async () => query._id.$in
                            .map((id) => ingredientStore.get(id))
                            .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
                            .map((doc) => selectFields(doc, fields))
                    }
                }
            }
        },
        async updateOne(query: { _id: string }, update: { $inc?: { stockQuantity: number }, $set?: { stockQuantity?: number | null } }) {
            const current = ingredientStore.get(query._id)
            if (!current) return { acknowledged: true, matchedCount: 0 }
            if (update.$inc?.stockQuantity) current.stockQuantity = (current.stockQuantity ?? 0) + update.$inc.stockQuantity
            if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, "stockQuantity")) {
                current.stockQuantity = update.$set.stockQuantity ?? null
            }
            ingredientStore.set(query._id, current)
            return { acknowledged: true, matchedCount: 1 }
        },
        findOneAndUpdate(query: { _id: string, stockQuantity?: { $gte: number } }, update: { $inc: { stockQuantity: number } }) {
            return {
                select(fields: string) {
                    return {
                        lean: async () => {
                            const current = ingredientStore.get(query._id)
                            if (!current) return null
                            if (query.stockQuantity?.$gte !== undefined && (current.stockQuantity ?? 0) < query.stockQuantity.$gte) {
                                return null
                            }
                            current.stockQuantity = (current.stockQuantity ?? 0) + update.$inc.stockQuantity
                            ingredientStore.set(query._id, current)
                            return selectFields(current, fields)
                        }
                    }
                }
            }
        }
    }
}))

import { applyStockForPaidOrder, rollbackStockAdjustments } from "@/lib/stock-operations"

describe("stock operations", () => {
    beforeEach(() => {
        productStore.clear()
        ingredientStore.clear()
    })

    test("decrements tracked ingredient stock when an order is paid", async () => {
        productStore.set("prod-1", {
            _id: "prod-1",
            eventId: "evt-1",
            name: "Fritto",
            stockQuantity: null,
            isSoldOut: false
        })
        ingredientStore.set("ing-1", {
            _id: "ing-1",
            eventId: "evt-1",
            name: "Patatine",
            stockQuantity: 10
        })

        const result = await applyStockForPaidOrder(
            "evt-1",
            [{
                productId: "prod-1",
                snapshotName: "Fritto",
                quantity: 2
            }],
            "strict",
            [{
                ingredientId: "ing-1",
                quantity: 6
            }]
        )

        expect(result.success).toBe(true)
        expect(ingredientStore.get("ing-1")?.stockQuantity).toBe(4)

        await rollbackStockAdjustments("evt-1", result.appliedAdjustments || [])
        expect(ingredientStore.get("ing-1")?.stockQuantity).toBe(10)
    })

    test("clamps override decrements at zero for tracked ingredients", async () => {
        productStore.set("prod-1", {
            _id: "prod-1",
            eventId: "evt-1",
            name: "Fritto",
            stockQuantity: null,
            isSoldOut: false
        })
        ingredientStore.set("ing-1", {
            _id: "ing-1",
            eventId: "evt-1",
            name: "Patatine",
            stockQuantity: 2
        })

        const result = await applyStockForPaidOrder(
            "evt-1",
            [{
                productId: "prod-1",
                snapshotName: "Fritto",
                quantity: 1
            }],
            "override",
            [{
                ingredientId: "ing-1",
                quantity: 5
            }]
        )

        expect(result.success).toBe(true)
        expect(ingredientStore.get("ing-1")?.stockQuantity).toBe(0)

        await rollbackStockAdjustments("evt-1", result.appliedAdjustments || [])
        expect(ingredientStore.get("ing-1")?.stockQuantity).toBe(2)
    })
})
