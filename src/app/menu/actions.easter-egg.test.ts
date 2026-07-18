import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    dbConnectMock,
    eventFindOneMock,
    productFindMock,
    ingredientFindMock,
    orderCreateMock,
    routeOrderToPrintersMock,
    getNextPublicOrderNumberMock,
    getOrderCodeFromOrderMock,
    revalidatePathMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    eventFindOneMock: vi.fn(),
    productFindMock: vi.fn(),
    ingredientFindMock: vi.fn(),
    orderCreateMock: vi.fn(),
    routeOrderToPrintersMock: vi.fn(),
    getNextPublicOrderNumberMock: vi.fn(),
    getOrderCodeFromOrderMock: vi.fn(),
    revalidatePathMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }));
vi.mock("@/models/Event", () => ({ default: { findOne: eventFindOneMock } }));
vi.mock("@/models/Product", () => ({ default: { find: productFindMock } }));
vi.mock("@/models/Ingredient", () => ({ default: { find: ingredientFindMock } }));
vi.mock("@/models/Order", () => ({ default: { create: orderCreateMock } }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/printer", () => ({
    PrinterService: {
        routeOrderToPrinters: routeOrderToPrintersMock
    }
}));
vi.mock("@/lib/order-code", () => ({
    getNextPublicOrderNumber: getNextPublicOrderNumberMock,
    getOrderCodeFromOrder: getOrderCodeFromOrderMock
}));

import { createPublicOrder } from "@/app/menu/actions";

function mockEvent(enabled: boolean) {
    eventFindOneMock.mockReturnValue({
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                settings: { portalEasterEggEnabled: enabled }
            })
        })
    });
}

function mockProducts() {
    productFindMock.mockReturnValue({
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue([
                {
                    _id: "prod-1",
                    name: "Panino",
                    basePrice: 7,
                    kind: "STANDARD",
                    salesChannels: ["POS", "MENU"],
                    availableDays: [],
                    stockQuantity: null,
                    isSoldOut: false,
                }
            ])
        })
    });
}

function mockProductsWithFixedMenuCollision() {
    const collisionProducts = [
        {
            _id: "prod-main",
            name: "Panino",
            basePrice: 7,
            kind: "STANDARD",
            salesChannels: ["POS", "MENU"],
            availableDays: [],
            stockQuantity: 0,
            isSoldOut: true,
        },
        {
            _id: "menu-1",
            name: "Menu panino",
            basePrice: 12,
            kind: "FIXED_MENU",
            salesChannels: ["POS", "MENU"],
            availableDays: [],
            stockQuantity: null,
            isSoldOut: false,
            menuComponents: [{ productId: "prod-main", quantity: 1 }]
        }
    ];
    productFindMock
        .mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(collisionProducts)
            })
        })
        .mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: "prod-main",
                        name: "Panino"
                    }
                ])
            })
        })
        .mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(collisionProducts)
            })
        });
}

describe("createPublicOrder menu flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ingredientFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([])
            })
        });
        getNextPublicOrderNumberMock.mockResolvedValue(42);
        getOrderCodeFromOrderMock.mockReturnValue("W-0042");
        orderCreateMock.mockResolvedValue({
            _id: { toString: () => "order-1" },
            pickupNumber: 42,
            totalAmount: 7,
            customer: { name: "Mario" },
            cart: [
                {
                    snapshotName: "Panino",
                    quantity: 1,
                    selectedOptions: []
                }
            ]
        });
        routeOrderToPrintersMock.mockResolvedValue([true]);
    });

    test("rejects archived or missing events before reading the catalog", async () => {
        eventFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        });

        const result = await createPublicOrder({
            eventId: "archived-event",
            customer: {},
            totalAmount: 7,
            cart: [{
                productId: "prod-1",
                snapshotName: "Panino",
                quantity: 1,
                selectedOptions: []
            }]
        });

        expect(result).toEqual({ success: false, error: "Evento non valido" });
        expect(eventFindOneMock).toHaveBeenCalledWith({
            _id: "archived-event",
            archived: { $ne: true }
        });
        expect(productFindMock).not.toHaveBeenCalled();
    });

    test("returns an upload token when the feature is enabled on the event", async () => {
        mockEvent(true);
        mockProducts();

        const result = await createPublicOrder({
            eventId: "event-1",
            customer: { name: "Mario" },
            totalAmount: 7,
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Panino",
                    quantity: 1,
                    selectedOptions: []
                }
            ]
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.easterEggUpload?.orderId).toBe("order-1");
            expect(result.easterEggUpload?.token).toBeTruthy();
        }
        expect(orderCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            status: "PENDING",
            easterEggAttachment: expect.objectContaining({
                uploadTokenHash: expect.any(String)
            })
        }));
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled();
    });

    test("does not return upload token when the feature is disabled", async () => {
        mockEvent(false);
        mockProducts();

        const result = await createPublicOrder({
            eventId: "event-1",
            customer: {},
            totalAmount: 7,
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Panino",
                    quantity: 1,
                    selectedOptions: []
                }
            ]
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.easterEggUpload).toBeUndefined();
        }
        expect(orderCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            status: "PENDING",
            easterEggAttachment: undefined
        }));
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled();
    });

    test("keeps direct product stock data when the same product is also referenced by a menu", async () => {
        mockEvent(false);
        mockProductsWithFixedMenuCollision();

        const result = await createPublicOrder({
            eventId: "event-1",
            customer: { name: "Mario" },
            totalAmount: 19,
            cart: [
                {
                    productId: "prod-main",
                    snapshotName: "Panino",
                    quantity: 1,
                    selectedOptions: []
                },
                {
                    productId: "menu-1",
                    snapshotName: "Menu panino",
                    quantity: 1,
                    selectedOptions: [],
                    menuSelections: []
                }
            ]
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain("Scorte insufficienti");
        }
        expect(orderCreateMock).not.toHaveBeenCalled();
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled();
    });

    test("rejects pending menu orders when tracked ingredient stock is insufficient", async () => {
        mockEvent(false);
        productFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: "prod-1",
                        name: "Panino",
                        basePrice: 7,
                        kind: "STANDARD",
                        salesChannels: ["POS", "MENU"],
                        availableDays: [],
                        stockQuantity: null,
                        isSoldOut: false,
                        recipeItems: [{ ingredientId: "ing-1", quantity: 2 }]
                    }
                ])
            })
        });
        ingredientFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: "ing-1",
                        name: "Pane",
                        shortName: "Pane",
                        active: true,
                        stockQuantity: 1
                    }
                ])
            })
        });

        const result = await createPublicOrder({
            eventId: "event-1",
            customer: { name: "Mario" },
            totalAmount: 7,
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Panino",
                    quantity: 1,
                    selectedOptions: []
                }
            ]
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain("Scorte insufficienti");
            expect(result.stockShortages).toEqual([
                expect.objectContaining({
                    productId: "ing-1",
                    productName: "Pane",
                    requestedQuantity: 2,
                    availableQuantity: 1
                })
            ]);
        }
        expect(orderCreateMock).not.toHaveBeenCalled();
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled();
    });
});
