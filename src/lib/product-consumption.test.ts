import { describe, expect, it } from "vitest"
import {
    aggregateOrderProductConsumptions,
    aggregateOrderProductSales,
    buildProductSalesExportRows,
    buildProductSalesPrintRows
} from "./product-consumption"

describe("aggregateOrderProductConsumptions", () => {
    it("computes revenue from base price, options and line discount", () => {
        const metrics = aggregateOrderProductConsumptions({
            orders: [
                {
                    cart: [
                        {
                            productId: "p1",
                            snapshotName: "Birra",
                            quantity: 2,
                            selectedOptions: [{ priceVariation: 1 }],
                            discountApplied: 1
                        },
                        {
                            productId: "p2",
                            snapshotName: "Patatine",
                            quantity: 1,
                            selectedOptions: []
                        }
                    ]
                },
                {
                    cart: [
                        {
                            productId: "p1",
                            snapshotName: "Birra",
                            quantity: 1,
                            selectedOptions: [{ priceVariation: 1 }]
                        }
                    ]
                }
            ],
            catalogByProductId: new Map([
                ["p1", { name: "Birra", basePrice: 4 }],
                ["p2", { name: "Patatine", basePrice: 5 }]
            ])
        })

        expect(metrics).toEqual([
            {
                productId: "p1",
                productKey: "product:p1",
                productName: "Birra",
                quantityConsumed: 3,
                revenueAmount: 14
            },
            {
                productId: "p2",
                productKey: "product:p2",
                productName: "Patatine",
                quantityConsumed: 1,
                revenueAmount: 5
            }
        ])
    })

    it("falls back to persisted line total for legacy items without catalog entry", () => {
        const metrics = aggregateOrderProductConsumptions({
            orders: [
                {
                    cart: [
                        {
                            snapshotName: "Legacy item",
                            quantity: 2,
                            lineTotal: 7.5
                        }
                    ]
                }
            ]
        })

        expect(metrics).toEqual([
            {
                productId: undefined,
                productKey: "snapshot:Legacy item",
                productName: "Legacy item",
                quantityConsumed: 2,
                revenueAmount: 7.5
            }
        ])
    })

    it("prefers persisted line total over current catalog price", () => {
        const metrics = aggregateOrderProductConsumptions({
            orders: [
                {
                    totalAmount: 9,
                    cart: [
                        {
                            productId: "p1",
                            snapshotName: "Birra storica",
                            quantity: 2,
                            lineTotal: 9
                        }
                    ]
                }
            ],
            catalogByProductId: new Map([
                ["p1", { name: "Birra aggiornata", basePrice: 7 }]
            ])
        })

        expect(metrics).toEqual([
            {
                productId: "p1",
                productKey: "product:p1",
                productName: "Birra aggiornata",
                quantityConsumed: 2,
                revenueAmount: 9
            }
        ])
    })

    it("allocates order-level discounts proportionally to item revenues", () => {
        const metrics = aggregateOrderProductConsumptions({
            orders: [
                {
                    totalAmount: 12,
                    discountApplied: 3,
                    cart: [
                        {
                            productId: "p1",
                            snapshotName: "Birra",
                            quantity: 2,
                            selectedOptions: []
                        },
                        {
                            productId: "p2",
                            snapshotName: "Patatine",
                            quantity: 1,
                            selectedOptions: []
                        }
                    ]
                }
            ],
            catalogByProductId: new Map([
                ["p1", { name: "Birra", basePrice: 5 }],
                ["p2", { name: "Patatine", basePrice: 5 }]
            ])
        })

        expect(metrics).toEqual([
            {
                productId: "p1",
                productKey: "product:p1",
                productName: "Birra",
                quantityConsumed: 2,
                revenueAmount: 8
            },
            {
                productId: "p2",
                productKey: "product:p2",
                productName: "Patatine",
                quantityConsumed: 1,
                revenueAmount: 4
            }
        ])
    })

    it("clamps negative totals to zero", () => {
        const metrics = aggregateOrderProductConsumptions({
            orders: [
                {
                    cart: [
                        {
                            productId: "p1",
                            snapshotName: "Prodotto",
                            quantity: 1,
                            selectedOptions: [],
                            discountApplied: 20
                        }
                    ]
                }
            ],
            catalogByProductId: new Map([
                ["p1", { basePrice: 10 }]
            ])
        })

        expect(metrics).toEqual([
            {
                productId: "p1",
                productKey: "product:p1",
                productName: "Prodotto",
                quantityConsumed: 1,
                revenueAmount: 0
            }
        ])
    })
})

describe("aggregateOrderProductSales", () => {
    it("keeps full-price sales in the catalog category", () => {
        const result = aggregateOrderProductSales({
            orders: [{
                totalAmount: 10,
                discountApplied: 0,
                cart: [{ productId: "p1", snapshotName: "Birra vecchia", quantity: 2, lineTotal: 10 }]
            }],
            catalogByProductId: new Map([[
                "p1",
                { name: "Birra", shortName: "BIRRA", categoryName: "Bevande", categoryOrder: 2 }
            ]])
        })

        expect(result.rows).toEqual([expect.objectContaining({
            categoryName: "Bevande",
            productName: "Birra",
            displayName: "BIRRA",
            pricingRegime: "PREZZO PIENO",
            quantitySold: 2,
            grossAmount: 10,
            discountAmount: 0,
            netAmount: 10
        })])
        expect(result.totals).toEqual({ quantitySold: 2, grossAmount: 10, discountAmount: 0, netAmount: 10 })
    })

    it("assigns stacked discounts to one exclusive group and keeps monetary components separate", () => {
        const result = aggregateOrderProductSales({
            orders: [{
                totalAmount: 4,
                discountApplied: 6,
                discountComponents: [
                    { scope: "ORDER", type: "PERCENT", label: "Staff", value: 50, baseAmount: 10, appliedAmount: 5 },
                    { scope: "ORDER", type: "FIXED", label: "Promo", value: 1, baseAmount: 5, appliedAmount: 1 }
                ],
                cart: [{ productId: "p1", snapshotName: "Piatto", quantity: 2, lineTotal: 10 }]
            }]
        })

        expect(result.rows).toEqual([expect.objectContaining({
            pricingRegime: "SCONTATO",
            discountLabel: "Staff + Promo",
            discountMode: "Combinato",
            discountValue: "50% + 1.00 EUR",
            quantitySold: 2,
            grossAmount: 10,
            discountAmount: 6,
            netAmount: 4
        })])
        expect(result.totals.quantitySold).toBe(2)
        expect(result.discountSummaries).toEqual([
            { label: "Promo", mode: "Fisso", value: "1.00 EUR", ordersCount: 1, discountAmount: 1 },
            { label: "Staff", mode: "Percentuale", value: "50%", ordersCount: 1, discountAmount: 5 }
        ])
    })

    it("classifies volunteer prices as product discounts", () => {
        const result = aggregateOrderProductSales({
            orders: [{
                pricingMode: "VOLUNTEER",
                totalAmount: 6,
                discountApplied: 4,
                discountComponents: [{
                    scope: "VOLUNTEER",
                    type: "FIXED",
                    label: "Volontari",
                    value: 2,
                    baseAmount: 10,
                    appliedAmount: 4,
                    productId: "p1"
                }],
                cart: [{
                    productId: "p1",
                    snapshotName: "Piatto",
                    quantity: 2,
                    lineTotal: 6,
                    discountApplied: 4,
                    discountMeta: { type: "FIXED", label: "Volontari", value: 2 }
                }]
            }]
        })

        expect(result.rows[0]).toEqual(expect.objectContaining({
            discountLabel: "Volontari",
            quantitySold: 2,
            grossAmount: 10,
            discountAmount: 4,
            netAmount: 6
        }))
        expect(result.discountSummaries[0]).toEqual(expect.objectContaining({
            label: "Volontari",
            discountAmount: 4
        }))
    })

    it("reconciles percentage rounding and a 100 percent discount in cents", () => {
        const rounded = aggregateOrderProductSales({
            orders: [{
                totalAmount: 0.02,
                discountApplied: 0.01,
                discountComponents: [{
                    scope: "ORDER",
                    type: "PERCENT",
                    label: "Promo",
                    value: 33.33,
                    baseAmount: 0.03,
                    appliedAmount: 0.01
                }],
                cart: [
                    { productId: "p1", snapshotName: "Uno", quantity: 1, lineTotal: 0.01 },
                    { productId: "p2", snapshotName: "Due", quantity: 1, lineTotal: 0.02 }
                ]
            }]
        })
        const free = aggregateOrderProductSales({
            orders: [{
                totalAmount: 0,
                discountApplied: 10,
                discountComponents: [{
                    scope: "ORDER",
                    type: "PERCENT",
                    label: "Omaggio",
                    value: 100,
                    baseAmount: 10,
                    appliedAmount: 10
                }],
                cart: [{ productId: "p1", snapshotName: "Piatto", quantity: 1, lineTotal: 10 }]
            }]
        })

        expect(rounded.totals).toEqual({ quantitySold: 2, grossAmount: 0.03, discountAmount: 0.01, netAmount: 0.02 })
        expect(rounded.rows.reduce((sum, row) => sum + row.netAmount, 0)).toBe(0.02)
        expect(free.totals).toEqual({ quantitySold: 1, grossAmount: 10, discountAmount: 10, netAmount: 0 })
    })

    it("uses snapshots for deleted products and classifies unknown legacy discounts", () => {
        const result = aggregateOrderProductSales({
            orders: [{
                totalAmount: 5,
                discountApplied: 5,
                discountMeta: { type: "FIXED", label: "Sconti: Staff, Promo", value: 5 },
                cart: [{
                    productId: "deleted",
                    snapshotName: "Prodotto eliminato con nome molto lungo",
                    quantity: 1,
                    lineTotal: 10
                }]
            }]
        })

        expect(result.rows[0]).toEqual(expect.objectContaining({
            categoryName: "Non categorizzato",
            displayName: "Prodotto eliminato con n",
            discountLabel: "Sconto combinato",
            discountMode: "Combinato",
            grossAmount: 10,
            discountAmount: 5,
            netAmount: 5
        }))
        expect(result.discountSummaries[0]).toEqual({
            label: "Sconto combinato",
            mode: "Combinato",
            value: "-",
            ordersCount: 1,
            discountAmount: 5
        })
    })

    it("builds rectangular detail, category subtotal, general total and discount summary rows", () => {
        const result = aggregateOrderProductSales({
            orders: [{
                totalAmount: 8,
                discountApplied: 2,
                discountMeta: { type: "PERCENT", label: "Staff", value: 20 },
                cart: [{ productId: "p1", snapshotName: "Panino", quantity: 2, lineTotal: 10 }]
            }],
            catalogByProductId: new Map([[
                "p1",
                { name: "Panino", shortName: "PANINO", categoryName: "Cucina", categoryOrder: 1 }
            ]])
        })
        const rows = buildProductSalesExportRows(result)

        expect(rows[1]).toEqual([
            "Tipo riga", "Categoria", "Prodotto", "Descrizione breve", "Regime prezzo",
            "Etichetta sconto", "Modalità sconto", "Valore sconto", "Quantità venduta",
            "Lordo", "Sconto", "Netto"
        ])
        expect(rows).toContainEqual([
            "TOTALE CATEGORIA", "Cucina", "", "", "", "", "", "", 2, "10.00", "2.00", "8.00"
        ])
        expect(rows).toContainEqual([
            "TOTALE GENERALE", "", "", "", "", "", "", "", 2, "10.00", "2.00", "8.00"
        ])
        expect(rows).toContainEqual(["Staff", "Percentuale", "20%", 1, "2.00"])
        expect(rows.every((row) => row.length <= 12)).toBe(true)
    })

    it("keeps category subtotals separate when display names match", () => {
        const result = aggregateOrderProductSales({
            orders: [{
                totalAmount: 3,
                cart: [
                    { productId: "p1", quantity: 1, lineTotal: 1 },
                    { productId: "p2", quantity: 1, lineTotal: 2 }
                ]
            }],
            catalogByProductId: new Map([
                ["p1", { name: "Acqua", categoryKey: "cat-a", categoryName: "Bar", categoryOrder: 1 }],
                ["p2", { name: "Birra", categoryKey: "cat-b", categoryName: "Bar", categoryOrder: 1 }]
            ])
        })

        expect(buildProductSalesExportRows(result).filter((row) => row[0] === "TOTALE CATEGORIA")).toEqual([
            ["TOTALE CATEGORIA", "Bar", "", "", "", "", "", "", 1, "1.00", "0.00", "1.00"],
            ["TOTALE CATEGORIA", "Bar", "", "", "", "", "", "", 1, "2.00", "0.00", "2.00"]
        ])
    })

    it("builds compact print rows with full price before discount groups", () => {
        const result = aggregateOrderProductSales({
            orders: [
                { totalAmount: 5, cart: [{ productId: "p1", snapshotName: "Nome lungo", quantity: 1, lineTotal: 5 }] },
                {
                    totalAmount: 4,
                    discountApplied: 1,
                    discountMeta: { type: "FIXED", label: "Staff", value: 1 },
                    cart: [{ productId: "p1", snapshotName: "Nome lungo", quantity: 1, lineTotal: 5 }]
                }
            ],
            catalogByProductId: new Map([["p1", { name: "Nome lungo", shortName: "BREVE" }]])
        })

        expect(buildProductSalesPrintRows(result)).toEqual([
            { categoryName: "Non categorizzato", name: "BREVE", qty: 1, lineTotal: 5, groupLabel: "PREZZO PIENO", grossAmount: 5, discountAmount: 0 },
            { categoryName: "Non categorizzato", name: "BREVE", qty: 1, lineTotal: 4, groupLabel: "Staff", grossAmount: 5, discountAmount: 1 }
        ])
    })
})
