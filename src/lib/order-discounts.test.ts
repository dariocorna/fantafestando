import { describe, expect, it } from "vitest"
import { computeOrderDiscounts } from "./order-discounts"

describe("order discounts helpers", () => {
    it("computes order-level percentage discount", () => {
        const result = computeOrderDiscounts({
            lines: [
                { productId: "p1", quantity: 2, unitAmount: 5 },
                { productId: "p2", quantity: 1, unitAmount: 4 }
            ],
            orderDiscount: { type: "PERCENT", value: 10, label: "Staff" }
        })

        expect(result.success).toBe(true)
        if (!result.success) return

        expect(result.summary.baseAmount).toBe(14)
        expect(result.summary.discountApplied).toBe(1.4)
        expect(result.summary.finalAmount).toBe(12.6)
        expect(result.summary.orderDiscountMeta).toEqual({
            type: "PERCENT",
            value: 10,
            label: "Staff",
            baseAmount: 14,
            scope: "ORDER"
        })
    })

    it("computes line-level fixed discount on the selected product only", () => {
        const result = computeOrderDiscounts({
            lines: [
                { productId: "p1", quantity: 2, unitAmount: 5 },
                { productId: "p2", quantity: 1, unitAmount: 4 }
            ],
            lineDiscounts: [
                { productId: "p1", type: "FIXED", value: 3, label: "Promo prodotto" }
            ]
        })

        expect(result.success).toBe(true)
        if (!result.success) return

        expect(result.summary.baseAmount).toBe(14)
        expect(result.summary.lineDiscountAmount).toBe(3)
        expect(result.summary.orderDiscountAmount).toBe(0)
        expect(result.summary.discountApplied).toBe(3)
        expect(result.summary.finalAmount).toBe(11)

        const firstLine = result.summary.lineResults[0]
        expect(firstLine.discountApplied).toBe(3)
        expect(firstLine.discountMeta?.type).toBe("FIXED")

        const secondLine = result.summary.lineResults[1]
        expect(secondLine.discountApplied).toBe(0)
        expect(secondLine.discountMeta).toBeUndefined()
    })

    it("rejects stacking between order and line discounts", () => {
        const result = computeOrderDiscounts({
            lines: [{ productId: "p1", quantity: 1, unitAmount: 8 }],
            orderDiscount: { type: "PERCENT", value: 10 },
            lineDiscounts: [{ productId: "p1", type: "FIXED", value: 1 }]
        })

        expect(result).toEqual({
            success: false,
            error: "Non è possibile combinare sconto ordine e sconti su singole righe"
        })
    })

    it("clamps over-100 percentage and fixed discount above line amount", () => {
        const result = computeOrderDiscounts({
            lines: [{ productId: "p1", quantity: 1, unitAmount: 3 }],
            lineDiscounts: [{ productId: "p1", type: "PERCENT", value: 180 }]
        })

        expect(result.success).toBe(true)
        if (!result.success) return

        expect(result.summary.discountApplied).toBe(3)
        expect(result.summary.finalAmount).toBe(0)
        expect(result.summary.lineResults[0].discountMeta?.value).toBe(100)
    })

    it("fails when a line discount points to a product not in cart", () => {
        const result = computeOrderDiscounts({
            lines: [{ productId: "p1", quantity: 1, unitAmount: 3 }],
            lineDiscounts: [{ productId: "p2", type: "FIXED", value: 1 }]
        })

        expect(result).toEqual({
            success: false,
            error: "Sconto riga non valido: prodotto non presente nel carrello"
        })
    })
})
