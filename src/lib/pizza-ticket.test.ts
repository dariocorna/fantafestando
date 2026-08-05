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
    normalizePizzaTicket,
    resolvePizzaEligibleProductIds,
    resolvePizzaTicketForCart
} from "./pizza-ticket";
import {
    getPizzaBarcodeValue,
    parsePizzaBarcodeValue,
    parsePizzaOrderIdValue
} from "./pizza-barcode";

const EVENT_ID = "507f1f77bcf86cd799439099";

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

        const result = await resolvePizzaEligibleProductIds(EVENT_ID, [
            { productId: "prod-pizza" },
            { productId: "prod-drink" }
        ]);

        expect(dbConnectMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual(new Set(["prod-pizza"]));
    });

    test("returns no pizza products and skips db lookups when eventId is not a Mongo ObjectId", async () => {
        const result = await resolvePizzaEligibleProductIds("event-1", [
            { productId: "prod-pizza" }
        ]);

        expect(result).toEqual(new Set());
        expect(dbConnectMock).not.toHaveBeenCalled();
        expect(productFindMock).not.toHaveBeenCalled();
        expect(categoryFindMock).not.toHaveBeenCalled();
    });

    test("allocates a single pizza ticket for orders with pizza products", async () => {
        mockProducts([
            { _id: "prod-pizza-a", categoryId: "cat-pizza" },
            { _id: "prod-pizza-b", categoryId: "cat-pizza" }
        ]);
        mockCategories([{ _id: "cat-pizza" }]);

        const result = await resolvePizzaTicketForCart(EVENT_ID, [
            { productId: "prod-pizza-a" },
            { productId: "prod-pizza-b" }
        ]);

        expect(result).toEqual({
            pizzaNumber: 77,
            state: "QUEUED"
        });
        expect(getNextPizzaOrderNumberMock).toHaveBeenCalledTimes(1);
    });

    test("uses one shared sequence across different numbered categories", async () => {
        mockProducts([
            { _id: "prod-calamari", categoryId: "cat-calamari" },
            { _id: "prod-pizza", categoryId: "cat-pizza" }
        ]);
        mockCategories([
            { _id: "cat-calamari" },
            { _id: "cat-pizza" }
        ]);
        getNextPizzaOrderNumberMock
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(3);

        await expect(resolvePizzaTicketForCart(EVENT_ID, [
            { productId: "prod-calamari" }
        ])).resolves.toMatchObject({ pizzaNumber: 1 });
        await expect(resolvePizzaTicketForCart(EVENT_ID, [
            { productId: "prod-pizza" }
        ])).resolves.toMatchObject({ pizzaNumber: 2 });
        await expect(resolvePizzaTicketForCart(EVENT_ID, [
            { productId: "prod-calamari" }
        ])).resolves.toMatchObject({ pizzaNumber: 3 });
        expect(getNextPizzaOrderNumberMock).toHaveBeenCalledTimes(3);
    });

    test("does not allocate a pizza ticket when no pizza category is involved", async () => {
        mockProducts([
            { _id: "prod-burger", categoryId: "cat-kitchen" }
        ]);
        mockCategories([]);

        await expect(resolvePizzaTicketForCart(EVENT_ID, [
            { productId: "prod-burger" }
        ])).resolves.toBeUndefined();
        expect(getNextPizzaOrderNumberMock).not.toHaveBeenCalled();
    });

    test("derives pizza eligibility from fixed-menu included components", async () => {
        mockProducts([
            { _id: "prod-pizza", categoryId: "cat-pizza" }
        ]);
        mockCategories([{ _id: "cat-pizza" }]);

        const result = await resolvePizzaTicketForCart(EVENT_ID, [
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
            EVENT_ID,
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

    test("preserves manually removed pizza tickets without reallocating a number", async () => {
        mockProducts([
            { _id: "prod-pizza", categoryId: "cat-pizza" }
        ]);
        mockCategories([{ _id: "cat-pizza" }]);

        const result = await resolvePizzaTicketForCart(
            EVENT_ID,
            [{ productId: "prod-pizza" }],
            {
                pizzaNumber: 13,
                state: "REMOVED"
            }
        );

        expect(result).toEqual({
            pizzaNumber: 13,
            state: "REMOVED",
            readyAt: undefined
        });
        expect(getNextPizzaOrderNumberMock).not.toHaveBeenCalled();
    });

    test("normalizes, formats and parses pizza barcode values", () => {
        expect(normalizePizzaTicket({ pizzaNumber: 8, state: "QUEUED" })).toEqual({
            pizzaNumber: 8,
            state: "QUEUED",
            readyAt: undefined
        });
        expect(normalizePizzaTicket({ pizzaNumber: 8, state: "REMOVED" })).toEqual({
            pizzaNumber: 8,
            state: "REMOVED",
            readyAt: undefined
        });
        expect(getPizzaBarcodeValue(42)).toBe("00000420");
        expect(parsePizzaOrderIdValue("507f1f77bcf86cd799439011")).toEqual({
            orderId: "507f1f77bcf86cd799439011"
        });
        expect(parsePizzaBarcodeValue("42")).toEqual({
            pizzaNumber: 42
        });
        expect(parsePizzaBarcodeValue("00000420")).toEqual({
            pizzaNumber: 42
        });
        expect(parsePizzaBarcodeValue("00000042")).toBeNull();
        expect(parsePizzaBarcodeValue("PZ:507f1f77bcf86cd799439011")).toEqual({
            orderId: "507f1f77bcf86cd799439011"
        });
        expect(parsePizzaOrderIdValue("abc")).toBeNull();
        expect(parsePizzaBarcodeValue("PZ:abc")).toBeNull();
        expect(parsePizzaBarcodeValue("ABC")).toBeNull();
    });
});
