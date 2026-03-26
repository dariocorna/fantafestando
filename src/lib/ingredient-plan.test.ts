import { describe, expect, test } from "vitest";
import {
    attachIngredientCatalogMetadata,
    aggregatePendingIngredientQueue,
    buildIngredientPlanForCart,
    buildLegacyIngredientPlanFromOrderCart,
} from "@/lib/ingredient-plan";

describe("ingredient plan builder", () => {
    test("expands a standard product recipe into ingredient snapshot rows", () => {
        const result = buildIngredientPlanForCart({
            cart: [{
                productId: "prod-burger",
                snapshotName: "Burger",
                quantity: 2
            }],
            productById: new Map([
                ["prod-burger", {
                    _id: "prod-burger",
                    name: "Burger",
                    recipeItems: [
                        { ingredientId: "ing-bread", quantity: 1 },
                        { ingredientId: "ing-meat", quantity: 2 },
                    ]
                }]
            ]),
            ingredientById: new Map([
                ["ing-bread", { _id: "ing-bread", name: "Pane" }],
                ["ing-meat", { _id: "ing-meat", name: "Carne", shortName: "CARNE" }],
            ])
        });

        expect(result).toEqual([
            {
                ingredientId: "ing-bread",
                snapshotName: "Pane",
                quantity: 2,
                sourceProductId: "prod-burger",
                sourceProductName: "Burger",
                legacy: false
            },
            {
                ingredientId: "ing-meat",
                snapshotName: "CARNE",
                quantity: 4,
                sourceProductId: "prod-burger",
                sourceProductName: "Burger",
                legacy: false
            }
        ]);
    });

    test("uses included menu components instead of the fixed menu container recipe", () => {
        const result = buildIngredientPlanForCart({
            cart: [{
                productId: "menu-1",
                snapshotName: "Menu Pesce",
                quantity: 2,
                includedComponents: [
                    { productId: "prod-fish", snapshotName: "Fritto", quantity: 1 },
                    { productId: "prod-side", snapshotName: "Patatine", quantity: 1 },
                ]
            }],
            productById: new Map([
                ["menu-1", {
                    _id: "menu-1",
                    name: "Menu Pesce",
                    recipeItems: [{ ingredientId: "ing-ignored", quantity: 99 }]
                }],
                ["prod-fish", {
                    _id: "prod-fish",
                    name: "Fritto",
                    recipeItems: [{ ingredientId: "ing-fish", quantity: 1 }]
                }],
                ["prod-side", {
                    _id: "prod-side",
                    name: "Patatine",
                    recipeItems: [{ ingredientId: "ing-potato", quantity: 2 }]
                }],
            ]),
            ingredientById: new Map([
                ["ing-fish", { _id: "ing-fish", name: "Pesce" }],
                ["ing-potato", { _id: "ing-potato", name: "Patatine" }],
                ["ing-ignored", { _id: "ing-ignored", name: "Da ignorare" }],
            ])
        });

        expect(result).toEqual([
            {
                ingredientId: "ing-fish",
                snapshotName: "Pesce",
                quantity: 2,
                sourceProductId: "prod-fish",
                sourceProductName: "Fritto",
                legacy: false
            },
            {
                ingredientId: "ing-potato",
                snapshotName: "Patatine",
                quantity: 4,
                sourceProductId: "prod-side",
                sourceProductName: "Patatine",
                legacy: false
            }
        ]);
    });

    test("falls back to a legacy entry when the product has no recipe", () => {
        const result = buildIngredientPlanForCart({
            cart: [{
                productId: "prod-cola",
                snapshotName: "Cola",
                quantity: 3
            }],
            productById: new Map([
                ["prod-cola", {
                    _id: "prod-cola",
                    name: "Cola",
                    recipeItems: []
                }]
            ]),
            ingredientById: new Map()
        });

        expect(result).toEqual([
            {
                snapshotName: "Cola",
                quantity: 3,
                sourceProductId: "prod-cola",
                sourceProductName: "Cola",
                legacy: true
            }
        ]);
    });
});

describe("ingredient queue aggregation", () => {
    test("aggregates shared ingredients across different orders and counts each order once", () => {
        const queue = aggregatePendingIngredientQueue([
            {
                ingredientPlan: [
                    {
                        ingredientId: "ing-potato",
                        snapshotName: "Patatine",
                        quantity: 2,
                        sourceProductId: "prod-fish",
                        sourceProductName: "Fritto",
                        legacy: false
                    },
                    {
                        ingredientId: "ing-potato",
                        snapshotName: "Patatine",
                        quantity: 1,
                        sourceProductId: "prod-side",
                        sourceProductName: "Contorno",
                        legacy: false
                    }
                ]
            },
            {
                ingredientPlan: [
                    {
                        ingredientId: "ing-potato",
                        snapshotName: "Patatine",
                        quantity: 4,
                        sourceProductId: "prod-side",
                        sourceProductName: "Contorno",
                        legacy: false
                    }
                ]
            }
        ]);

        expect(queue).toEqual([
            {
                ingredientKey: "ingredient:ing-potato",
                label: "Patatine",
                quantity: 7,
                orderCount: 2,
                legacy: false
            }
        ]);
    });

    test("keeps the persisted snapshot name stable after later catalog renames", () => {
        const queue = aggregatePendingIngredientQueue([
            {
                ingredientPlan: [
                    {
                        ingredientId: "ing-bread",
                        snapshotName: "Pane Burger",
                        quantity: 2,
                        sourceProductId: "prod-burger",
                        sourceProductName: "Burger",
                        legacy: false
                    }
                ]
            }
        ]);

        expect(queue[0]?.label).toBe("Pane Burger");
    });

    test("builds a legacy queue from historical pending orders without ingredientPlan", () => {
        const legacyPlan = buildLegacyIngredientPlanFromOrderCart([
            {
                productId: "prod-water",
                snapshotName: "Acqua",
                quantity: 2
            }
        ]);

        expect(legacyPlan).toEqual([
            {
                snapshotName: "Acqua",
                quantity: 2,
                sourceProductId: "prod-water",
                sourceProductName: "Acqua",
                legacy: true
            }
        ]);

        const queue = aggregatePendingIngredientQueue([
            {
                cart: [{
                    productId: "prod-water",
                    snapshotName: "Acqua",
                    quantity: 2
                }]
            }
        ]);

        expect(queue).toEqual([
            {
                ingredientKey: "legacy:prod-water",
                label: "Acqua",
                quantity: 2,
                orderCount: 1,
                legacy: true
            }
        ]);
    });

    test("attaches tracked stock information for catalog ingredients", () => {
        const queue = attachIngredientCatalogMetadata([
            {
                ingredientKey: "ingredient:ing-potato",
                label: "Patatine",
                quantity: 7,
                orderCount: 2,
                legacy: false
            },
            {
                ingredientKey: "legacy:prod-water",
                label: "Acqua",
                quantity: 2,
                orderCount: 1,
                legacy: true
            }
        ], new Map([
            ["ing-potato", { stockQuantity: 12, active: true }]
        ]))

        expect(queue).toEqual([
            {
                ingredientKey: "ingredient:ing-potato",
                label: "Patatine",
                quantity: 7,
                orderCount: 2,
                legacy: false,
                stockQuantity: 12,
                remainingStockQuantity: 5,
                active: true
            },
            {
                ingredientKey: "legacy:prod-water",
                label: "Acqua",
                quantity: 2,
                orderCount: 1,
                legacy: true
            }
        ])
    })
});
