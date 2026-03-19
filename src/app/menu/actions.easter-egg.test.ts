import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    dbConnectMock,
    eventFindByIdMock,
    productFindMock,
    orderCreateMock,
    routeOrderToPrintersMock,
    getNextPublicOrderNumberMock,
    getOrderCodeFromOrderMock,
    revalidatePathMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    eventFindByIdMock: vi.fn(),
    productFindMock: vi.fn(),
    orderCreateMock: vi.fn(),
    routeOrderToPrintersMock: vi.fn(),
    getNextPublicOrderNumberMock: vi.fn(),
    getOrderCodeFromOrderMock: vi.fn(),
    revalidatePathMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }));
vi.mock("@/models/Event", () => ({ default: { findById: eventFindByIdMock } }));
vi.mock("@/models/Product", () => ({ default: { find: productFindMock } }));
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
    eventFindByIdMock.mockReturnValue({
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
    productFindMock
        .mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
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
                ])
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
        });
}

describe("createPublicOrder menu flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
