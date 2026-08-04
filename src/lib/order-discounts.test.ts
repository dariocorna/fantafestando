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

    it("applies ordered order discounts sequentially", () => {
        const result = computeOrderDiscounts({
            lines: [{ productId: "p1", quantity: 1, unitAmount: 10 }],
            orderDiscounts: [
                { type: "PERCENT", value: 50, label: "Staff" },
                { type: "FIXED", value: 1, label: "Promo" }
            ]
        })

        expect(result.success).toBe(true)
        if (!result.success) return
        expect(result.summary.orderDiscountComponents).toEqual([
            { type: "PERCENT", value: 50, label: "Staff", baseAmount: 10, appliedAmount: 5 },
            { type: "FIXED", value: 1, label: "Promo", baseAmount: 5, appliedAmount: 1 }
        ])
        expect(result.summary.discountApplied).toBe(6)
        expect(result.summary.finalAmount).toBe(4)
    })

    it("rejects mixed legacy and ordered order discount payloads", () => {
        const result = computeOrderDiscounts({
            lines: [{ productId: "p1", quantity: 1, unitAmount: 10 }],
            orderDiscount: { type: "PERCENT", value: 10 },
            orderDiscounts: [{ type: "FIXED", value: 1 }]
        })

        expect(result).toEqual({ success: false, error: "Usa orderDiscount oppure orderDiscounts, non entrambi" })
    })

    it("treats an empty ordered-discount array as absent for legacy clients", () => {
        const result = computeOrderDiscounts({
            lines: [{ productId: "p1", quantity: 1, unitAmount: 10 }],
            orderDiscount: { type: "PERCENT", value: 10, label: "Legacy" },
            orderDiscounts: []
        })

        expect(result.success).toBe(true)
        if (!result.success) return
        expect(result.summary.discountApplied).toBe(1)
        expect(result.summary.finalAmount).toBe(9)
    })

    it("limits ordered order discounts to eight components", () => {
        const result = computeOrderDiscounts({
            lines: [{ productId: "p1", quantity: 1, unitAmount: 10 }],
            orderDiscounts: Array.from({ length: 9 }, (_, index) => ({
                type: "FIXED",
                value: 0.01,
                label: `Sconto ${index + 1}`
            }))
        })

        expect(result).toEqual({ success: false, error: "Puoi applicare al massimo 8 sconti ordine" })
    })
})
