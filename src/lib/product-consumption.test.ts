import { describe, expect, it } from "vitest"
import { aggregateOrderProductConsumptions } from "./product-consumption"

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
