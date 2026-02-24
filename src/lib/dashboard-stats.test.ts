import { describe, expect, it } from "vitest"
import {
    buildDashboardCsvContent,
    buildDashboardXlsCompatibleContent,
    computeDashboardStats,
    formatDashboardDateTime,
    normalizePaymentMethod
} from "./dashboard-stats"

describe("dashboard stats helpers", () => {
    it("aggregates totals and payment split for paid orders only", () => {
        const stats = computeDashboardStats({
            orders: [
                {
                    id: "o1",
                    status: "PAID",
                    createdAt: "2026-02-20T20:00:00.000Z",
                    totalAmount: 10,
                    paymentMethod: "CASH",
                    cart: [{ productId: "p1", snapshotName: "Piadina", quantity: 2 }]
                },
                {
                    id: "o2",
                    status: "PAID",
                    createdAt: "2026-02-20T21:00:00.000Z",
                    totalAmount: 20,
                    paymentMethod: "CARD",
                    cart: [{ productId: "p2", snapshotName: "Birra", quantity: 1 }]
                },
                {
                    id: "o3",
                    status: "PENDING",
                    createdAt: "2026-02-20T22:00:00.000Z",
                    totalAmount: 99,
                    paymentMethod: "CASH",
                    cart: [{ productId: "p1", snapshotName: "Piadina", quantity: 99 }]
                }
            ],
            products: [
                { id: "p1", name: "Piadina" },
                { id: "p2", name: "Birra" }
            ]
        })

        expect(stats.summary).toEqual({
            totalRevenue: 30,
            cashRevenue: 10,
            cardRevenue: 20,
            otherRevenue: 0,
            paidOrdersCount: 2,
            averageTicket: 15
        })
        expect(stats.paidOrders.map((order) => order.orderId)).toEqual(["o2", "o1"])
        expect(stats.bestSellers.map((metric) => [metric.productId, metric.quantitySold])).toEqual([
            ["p1", 2],
            ["p2", 1]
        ])
    })

    it("orders best sellers by quantity, order count and fallback names", () => {
        const stats = computeDashboardStats({
            orders: [
                {
                    id: "o1",
                    status: "PAID",
                    totalAmount: 12,
                    paymentMethod: "CASH",
                    cart: [
                        { productId: "p1", snapshotName: "Polenta", quantity: 1 },
                        { productId: "p2", snapshotName: "Salsiccia", quantity: 2 }
                    ]
                },
                {
                    id: "o2",
                    status: "PAID",
                    totalAmount: 18,
                    paymentMethod: "CASH",
                    cart: [
                        { productId: "p2", snapshotName: "Salsiccia", quantity: 1 },
                        { productId: "legacy", snapshotName: "Prodotto Legacy", quantity: 3 }
                    ]
                }
            ],
            products: [
                { id: "p1", name: "Polenta" },
                { id: "p2", name: "Salsiccia" }
            ],
            bestSellerLimit: 3
        })

        expect(stats.bestSellers).toEqual([
            {
                productId: "p2",
                productName: "Salsiccia",
                quantitySold: 3,
                ordersCount: 2
            },
            {
                productId: "legacy",
                productName: "Prodotto Legacy",
                quantitySold: 3,
                ordersCount: 1
            },
            {
                productId: "p1",
                productName: "Polenta",
                quantitySold: 1,
                ordersCount: 1
            }
        ])
    })

    it("classifies underperforming products including unsold ones", () => {
        const stats = computeDashboardStats({
            orders: [
                {
                    id: "o1",
                    status: "PAID",
                    totalAmount: 25,
                    paymentMethod: "CASH",
                    cart: [{ productId: "p1", snapshotName: "Tagliere", quantity: 5 }]
                },
                {
                    id: "o2",
                    status: "PAID",
                    totalAmount: 5,
                    paymentMethod: "OTHER",
                    cart: [{ productId: "p2", snapshotName: "Acqua", quantity: 1 }]
                }
            ],
            products: [
                { id: "p1", name: "Tagliere" },
                { id: "p2", name: "Acqua" },
                { id: "p3", name: "Dolce" },
                { id: "p4", name: "Frutta" }
            ],
            underperformingThreshold: 1,
            underperformingLimit: 10
        })

        expect(stats.summary.otherRevenue).toBe(5)
        expect(stats.underperforming).toEqual([
            {
                productId: "p3",
                productName: "Dolce",
                quantitySold: 0,
                ordersCount: 0
            },
            {
                productId: "p4",
                productName: "Frutta",
                quantitySold: 0,
                ordersCount: 0
            },
            {
                productId: "p2",
                productName: "Acqua",
                quantitySold: 1,
                ordersCount: 1
            }
        ])
    })

    it("handles empty datasets", () => {
        const stats = computeDashboardStats({
            orders: [],
            products: []
        })

        expect(stats.summary).toEqual({
            totalRevenue: 0,
            cashRevenue: 0,
            cardRevenue: 0,
            otherRevenue: 0,
            paidOrdersCount: 0,
            averageTicket: 0
        })
        expect(stats.bestSellers).toEqual([])
        expect(stats.underperforming).toEqual([])
        expect(stats.paidOrders).toEqual([])
    })

    it("builds csv and xls-compatible exports", () => {
        const stats = computeDashboardStats({
            orders: [
                {
                    id: "o1",
                    status: "PAID",
                    createdAt: "2026-02-24T18:30:00.000Z",
                    totalAmount: 11,
                    paymentMethod: "CASH",
                    cart: [{ productId: "p1", snapshotName: "Piadina", quantity: 2 }]
                }
            ],
            products: [{ id: "p1", name: "Piadina" }]
        })

        const csv = buildDashboardCsvContent(stats, { eventName: "Festa Test" })
        const xls = buildDashboardXlsCompatibleContent(stats, { eventName: "Festa Test" })

        expect(csv.startsWith("\uFEFF")).toBe(true)
        expect(csv).toContain("Sezione,Valore")
        expect(csv).toContain("Incasso totale")
        expect(csv).toContain("Top prodotti")
        expect(csv).toContain("Piadina")

        expect(xls.startsWith("\uFEFF")).toBe(true)
        expect(xls).toContain("Sezione\tValore")
        expect(xls).toContain("Ordini saldati")
    })

    it("normalizes payment method values and formats date", () => {
        expect(normalizePaymentMethod("cash")).toBe("CASH")
        expect(normalizePaymentMethod("card")).toBe("CARD")
        expect(normalizePaymentMethod("wire")).toBe("OTHER")
        expect(formatDashboardDateTime("")).toBe("-")
    })
})
