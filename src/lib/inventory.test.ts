import { describe, expect, it } from "vitest"
import {
    aggregateCartQuantities,
    applyStockDecrement,
    collectStockShortages,
    getStockLabel,
    getStockStatus,
    parseStockQuantityInput
} from "./inventory"

describe("inventory helpers", () => {
    it("parses stock input with unlimited fallback", () => {
        expect(parseStockQuantityInput(null)).toBeNull()
        expect(parseStockQuantityInput("")).toBeNull()
        expect(parseStockQuantityInput("  ")).toBeNull()
        expect(parseStockQuantityInput("12")).toBe(12)
        expect(parseStockQuantityInput("-4")).toBe(0)
        expect(parseStockQuantityInput("abc")).toBeNull()
    })

    it("computes stock status and labels", () => {
        expect(getStockStatus(null, false)).toBe("UNLIMITED")
        expect(getStockStatus(10, false)).toBe("OK")
        expect(getStockStatus(3, false)).toBe("LOW")
        expect(getStockStatus(0, false)).toBe("OUT")
        expect(getStockStatus(10, true)).toBe("OUT")

        expect(getStockLabel(null, false)).toBe("Illimitato")
        expect(getStockLabel(4, false)).toBe("Scorte basse (4)")
        expect(getStockLabel(8, false)).toBe("OK (8)")
        expect(getStockLabel(0, false)).toBe("Esaurito")
    })

    it("aggregates cart quantities by product", () => {
        const quantities = aggregateCartQuantities([
            { productId: "p1", quantity: 2 },
            { productId: "p1", quantity: 1 },
            { productId: "p2", quantity: 3 },
            { productId: " ", quantity: 9 },
            { productId: "p3", quantity: 0 }
        ])

        expect(quantities.get("p1")).toBe(3)
        expect(quantities.get("p2")).toBe(3)
        expect(quantities.has("p3")).toBe(false)
    })

    it("collects stock shortages from demand map", () => {
        const demands = new Map([
            ["p1", 2],
            ["p2", 5],
            ["missing", 1]
        ])

        const products = new Map([
            ["p1", { id: "p1", name: "Prod 1", stockQuantity: 2, isSoldOut: false }],
            ["p2", { id: "p2", name: "Prod 2", stockQuantity: 1, isSoldOut: false }]
        ])

        const shortages = collectStockShortages(demands, products)
        expect(shortages).toEqual([
            {
                productId: "p2",
                productName: "Prod 2",
                requestedQuantity: 5,
                availableQuantity: 1
            },
            {
                productId: "missing",
                productName: "Prodotto non trovato",
                requestedQuantity: 1,
                availableQuantity: 0
            }
        ])
    })

    it("applies stock decrement in strict and override modes", () => {
        expect(applyStockDecrement(10, 3, "strict")).toEqual({
            nextStockQuantity: 7,
            appliedQuantity: 3
        })
        expect(applyStockDecrement(2, 5, "strict")).toEqual({
            nextStockQuantity: 2,
            appliedQuantity: 0
        })
        expect(applyStockDecrement(2, 5, "override")).toEqual({
            nextStockQuantity: 0,
            appliedQuantity: 2
        })
        expect(applyStockDecrement(null, 5, "strict")).toEqual({
            nextStockQuantity: null,
            appliedQuantity: 5
        })
    })
})
