import { describe, expect, it } from "vitest"
import { computeCashSessionSummary } from "./cash-session"

describe("cash session summary", () => {
    it("computes expected totals and variance", () => {
        const summary = computeCashSessionSummary({
            openingFloatAmount: 50,
            closingCountedCashAmount: 92.5,
            orders: [
                { status: "PAID", paymentMethod: "CASH", totalAmount: 30 },
                { status: "PAID", paymentMethod: "CARD", totalAmount: 10 },
                { status: "PAID", paymentMethod: "OTHER", totalAmount: 2.5 }
            ]
        })

        expect(summary).toEqual({
            paidOrdersCount: 3,
            cashSalesAmount: 30,
            cardSalesAmount: 10,
            otherSalesAmount: 2.5,
            expectedCashAmount: 80,
            varianceAmount: 12.5
        })
    })

    it("ignores non-paid orders", () => {
        const summary = computeCashSessionSummary({
            openingFloatAmount: 20,
            closingCountedCashAmount: 20,
            orders: [
                { status: "PENDING", paymentMethod: "CASH", totalAmount: 100 },
                { status: "CANCELLED", paymentMethod: "CARD", totalAmount: 50 }
            ]
        })

        expect(summary).toEqual({
            paidOrdersCount: 0,
            cashSalesAmount: 0,
            cardSalesAmount: 0,
            otherSalesAmount: 0,
            expectedCashAmount: 20,
            varianceAmount: 0
        })
    })

    it("handles precision using cents", () => {
        const summary = computeCashSessionSummary({
            openingFloatAmount: 0.1,
            closingCountedCashAmount: 0.3,
            orders: [
                { status: "PAID", paymentMethod: "CASH", totalAmount: 0.2 }
            ]
        })

        expect(summary.expectedCashAmount).toBe(0.3)
        expect(summary.varianceAmount).toBe(0)
    })
})
