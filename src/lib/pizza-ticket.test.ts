import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    dbConnectMock,
    productFindMock,
    categoryFindMock,
    getNextPizzaOrderNumberMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    productFindMock: vi.fn(),
    categoryFindMock: vi.fn(),
    getNextPizzaOrderNumberMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/Product", () => ({
    default: {
        find: productFindMock
    }
}));

vi.mock("@/models/Category", () => ({
    default: {
        find: categoryFindMock
    }
}));

vi.mock("@/lib/order-code", () => ({
    getNextPizzaOrderNumber: getNextPizzaOrderNumberMock
}));

import {
    extractProductionProductIds,
    getPizzaBarcodeValue,
    normalizePizzaTicket,
    parsePizzaBarcodeValue,
    parsePizzaOrderIdValue,
    resolvePizzaEligibleProductIds,
    resolvePizzaTicketForCart
} from "./pizza-ticket";

function mockProducts(products: unknown[]) {
    productFindMock.mockReturnValue({
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(products)
        })
    });
}

function mockCategories(categories: unknown[]) {
    categoryFindMock.mockReturnValue({
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(categories)
        })
    });
}

describe("pizza-ticket helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getNextPizzaOrderNumberMock.mockResolvedValue(77);
    });

    test("extracts effective production product ids using menu components when present", () => {
        expect(extractProductionProductIds([
            {
                productId: "menu-1",
                includedComponents: [
                    { productId: "pizza-1" },
                    { productId: "drink-1" }
                ]
            },
            {
                productId: "pizza-1"
            }
        ])).toEqual(["pizza-1", "drink-1"]);
    });

    test("resolves pizza eligible products from categories marked for pizza flow", async () => {
        mockProducts([
            { _id: "prod-pizza", categoryId: "cat-pizza" },
            { _id: "prod-drink", categoryId: "cat-bar" }
        ]);
        mockCategories([
            { _id: "cat-pizza" }
        ]);

        const result = await resolvePizzaEligibleProductIds("evt-1", [
            { productId: "prod-pizza" },
            { productId: "prod-drink" }
        ]);

        expect(dbConnectMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual(new Set(["prod-pizza"]));
    });

    test("allocates a single pizza ticket for orders with pizza products", async () => {
        mockProducts([
            { _id: "prod-pizza-a", categoryId: "cat-pizza" },
            { _id: "prod-pizza-b", categoryId: "cat-pizza" }
        ]);
        mockCategories([{ _id: "cat-pizza" }]);

        const result = await resolvePizzaTicketForCart("evt-1", [
            { productId: "prod-pizza-a" },
            { productId: "prod-pizza-b" }
        ]);

        expect(result).toEqual({
            pizzaNumber: 77,
            state: "QUEUED"
        });
        expect(getNextPizzaOrderNumberMock).toHaveBeenCalledTimes(1);
    });

    test("does not allocate a pizza ticket when no pizza category is involved", async () => {
        mockProducts([
            { _id: "prod-burger", categoryId: "cat-kitchen" }
        ]);
        mockCategories([]);

        await expect(resolvePizzaTicketForCart("evt-1", [
            { productId: "prod-burger" }
        ])).resolves.toBeUndefined();
        expect(getNextPizzaOrderNumberMock).not.toHaveBeenCalled();
    });

    test("derives pizza eligibility from fixed-menu included components", async () => {
        mockProducts([
            { _id: "prod-pizza", categoryId: "cat-pizza" }
        ]);
        mockCategories([{ _id: "cat-pizza" }]);

        const result = await resolvePizzaTicketForCart("evt-1", [
            {
                productId: "menu-1",
                includedComponents: [
                    { productId: "prod-pizza" }
                ]
            }
        ]);

        expect(result).toEqual({
            pizzaNumber: 77,
            state: "QUEUED"
        });
    });

    test("reuses an existing ready pizza ticket without allocating a new number", async () => {
        mockProducts([
            { _id: "prod-pizza", categoryId: "cat-pizza" }
        ]);
        mockCategories([{ _id: "cat-pizza" }]);

        const result = await resolvePizzaTicketForCart(
            "evt-1",
            [{ productId: "prod-pizza" }],
            {
                pizzaNumber: 13,
                state: "READY",
                readyAt: "2026-03-26T12:10:00.000Z"
            }
        );

        expect(result).toEqual({
            pizzaNumber: 13,
            state: "READY",
            readyAt: new Date("2026-03-26T12:10:00.000Z")
        });
        expect(getNextPizzaOrderNumberMock).not.toHaveBeenCalled();
    });

    test("normalizes, formats and parses pizza barcode values", () => {
        expect(normalizePizzaTicket({ pizzaNumber: 8, state: "QUEUED" })).toEqual({
            pizzaNumber: 8,
            state: "QUEUED",
            readyAt: undefined
        });
        expect(getPizzaBarcodeValue("507f1f77bcf86cd799439011")).toBe("PZ:507f1f77bcf86cd799439011");
        expect(parsePizzaOrderIdValue("507f1f77bcf86cd799439011")).toEqual({
            orderId: "507f1f77bcf86cd799439011"
        });
        expect(parsePizzaBarcodeValue("PZ:507f1f77bcf86cd799439011")).toEqual({
            orderId: "507f1f77bcf86cd799439011"
        });
        expect(parsePizzaOrderIdValue("abc")).toBeNull();
        expect(parsePizzaBarcodeValue("PZ:abc")).toBeNull();
        expect(parsePizzaBarcodeValue("ABC")).toBeNull();
    });
});
