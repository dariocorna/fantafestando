import { beforeEach, describe, expect, test, vi } from "vitest";

const { dbConnectMock, productFindMock, categoryFindMock, getNextPizzaOrderNumbersMock } = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    productFindMock: vi.fn(),
    categoryFindMock: vi.fn(),
    getNextPizzaOrderNumbersMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }));
vi.mock("@/models/Product", () => ({ default: { find: productFindMock } }));
vi.mock("@/models/Category", () => ({ default: { find: categoryFindMock } }));
vi.mock("@/lib/order-code", () => ({ getNextPizzaOrderNumbers: getNextPizzaOrderNumbersMock }));

import {
    extractProductionProductIds,
    normalizeDishTicket,
    resolveDishTicketsForCart,
    resolvePizzaEligibleProductIds
} from "./pizza-ticket";
import { getPizzaBarcodeValue, parsePizzaBarcodeValue } from "./pizza-barcode";

const EVENT_ID = "507f1f77bcf86cd799439099";

function mockProducts(products: unknown[]) {
    productFindMock.mockReturnValue({
        select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(products) })
    });
}

function mockCategories(categories: unknown[]) {
    categoryFindMock.mockReturnValue({
        select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(categories) })
    });
}

describe("dish ticket helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getNextPizzaOrderNumbersMock.mockImplementation(async (_eventId: string, count: number) =>
            Array.from({ length: count }, (_, index) => 77 + index)
        );
    });

    test("extracts each effective production product once", () => {
        expect(extractProductionProductIds([
            {
                productId: "menu-1",
                includedComponents: [
                    { productId: "pizza-1" },
                    { productId: "drink-1" }
                ]
            },
            { productId: "pizza-1", quantity: 3 }
        ])).toEqual(["pizza-1", "drink-1"]);
    });

    test("resolves products in numbered categories", async () => {
        mockProducts([
            { _id: "prod-calamari", categoryId: "cat-calamari" },
            { _id: "prod-drink", categoryId: "cat-bar" }
        ]);
        mockCategories([{ _id: "cat-calamari" }]);

        await expect(resolvePizzaEligibleProductIds(EVENT_ID, [
            { productId: "prod-calamari" },
            { productId: "prod-drink" }
        ])).resolves.toEqual(new Set(["prod-calamari"]));
    });

    test("allocates one global number per distinct numbered product", async () => {
        mockProducts([
            { _id: "prod-calamari", categoryId: "cat-calamari" },
            { _id: "prod-arrosticini", categoryId: "cat-arrosticini" }
        ]);
        mockCategories([{ _id: "cat-calamari" }, { _id: "cat-arrosticini" }]);

        await expect(resolveDishTicketsForCart(EVENT_ID, [
            { productId: "prod-calamari", snapshotName: "Calamari", quantity: 2 },
            { productId: "prod-arrosticini", snapshotName: "Arrosticini" },
            { productId: "prod-calamari", snapshotName: "Calamari" }
        ])).resolves.toEqual([
            { productId: "prod-calamari", snapshotName: "Calamari", pizzaNumber: 77, state: "QUEUED" },
            { productId: "prod-arrosticini", snapshotName: "Arrosticini", pizzaNumber: 78, state: "QUEUED" }
        ]);
        expect(getNextPizzaOrderNumbersMock).toHaveBeenCalledWith(EVENT_ID, 2);
    });

    test("reuses retained tickets and allocates only newly added products", async () => {
        mockProducts([
            { _id: "prod-calamari", categoryId: "cat-numbered" },
            { _id: "prod-arrosticini", categoryId: "cat-numbered" }
        ]);
        mockCategories([{ _id: "cat-numbered" }]);

        const result = await resolveDishTicketsForCart(
            EVENT_ID,
            [
                { productId: "prod-calamari", snapshotName: "Calamari" },
                { productId: "prod-arrosticini", snapshotName: "Arrosticini" }
            ],
            [{
                productId: "prod-calamari",
                snapshotName: "Calamari",
                pizzaNumber: 13,
                state: "READY",
                readyAt: "2026-03-26T12:10:00.000Z"
            }]
        );

        expect(result).toEqual([
            {
                productId: "prod-calamari",
                snapshotName: "Calamari",
                pizzaNumber: 13,
                state: "READY",
                readyAt: new Date("2026-03-26T12:10:00.000Z")
            },
            { productId: "prod-arrosticini", snapshotName: "Arrosticini", pizzaNumber: 77, state: "QUEUED" }
        ]);
        expect(getNextPizzaOrderNumbersMock).toHaveBeenCalledWith(EVENT_ID, 1);
    });

    test("drops tickets for products removed from a pending order", async () => {
        mockProducts([{ _id: "prod-calamari", categoryId: "cat-numbered" }]);
        mockCategories([{ _id: "cat-numbered" }]);

        const result = await resolveDishTicketsForCart(
            EVENT_ID,
            [{ productId: "prod-calamari", snapshotName: "Calamari" }],
            [
                { productId: "prod-calamari", snapshotName: "Calamari", pizzaNumber: 13, state: "QUEUED" },
                { productId: "prod-removed", snapshotName: "Rimosso", pizzaNumber: 14, state: "QUEUED" }
            ]
        );

        expect(result).toHaveLength(1);
        expect(result[0].productId).toBe("prod-calamari");
        expect(getNextPizzaOrderNumbersMock).toHaveBeenCalledWith(EVENT_ID, 0);
    });

    test("creates no tickets for standard products or invalid events", async () => {
        mockProducts([{ _id: "prod-burger", categoryId: "cat-kitchen" }]);
        mockCategories([]);
        await expect(resolveDishTicketsForCart(EVENT_ID, [{ productId: "prod-burger" }])).resolves.toEqual([]);
        await expect(resolvePizzaEligibleProductIds("event-1", [{ productId: "prod-burger" }])).resolves.toEqual(new Set());
    });

    test("derives numbered products from fixed-menu components", async () => {
        mockProducts([{ _id: "prod-calamari", categoryId: "cat-numbered" }]);
        mockCategories([{ _id: "cat-numbered" }]);

        await expect(resolveDishTicketsForCart(EVENT_ID, [{
            productId: "menu-1",
            includedComponents: [{ productId: "prod-calamari", snapshotName: "Calamari" }]
        }])).resolves.toEqual([
            { productId: "prod-calamari", snapshotName: "Calamari", pizzaNumber: 77, state: "QUEUED" }
        ]);
    });

    test("normalizes tickets and preserves barcode format", () => {
        expect(normalizeDishTicket({
            productId: "prod-calamari",
            snapshotName: "Calamari",
            pizzaNumber: 8,
            state: "REMOVED"
        })).toEqual({
            productId: "prod-calamari",
            snapshotName: "Calamari",
            pizzaNumber: 8,
            state: "REMOVED",
            readyAt: undefined
        });
        expect(getPizzaBarcodeValue(42)).toBe("00000420");
        expect(parsePizzaBarcodeValue("00000420")).toEqual({ pizzaNumber: 42 });
    });
});
