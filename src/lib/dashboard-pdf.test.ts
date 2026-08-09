import { describe, expect, it } from "vitest"
import { inflateSync } from "node:zlib"
import {
    buildDashboardPdfBuffer,
    buildDashboardPdfCategoryRows,
    buildDashboardPdfPages
} from "./dashboard-pdf"
import type { DashboardStatsResult } from "./dashboard-stats"
import { aggregateOrderProductSales, type ProductSalesBreakdownResult } from "./product-consumption"

const stats: DashboardStatsResult = {
    generatedAt: "2026-08-10T10:00:00.000Z",
    summary: {
        totalRevenue: 123.45,
        cashRevenue: 80,
        cardRevenue: 40,
        otherRevenue: 3.45,
        paidOrdersCount: 12,
        averageTicket: 10.29
    },
    soldProducts: [],
    bestSellers: [],
    underperforming: [],
    paidOrders: []
}

function buildSales(rowCount: number, productsPerCategory = 10): ProductSalesBreakdownResult {
    const rows = Array.from({ length: rowCount }, (_, index) => ({
        categoryName: `Categoria ${Math.floor(index / productsPerCategory) + 1}`,
        categoryOrder: Math.floor(index / productsPerCategory) + 1,
        productId: `product-${index}`,
        productKey: `product:product-${index}`,
        productName: `Prodotto ${index + 1}`,
        displayName: `Prodotto ${index + 1}`,
        pricingRegime: "PREZZO PIENO" as const,
        discountLabel: "-",
        discountMode: "-",
        discountValue: "-",
        groupLabel: "PREZZO PIENO",
        quantitySold: 1,
        grossAmount: 1.5,
        discountAmount: 0,
        netAmount: 1.5
    }))

    return {
        rows,
        discountSummaries: [],
        totals: {
            quantitySold: rowCount,
            grossAmount: rowCount * 1.5,
            discountAmount: 0,
            netAmount: rowCount * 1.5
        }
    }
}

function extractPdfTextRuns(buffer: Buffer): string[] {
    const streams = buffer.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)
    const content = [...streams].map((match) => {
        try {
            return inflateSync(Buffer.from(match[1], "latin1")).toString("latin1")
        } catch {
            return ""
        }
    }).join("\n")
    return [...content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)].map((match) => {
        const hex = [...match[1].matchAll(/<([0-9a-f]+)>/gi)].map((part) => part[1]).join("")
        return Buffer.from(hex, "hex").toString("latin1")
    })
}

describe("dashboard PDF", () => {
    it("aggregates category amounts in cents", () => {
        const sales = buildSales(2)
        sales.rows[0].grossAmount = 0.1
        sales.rows[0].netAmount = 0.1
        sales.rows[1].grossAmount = 0.2
        sales.rows[1].netAmount = 0.2

        expect(buildDashboardPdfCategoryRows(sales)).toEqual([{
            key: "name:Categoria 1",
            name: "Categoria 1",
            quantity: 2,
            grossAmount: 0.3,
            discountAmount: 0,
            netAmount: 0.3
        }])
        expect(buildDashboardPdfPages(buildSales(0))).toEqual([{
            showOverview: true,
            categoryRows: [],
            productRows: []
        }])
    })

    it("keeps categories with the same display name separate by their stable key", () => {
        const sales = aggregateOrderProductSales({
            orders: [{
                totalAmount: 3,
                cart: [
                    { productId: "p1", snapshotName: "Acqua", quantity: 1, lineTotal: 1 },
                    { productId: "p2", snapshotName: "Birra", quantity: 1, lineTotal: 2 }
                ]
            }],
            catalogByProductId: new Map([
                ["p1", { name: "Acqua", categoryKey: "cat-a", categoryName: "Bar", categoryOrder: 1 }],
                ["p2", { name: "Birra", categoryKey: "cat-b", categoryName: "Bar", categoryOrder: 1 }]
            ])
        })

        expect(sales.rows.map((row) => row.categoryKey)).toEqual(["cat-a", "cat-b"])
        expect(buildDashboardPdfCategoryRows(sales)).toEqual([
            expect.objectContaining({ key: "key:cat-a", name: "Bar", netAmount: 1 }),
            expect.objectContaining({ key: "key:cat-b", name: "Bar", netAmount: 2 })
        ])
    })

    it("renders conservative explicit A4 chunks with repeated report and table headers", async () => {
        const sales = buildSales(105, 1)
        sales.rows[0].pricingRegime = "SCONTATO"
        sales.rows[0].discountLabel = "Promo"
        sales.rows[0].discountMode = "Percentuale"
        sales.rows[0].discountValue = "10%"
        sales.rows[0].groupLabel = "Promo"
        const pages = buildDashboardPdfPages(sales)
        const categoryPages = pages.filter((page) => page.categoryRows)
        const productPages = pages.filter((page) => page.productRows)
        const buffer = await buildDashboardPdfBuffer({
            eventName: "Festa Test",
            stats,
            sales,
            intervalLabel: "Intera festa",
            timezone: "Europe/Rome"
        })

        const rawPdf = buffer.toString("latin1")
        const pageCount = rawPdf.match(/\/Type \/Page\b/g)?.length || 0
        const textRuns = extractPdfTextRuns(buffer)
        expect(categoryPages.map((page) => page.categoryRows?.length)).toEqual([10, 18, 18, 18, 18, 18, 5])
        expect(productPages.map((page) => page.productRows?.length)).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 5])
        expect(categoryPages.flatMap((page) => page.categoryRows || []).map((row) => row.name))
            .toEqual(sales.rows.map((row) => row.categoryName))
        expect(productPages.flatMap((page) => page.productRows || []).map((row) => row.productKey))
            .toEqual(sales.rows.map((row) => row.productKey))
        expect(pages.filter((page) => page.showOverview)).toHaveLength(1)
        expect(buffer.subarray(0, 5).toString()).toBe("%PDF-")
        expect(rawPdf).toContain("/MediaBox [0 0 595.280029 841.890015]")
        expect(pageCount).toBe(pages.length)
        expect(rawPdf.match(/\/MediaBox \[0 0 595\.280029 841\.890015\]/g)).toHaveLength(pageCount)
        expect(textRuns.filter((text) => text === "FANTAFESTANDO")).toHaveLength(pageCount)
        expect(textRuns.filter((text) => text === "Categoria")).toHaveLength(categoryPages.length + productPages.length)
        expect(textRuns.filter((text) => text === "Prodotto")).toHaveLength(productPages.length)
        expect(textRuns.filter((text) => text === "Promo")).toHaveLength(1)
        expect(textRuns.filter((text) => text === "10%")).toHaveLength(1)
    })
})
