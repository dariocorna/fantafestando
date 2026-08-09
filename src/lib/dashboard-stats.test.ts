import { describe, expect, it } from "vitest"
import {
    buildDashboardCsvContent,
    buildDashboardXlsCompatibleContent,
    computeDashboardStats,
    filterDashboardOrdersByLocalDay,
    formatDashboardDateTime,
    normalizePaymentMethod
} from "./dashboard-stats"
import { aggregateOrderProductSales } from "./product-consumption"

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

    it("returns every sold product in deterministic order while keeping best sellers limited", () => {
        const stats = computeDashboardStats({
            orders: [
                {
                    id: "paid",
                    status: "PAID",
                    cart: [
                        { productId: "p1", quantity: 5 },
                        { productId: "p2", quantity: 4 },
                        { productId: "p3", quantity: 3 },
                        { productId: "p4", quantity: 2 },
                        { productId: "p5", quantity: 2 },
                        { productId: "p6", quantity: 1 }
                    ]
                },
                {
                    id: "pending",
                    status: "PENDING",
                    cart: [{ productId: "p7", quantity: 99 }]
                }
            ],
            products: [
                { id: "p1", name: "Uno" },
                { id: "p2", name: "Due" },
                { id: "p3", name: "Tre" },
                { id: "p4", name: "Zuppa" },
                { id: "p5", name: "Acqua" },
                { id: "p6", name: "Sei" },
                { id: "p7", name: "Solo pendente" },
                { id: "p8", name: "Invenduto" }
            ],
            bestSellerLimit: 5
        })

        expect(stats.soldProducts.map((metric) => metric.productId)).toEqual([
            "p1",
            "p2",
            "p3",
            "p5",
            "p4",
            "p6"
        ])
        expect(stats.bestSellers).toEqual(stats.soldProducts.slice(0, 5))
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
        expect(stats.soldProducts).toEqual([])
        expect(stats.bestSellers).toEqual([])
        expect(stats.underperforming).toEqual([])
        expect(stats.paidOrders).toEqual([])
    })

    it.each([
        {
            season: "summer time",
            referenceDate: "2026-08-08T12:00:00.000Z",
            before: "2026-08-07T21:59:59.999Z",
            start: "2026-08-07T22:00:00.000Z",
            end: "2026-08-08T21:59:59.999Z",
            after: "2026-08-08T22:00:00.000Z"
        },
        {
            season: "winter time",
            referenceDate: "2026-01-15T12:00:00.000Z",
            before: "2026-01-14T22:59:59.999Z",
            start: "2026-01-14T23:00:00.000Z",
            end: "2026-01-15T22:59:59.999Z",
            after: "2026-01-15T23:00:00.000Z"
        },
        {
            season: "spring DST transition",
            referenceDate: "2026-03-29T12:00:00.000Z",
            before: "2026-03-28T22:59:59.999Z",
            start: "2026-03-28T23:00:00.000Z",
            end: "2026-03-29T21:59:59.999Z",
            after: "2026-03-29T22:00:00.000Z"
        },
        {
            season: "autumn DST transition",
            referenceDate: "2026-10-25T12:00:00.000Z",
            before: "2026-10-24T21:59:59.999Z",
            start: "2026-10-24T22:00:00.000Z",
            end: "2026-10-25T22:59:59.999Z",
            after: "2026-10-25T23:00:00.000Z"
        }
    ])("filters orders on Rome calendar-day boundaries in $season", ({ referenceDate, before, start, end, after }) => {
        const orders = [
            { id: "before", createdAt: before },
            { id: "start", createdAt: start },
            { id: "end", createdAt: end },
            { id: "after", createdAt: after },
            { id: "invalid", createdAt: "invalid" }
        ]

        expect(filterDashboardOrdersByLocalDay(orders, referenceDate).map((order) => order.id)).toEqual([
            "start",
            "end"
        ])
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

        const salesBreakdown = aggregateOrderProductSales({
            orders: [{
                totalAmount: 8,
                discountApplied: 2,
                discountMeta: { type: "PERCENT", label: "Staff", value: 20 },
                cart: [{ productId: "p1", snapshotName: "Piadina", quantity: 2, lineTotal: 10 }]
            }],
            catalogByProductId: new Map([["p1", {
                name: "Piadina speciale",
                shortName: "PIADINA",
                categoryName: "Cucina",
                categoryOrder: 1
            }]])
        })
        const csv = buildDashboardCsvContent(stats, { eventName: "Festa Test", salesBreakdown })
        const xls = buildDashboardXlsCompatibleContent(stats, { eventName: "Festa Test", salesBreakdown })

        expect(csv.startsWith("\uFEFF")).toBe(true)
        expect(csv).toContain("Sezione,Valore")
        expect(csv).toContain("Incasso totale")
        expect(csv).toContain("Top prodotti")
        expect(csv).toContain("Piadina")
        expect(csv).toContain("Tipo riga,Categoria,Prodotto,Descrizione breve")
        expect(csv).toContain("TOTALE CATEGORIA,Cucina")
        expect(csv).toContain("TOTALE GENERALE")
        expect(csv).toContain("Riepilogo componenti sconto")
        expect(csv).toContain("Staff,Percentuale,20%,1,2.00")

        expect(xls.startsWith("\uFEFF")).toBe(true)
        expect(xls).toContain("Sezione\tValore")
        expect(xls).toContain("Ordini saldati")
        expect(xls).toContain("Tipo riga\tCategoria\tProdotto\tDescrizione breve")
        expect(xls).toContain("Staff\tPercentuale\t20%\t1\t2.00")

        const csvSalesSection = csv.slice(csv.indexOf("Vendite per categoria"), csv.indexOf("Ordini saldati", csv.indexOf("Vendite per categoria")))
        const xlsSalesSection = xls.slice(xls.indexOf("Vendite per categoria"), xls.indexOf("Ordini saldati", xls.indexOf("Vendite per categoria")))
        expect(csvSalesSection.replaceAll(",", "\t")).toBe(xlsSalesSection)
    })

    it("normalizes payment method values and formats date", () => {
        expect(normalizePaymentMethod("cash")).toBe("CASH")
        expect(normalizePaymentMethod("card")).toBe("CARD")
        expect(normalizePaymentMethod("wire")).toBe("OTHER")
        expect(formatDashboardDateTime("")).toBe("-")
    })
})
