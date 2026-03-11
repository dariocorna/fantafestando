import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    dbConnectMock,
    orderFindByIdMock,
    eventFindByIdMock,
    posDeviceFindByIdMock,
    productFindMock,
    categoryFindMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    orderFindByIdMock: vi.fn(),
    eventFindByIdMock: vi.fn(),
    posDeviceFindByIdMock: vi.fn(),
    productFindMock: vi.fn(),
    categoryFindMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/Order", () => ({
    default: {
        findById: orderFindByIdMock
    }
}));

vi.mock("@/models/Event", () => ({
    default: {
        findById: eventFindByIdMock
    }
}));

vi.mock("@/models/PosDevice", () => ({
    default: {
        findById: posDeviceFindByIdMock
    }
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

vi.mock("@/models/PrintJob", () => ({
    default: {}
}));

import { PrinterService } from "@/lib/printer";

function mockOrder(order: unknown) {
    orderFindByIdMock.mockReturnValue({
        lean: vi.fn().mockResolvedValue(order)
    });
}

function buildOrder(orderId: string) {
    return {
        _id: { toString: () => orderId },
        eventId: { toString: () => "evt-1" },
        pickupNumber: 42,
        status: "PAID",
        paymentMethod: "CASH",
        totalAmount: 7,
        customer: { name: "Mario", table: "A1" },
        cart: [
            {
                productId: "prod-1",
                snapshotName: "Panino",
                quantity: 1,
                selectedOptions: []
            }
        ]
    };
}

function mockEvent(event: unknown) {
    eventFindByIdMock.mockReturnValue({
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(event)
        })
    });
}

function mockPosDevice(posDevice: unknown) {
    posDeviceFindByIdMock.mockReturnValue({
        populate: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(posDevice)
        })
    });
}

function mockProducts(products: unknown[]) {
    productFindMock.mockReturnValue({
        lean: vi.fn().mockResolvedValue(products)
    });
}

function mockCategories(categories: unknown[]) {
    categoryFindMock.mockReturnValue({
        populate: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(categories)
        })
    });
}

describe("PrinterService.routeOrderToPrinters", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("serializes cashier summary and customer copy when they share the same printer", async () => {
        vi.useFakeTimers();
        mockOrder(buildOrder("order-1"));
        mockEvent({ name: "Festa dell'Oratorio 2026", settings: {} });
        mockPosDevice({
            printerId: {
                _id: "cashier-printer-1",
                ip: "192.168.178.203",
                port: 9100,
                isVirtual: false
            }
        });
        mockProducts([
            {
                _id: { toString: () => "prod-1" },
                categoryId: { toString: () => "cat-1" },
                basePrice: 7
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-1" }
            }
        ]);

        let callCount = 0;
        let secondStartedBeforeFirstResolved = false;
        let firstResolvedAt = 0;

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockImplementation(async () => {
            callCount += 1;
            if (callCount === 1) {
                firstResolvedAt = Date.now();
                return true;
            }

            secondStartedBeforeFirstResolved = (Date.now() - firstResolvedAt) < 1000;
            return true;
        });

        const resultPromise = PrinterService.routeOrderToPrinters("order-1", "pos-1");
        await vi.advanceTimersByTimeAsync(0);
        expect(printComandaSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(999);
        expect(printComandaSpy).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        const result = await resultPromise;
        vi.useRealTimers();

        expect(result).toEqual([true, true]);
        expect(secondStartedBeforeFirstResolved).toBe(false);
        expect(printComandaSpy).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ printType: "CASHIER_SUMMARY", ip: "192.168.178.203", port: 9100 }),
            1
        );
        expect(printComandaSpy).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ printType: "CUSTOMER_ORDER", ip: "192.168.178.203", port: 9100 }),
            1
        );
    });

    test("serializes jobs across concurrent orders that target the same printer", async () => {
        vi.useFakeTimers();
        orderFindByIdMock.mockImplementation((orderId: string) => ({
            lean: vi.fn().mockResolvedValue(buildOrder(orderId))
        }));
        mockEvent({ name: "Festa dell'Oratorio 2026", settings: {} });
        mockPosDevice({
            printerId: {
                _id: "cashier-printer-1",
                ip: "192.168.178.203",
                port: 9100,
                isVirtual: false
            }
        });
        mockProducts([
            {
                _id: { toString: () => "prod-1" },
                categoryId: { toString: () => "cat-1" },
                basePrice: 7
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-1" }
            }
        ]);

        let releaseFirstCall: (() => void) | undefined;
        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockImplementation(async (job) => {
            if (printComandaSpy.mock.calls.length === 1) {
                await new Promise<void>((resolve) => {
                    releaseFirstCall = resolve;
                });
            }

            return true;
        });

        const firstOrderPromise = PrinterService.routeOrderToPrinters("order-1", "pos-1");
        const secondOrderPromise = PrinterService.routeOrderToPrinters("order-2", "pos-1");

        await vi.advanceTimersByTimeAsync(0);
        expect(printComandaSpy).toHaveBeenCalledTimes(1);
        expect(printComandaSpy.mock.calls[0]?.[0]).toMatchObject({ orderId: "order-1" });

        releaseFirstCall?.();
        await vi.advanceTimersByTimeAsync(999);
        expect(printComandaSpy).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(printComandaSpy).toHaveBeenCalledTimes(2);
        expect(printComandaSpy.mock.calls[1]?.[0]).toMatchObject({ orderId: "order-1" });

        await vi.advanceTimersByTimeAsync(999);
        expect(printComandaSpy).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(printComandaSpy).toHaveBeenCalledTimes(3);
        expect(printComandaSpy.mock.calls[2]?.[0]).toMatchObject({ orderId: "order-2" });

        await vi.advanceTimersByTimeAsync(1000);
        const [firstResult, secondResult] = await Promise.all([firstOrderPromise, secondOrderPromise]);
        vi.useRealTimers();

        expect(firstResult).toEqual([true, true]);
        expect(secondResult).toEqual([true, true]);
        expect(printComandaSpy).toHaveBeenNthCalledWith(
            4,
            expect.objectContaining({ orderId: "order-2", printType: "CUSTOMER_ORDER" }),
            1
        );
    });
});
