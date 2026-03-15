import { beforeEach, describe, expect, test, vi } from "vitest";
import { getThermalContentWidth } from "@/lib/easter-egg-config";

const {
    dbConnectMock,
    orderFindByIdMock,
    orderUpdateOneMock,
    eventFindByIdMock,
    posDeviceFindByIdMock,
    productFindMock,
    categoryFindMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    orderFindByIdMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
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
        findById: orderFindByIdMock,
        updateOne: orderUpdateOneMock
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

function getPrintedItemNames(job: { items?: Array<{ name?: string }> }) {
    return (job.items || []).map((item) => item.name).filter(Boolean);
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
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true });
    });

    test("keeps only cashier summary and customer copy when no department printer is configured", async () => {
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

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);
        const result = await PrinterService.routeOrderToPrinters("order-1", "pos-1");

        expect(result).toEqual([true, true]);
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
        await vi.advanceTimersByTimeAsync(0);
        expect(printComandaSpy).toHaveBeenCalledTimes(2);
        expect(printComandaSpy.mock.calls[1]?.[0]).toMatchObject({ orderId: "order-1", printType: "CUSTOMER_ORDER" });

        await vi.advanceTimersByTimeAsync(999);
        expect(printComandaSpy).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        const [firstResult, secondResult] = await Promise.all([firstOrderPromise, secondOrderPromise]);
        vi.useRealTimers();

        expect(firstResult).toEqual([true, true]);
        expect(secondResult).toEqual([true, true]);
        expect(printComandaSpy.mock.calls.slice(0, 2).every(([job]) => job.orderId === "order-1")).toBe(true);
        expect(printComandaSpy.mock.calls.slice(2).every(([job]) => job.orderId === "order-2")).toBe(true);
        expect(printComandaSpy).toHaveBeenNthCalledWith(
            4,
            expect.objectContaining({ orderId: "order-2", printType: "CUSTOMER_ORDER" }),
            1
        );
    });

    test("keeps customer copies separated for categories without a kitchen printer", async () => {
        mockOrder({
            _id: { toString: () => "order-3" },
            eventId: { toString: () => "evt-1" },
            pickupNumber: 43,
            status: "PAID",
            paymentMethod: "CASH",
            totalAmount: 11,
            customer: { name: "Mario", table: "A1" },
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Panino",
                    quantity: 1,
                    selectedOptions: []
                },
                {
                    productId: "prod-2",
                    snapshotName: "Patatine",
                    quantity: 1,
                    selectedOptions: []
                }
            ]
        });
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
            },
            {
                _id: { toString: () => "prod-2" },
                categoryId: { toString: () => "cat-2" },
                basePrice: 4
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-1" },
                name: "Cucina"
            },
            {
                _id: { toString: () => "cat-2" },
                name: "Friggitoria"
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-3", "pos-1");

        expect(result).toEqual([true, true, true]);

        const kitchenJobs = printComandaSpy.mock.calls
            .map(([job]) => job)
            .filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = printComandaSpy.mock.calls
            .map(([job]) => job)
            .filter((job) => job.printType === "CUSTOMER_ORDER");

        expect(kitchenJobs).toHaveLength(0);
        expect(customerJobs).toHaveLength(2);
        expect(customerJobs.map((job) => getPrintedItemNames(job)).sort()).toEqual([["Panino"], ["Patatine"]]);
        expect(customerJobs.every((job) => job.ip === "192.168.178.203")).toBe(true);
    });

    test("keeps dedicated kitchen prints and customer copies distinct when another category has no department printer", async () => {
        mockOrder({
            _id: { toString: () => "order-4" },
            eventId: { toString: () => "evt-1" },
            pickupNumber: 44,
            status: "PAID",
            paymentMethod: "CASH",
            totalAmount: 11,
            customer: { name: "Mario", table: "A1" },
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Panino",
                    quantity: 1,
                    selectedOptions: []
                },
                {
                    productId: "prod-2",
                    snapshotName: "Patatine",
                    quantity: 1,
                    selectedOptions: []
                }
            ]
        });
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
            },
            {
                _id: { toString: () => "prod-2" },
                categoryId: { toString: () => "cat-2" },
                basePrice: 4
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-1" },
                name: "Griglia",
                printerId: {
                    _id: "kitchen-printer-1",
                    name: "Stampante Griglia",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            },
            {
                _id: { toString: () => "cat-2" },
                name: "Friggitoria"
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-4", "pos-1");

        expect(result).toEqual([true, true, true, true]);

        const kitchenJobs = printComandaSpy.mock.calls
            .map(([job]) => job)
            .filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = printComandaSpy.mock.calls
            .map(([job]) => job)
            .filter((job) => job.printType === "CUSTOMER_ORDER");

        expect(kitchenJobs).toHaveLength(1);
        expect(customerJobs).toHaveLength(2);
        expect(kitchenJobs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ip: "192.168.178.210",
                    items: [expect.objectContaining({ name: "Panino" })]
                })
            ])
        );
        expect(customerJobs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ items: [expect.objectContaining({ name: "Panino" })] }),
                expect.objectContaining({ items: [expect.objectContaining({ name: "Patatine" })] })
            ])
        );
    });

    test("fails fast on remaining jobs that share a destination after the first failure", async () => {
        mockOrder(buildOrder("order-5"));
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
                _id: { toString: () => "cat-1" },
                name: "Cucina"
            }
        ]);

        let callIndex = 0;
        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockImplementation(async (_job, _copies, options) => {
            callIndex += 1;
            if (callIndex === 1) return false;
            return options?.immediateFailureReason ? false : true;
        });

        const result = await PrinterService.routeOrderToPrinters("order-5", "pos-1");

        expect(result).toEqual([false, false]);
        expect(printComandaSpy).toHaveBeenCalledTimes(2);
        expect(printComandaSpy.mock.calls[1]?.[2]).toEqual(
            expect.objectContaining({ immediateFailureReason: "Skipped after previous destination failure" })
        );
    });

    test("prints the easter egg raster on cashier close and clears the stored binary after success", async () => {
        const rasterWidth = getThermalContentWidth();
        const rasterBuffer = Buffer.alloc((rasterWidth / 8) * 12, 0xaa);
        mockOrder({
            ...buildOrder("order-raster"),
            easterEggAttachment: {
                rasterWidth,
                rasterHeight: 12,
                rasterData: {
                    buffer: rasterBuffer,
                    sub_type: 0,
                    position: rasterBuffer.length
                }
            }
        });
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

        vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);
        const printRasterSpy = vi.spyOn(PrinterService, "printRasterImage").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-raster", "pos-1");

        expect(result).toEqual([true, true, true]);
        expect(printRasterSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                orderId: "order-raster",
                printType: "EASTER_EGG_IMAGE",
                ip: "192.168.178.203"
            }),
            expect.objectContaining({
                width: rasterWidth,
                height: 12
            }),
            1,
            undefined
        );
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: expect.anything() },
            {
                $set: {
                    "easterEggAttachment.printedAt": expect.any(Date)
                },
                $unset: {
                    "easterEggAttachment.rasterData": 1,
                    "easterEggAttachment.uploadTokenHash": 1
                }
            }
        );
    });
});
