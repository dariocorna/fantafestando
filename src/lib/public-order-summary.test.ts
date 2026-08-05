import { describe, expect, test } from "vitest";
import { buildPublicOrderSummary } from "./public-order-summary";

describe("buildPublicOrderSummary", () => {
    test("keeps one public number for each numbered product", () => {
        const summary = buildPublicOrderSummary({
            _id: "507f1f77bcf86cd799439011",
            pickupNumber: 12,
            dishTickets: [
                { productId: "prod-calamari", snapshotName: " Calamari ", pizzaNumber: 41 },
                { productId: "prod-arrosticini", snapshotName: "Arrosticini", pizzaNumber: 42 },
                { productId: "", snapshotName: "Non valido", pizzaNumber: 43 }
            ],
            totalAmount: 18,
            cart: []
        });

        expect(summary.dishTickets).toEqual([
            { productId: "prod-calamari", productName: "Calamari", pizzaNumber: 41 },
            { productId: "prod-arrosticini", productName: "Arrosticini", pizzaNumber: 42 }
        ]);
    });
});
