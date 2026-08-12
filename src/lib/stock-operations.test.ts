import { beforeEach, describe, expect, test, vi } from "vitest"

const productStore = new Map<string, { _id: string, eventId: string, name: string, stockQuantity: number | null, isSoldOut?: boolean }>()
const ingredientStore = new Map<string, { _id: string, eventId: string, name: string, stockQuantity: number | null }>()
let beforeProductAtomicUpdate: (() => void) | undefined
let beforeProductUpdateOne: (() => void) | undefined

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
        async updateOne(
            query: { _id: string, stockQuantity?: number },
            update: { $inc?: { stockQuantity: number }, $set?: { stockQuantity?: number | null, isSoldOut?: boolean } }
            | Array<{ $set?: { isSoldOut?: unknown } }>,
            options?: { updatePipeline?: boolean }
        ) {
            if (Array.isArray(update) && options?.updatePipeline !== true) {
                throw new Error("updatePipeline option is required")
            }
            beforeProductUpdateOne?.()
            beforeProductUpdateOne = undefined
            const current = productStore.get(query._id)
            if (!current) return { acknowledged: true, matchedCount: 0 }
            if (typeof query.stockQuantity === "number" && current.stockQuantity !== query.stockQuantity) return { acknowledged: true, matchedCount: 0 }
            if (Array.isArray(update)) {
                for (const stage of update) {
                    if (stage.$set && Object.prototype.hasOwnProperty.call(stage.$set, "isSoldOut")) {
                        current.isSoldOut = current.stockQuantity !== null && current.stockQuantity <= 0
                    }
                }
            } else {
                if (update.$inc?.stockQuantity) current.stockQuantity = (current.stockQuantity ?? 0) + update.$inc.stockQuantity
                if (update.$set) {
                    if (Object.prototype.hasOwnProperty.call(update.$set, "stockQuantity")) current.stockQuantity = update.$set.stockQuantity ?? null
                    if (Object.prototype.hasOwnProperty.call(update.$set, "isSoldOut")) current.isSoldOut = Boolean(update.$set.isSoldOut)
                }
            }
            productStore.set(query._id, current)
            return { acknowledged: true, matchedCount: 1 }
        },
        findOneAndUpdate(query: { _id: string, stockQuantity?: { $gte: number } }, update: { $inc: { stockQuantity: number } }, options?: { returnDocument?: "before" | "after" }) {
            return {
                select(fields: string) {
                    return {
                        lean: async () => {
                            beforeProductAtomicUpdate?.()
                            beforeProductAtomicUpdate = undefined
                            const current = productStore.get(query._id)
                            if (!current) return null
                            if (query.stockQuantity?.$gte !== undefined && (current.stockQuantity ?? 0) < query.stockQuantity.$gte) {
                                return null
                            }
                            const before = { ...current }
                            current.stockQuantity = (current.stockQuantity ?? 0) + update.$inc.stockQuantity
                            productStore.set(query._id, current)
                            return selectFields(options?.returnDocument === "before" ? before : current, fields)
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
        async updateOne(query: { _id: string, stockQuantity?: number }, update: { $inc?: { stockQuantity: number }, $set?: { stockQuantity?: number | null } }) {
            const current = ingredientStore.get(query._id)
            if (!current) return { acknowledged: true, matchedCount: 0 }
            if (typeof query.stockQuantity === "number" && current.stockQuantity !== query.stockQuantity) return { acknowledged: true, matchedCount: 0 }
            if (update.$inc?.stockQuantity) current.stockQuantity = (current.stockQuantity ?? 0) + update.$inc.stockQuantity
            if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, "stockQuantity")) {
                current.stockQuantity = update.$set.stockQuantity ?? null
            }
            ingredientStore.set(query._id, current)
            return { acknowledged: true, matchedCount: 1 }
        },
        findOneAndUpdate(query: { _id: string, stockQuantity?: { $gte: number } }, update: { $inc: { stockQuantity: number } }, options?: { returnDocument?: "before" | "after" }) {
            return {
                select(fields: string) {
                    return {
                        lean: async () => {
                            const current = ingredientStore.get(query._id)
                            if (!current) return null
                            if (query.stockQuantity?.$gte !== undefined && (current.stockQuantity ?? 0) < query.stockQuantity.$gte) {
                                return null
                            }
                            const before = { ...current }
                            current.stockQuantity = (current.stockQuantity ?? 0) + update.$inc.stockQuantity
                            ingredientStore.set(query._id, current)
                            return selectFields(options?.returnDocument === "before" ? before : current, fields)
                        }
                    }
                }
            }
        }
    }
}))

import { aggregateStockAdjustments, applyStockForPaidOrder, rollbackStockAdjustments, syncSoldOutFlags, validateStockForPendingOrder } from "@/lib/stock-operations"

describe("stock operations", () => {
    beforeEach(() => {
        productStore.clear()
        ingredientStore.clear()
        beforeProductAtomicUpdate = undefined
        beforeProductUpdateOne = undefined
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

    test("snapshots the stock actually removed by an override after a concurrent edit", async () => {
        productStore.set("prod-1", {
            _id: "prod-1",
            eventId: "evt-1",
            name: "Panino",
            stockQuantity: 5,
            isSoldOut: false
        })
        beforeProductAtomicUpdate = () => {
            productStore.get("prod-1")!.stockQuantity = 2
        }

        const result = await applyStockForPaidOrder(
            "evt-1",
            [{ productId: "prod-1", snapshotName: "Panino", quantity: 4 }],
            "override",
            []
        )

        expect(result.appliedAdjustments).toEqual([{ entityType: "PRODUCT", entityId: "prod-1", quantity: 2 }])
        expect(productStore.get("prod-1")?.stockQuantity).toBe(0)
        await rollbackStockAdjustments("evt-1", result.appliedAdjustments || [])
        expect(productStore.get("prod-1")?.stockQuantity).toBe(2)
    })

    test("syncs sold-out flags without overwriting a concurrent stock transition", async () => {
        productStore.set("prod-1", {
            _id: "prod-1",
            eventId: "evt-1",
            name: "Panino",
            stockQuantity: 5,
            isSoldOut: false
        })
        beforeProductUpdateOne = () => {
            productStore.get("prod-1")!.stockQuantity = 0
        }

        await syncSoldOutFlags("evt-1", ["prod-1"])

        expect(productStore.get("prod-1")).toMatchObject({
            stockQuantity: 0,
            isSoldOut: true
        })
    })

    test("rejects pending orders when tracked ingredient stock is insufficient", async () => {
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
            stockQuantity: 1
        })

        const result = await validateStockForPendingOrder(
            "evt-1",
            [{
                productId: "prod-1",
                snapshotName: "Fritto",
                quantity: 1
            }],
            "strict",
            [{
                ingredientId: "ing-1",
                quantity: 2
            }]
        )

        expect(result.success).toBe(false)
        expect(result.error).toBe("Scorte non sufficienti per completare l'operazione")
        expect(result.stockShortages).toEqual([{
            productId: "ing-1",
            productName: "Patatine",
            requestedQuantity: 2,
            availableQuantity: 1
        }])
        expect(ingredientStore.get("ing-1")?.stockQuantity).toBe(1)
    })
})

describe("aggregateStockAdjustments", () => {
    test("accepts persisted ObjectId entity ids instead of throwing", () => {
        // lean documents keep entityId as ObjectId: storno passes those straight through
        const objectId = { toString: () => "507f1f77bcf86cd799439011" }
        const result = aggregateStockAdjustments([
            { entityType: "PRODUCT", entityId: objectId as unknown as string, quantity: 2 },
            { entityType: "PRODUCT", entityId: objectId as unknown as string, quantity: 3 }
        ])

        expect(result).toEqual([{ entityType: "PRODUCT", entityId: "507f1f77bcf86cd799439011", quantity: 5 }])
    })

    test("drops entries without a usable entity id", () => {
        expect(aggregateStockAdjustments([
            { entityType: "PRODUCT", entityId: undefined as unknown as string, quantity: 1 },
            { entityType: "PRODUCT", entityId: "  " as unknown as string, quantity: 1 }
        ])).toEqual([])
    })
})
