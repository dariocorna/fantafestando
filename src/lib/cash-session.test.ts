import { describe, expect, it } from "vitest"
import {
    buildCashSessionCsvContent,
    buildCashSessionXlsCompatibleContent,
    computeCashSessionSummary
} from "./cash-session"

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

    it("builds csv cash session report with expected key sections", () => {
        const csv = buildCashSessionCsvContent({
            eventName: "Festa Demo",
            posDeviceName: "Cassa Principale",
            sessionId: "session-123",
            status: "CLOSED",
            openedAt: "2026-02-25T17:00:00.000Z",
            closedAt: "2026-02-25T20:00:00.000Z",
            openingFloatAmount: 50,
            cashSalesAmount: 75.5,
            cardSalesAmount: 10,
            otherSalesAmount: 2,
            expectedCashAmount: 125.5,
            closingCountedCashAmount: 126,
            varianceAmount: 0.5,
            paidOrdersCount: 4,
            openingNotes: "Fondo iniziale",
            closingNotes: "Consegnato in cassaforte",
            productConsumptions: [
                { productId: "p1", productName: "Polenta", quantityConsumed: 3, revenueAmount: 18 },
                { productId: "p2", productName: "Acqua", quantityConsumed: 1, revenueAmount: 1.5 }
            ],
            orders: [
                {
                    id: "order-1",
                    createdAt: "2026-02-25T18:00:00.000Z",
                    paymentMethod: "CASH",
                    totalAmount: 30,
                    customerName: "Mario",
                    customerTable: "A1"
                }
            ]
        })

        expect(csv).toContain("Contante atteso (solo contanti)")
        expect(csv).toContain("125.50")
        expect(csv).toContain("Ordini sessione")
        expect(csv).toContain("order-1")
        expect(csv).toContain("Contanti")
        expect(csv).toContain("Consumo prodotti sessione")
        expect(csv).toContain("Polenta")
        expect(csv).toContain("3")
        expect(csv).toContain("18.00")
    })

    it("builds xls-compatible cash session report using tab separator", () => {
        const xls = buildCashSessionXlsCompatibleContent({
            eventName: "Festa Demo",
            posDeviceName: "Cassa B",
            sessionId: "session-456",
            status: "CLOSED",
            openingFloatAmount: 20,
            expectedCashAmount: 45,
            closingCountedCashAmount: 40,
            varianceAmount: -5,
            productConsumptions: [
                { productId: "p1", productName: "Panino", quantityConsumed: 2, revenueAmount: 10 }
            ],
            orders: []
        })

        expect(xls).toContain("Sezione\tValore")
        expect(xls).toContain("Contante atteso (solo contanti)\t45.00")
        expect(xls).toContain("Ordini sessione")
        expect(xls).toContain("Consumo prodotti sessione")
        expect(xls).toContain("Panino\t2\t10.00")
    })
})
