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

function buildOrder(orderId: string, overrides?: Record<string, unknown>) {
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
        ],
        ...overrides
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

    test("skips all comanda copies when the category is marked as non printable", async () => {
        mockOrder(buildOrder("order-skip-single"));
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
                name: "Servizi",
                skipKitchenPrint: true,
                printerId: {
                    _id: "kitchen-printer-1",
                    name: "Stampante Servizi",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-skip-single", "pos-1");

        expect(result).toEqual([true]);
        expect(printComandaSpy).toHaveBeenCalledTimes(1);
        expect(printComandaSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                printType: "CASHIER_SUMMARY",
                items: [expect.objectContaining({ name: "Panino" })]
            }),
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
        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockImplementation(async () => {
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

    test("prints only the printable portion of a mixed order when another category skips comanda printing", async () => {
        mockOrder({
            _id: { toString: () => "order-mixed-skip" },
            eventId: { toString: () => "evt-1" },
            pickupNumber: 45,
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
                    snapshotName: "Servizio",
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
                name: "Servizi",
                skipKitchenPrint: true,
                printerId: {
                    _id: "kitchen-printer-2",
                    name: "Stampante Servizi",
                    ip: "192.168.178.211",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-mixed-skip", "pos-1");

        expect(result).toEqual([true, true, true]);

        const allJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const summaryJob = allJobs.find((job) => job.printType === "CASHIER_SUMMARY");
        const kitchenJobs = allJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = allJobs.filter((job) => job.printType === "CUSTOMER_ORDER");

        expect(getPrintedItemNames(summaryJob || {})).toEqual(["Panino", "Servizio"]);
        expect(kitchenJobs).toHaveLength(1);
        expect(customerJobs).toHaveLength(1);
        expect(getPrintedItemNames(kitchenJobs[0])).toEqual(["Panino"]);
        expect(getPrintedItemNames(customerJobs[0])).toEqual(["Panino"]);
    });

    test("keeps only the cashier summary when every category in the order skips comanda printing", async () => {
        mockOrder({
            _id: { toString: () => "order-all-skip" },
            eventId: { toString: () => "evt-1" },
            pickupNumber: 46,
            status: "PAID",
            paymentMethod: "CASH",
            totalAmount: 11,
            customer: { name: "Mario", table: "A1" },
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Servizio 1",
                    quantity: 1,
                    selectedOptions: []
                },
                {
                    productId: "prod-2",
                    snapshotName: "Servizio 2",
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
                name: "Servizi",
                skipKitchenPrint: true
            },
            {
                _id: { toString: () => "cat-2" },
                name: "Digital",
                skipKitchenPrint: true,
                printerId: {
                    _id: "kitchen-printer-2",
                    name: "Stampante Digital",
                    ip: "192.168.178.211",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-all-skip", "pos-1");

        expect(result).toEqual([true]);
        expect(printComandaSpy).toHaveBeenCalledTimes(1);
        expect(printComandaSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                printType: "CASHIER_SUMMARY",
                items: [
                    expect.objectContaining({ name: "Servizio 1" }),
                    expect.objectContaining({ name: "Servizio 2" })
                ]
            }),
            1
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

    test("adds the dish number to customer and department copies but not the cashier summary", async () => {
        mockOrder(buildOrder("order-pizza", {
            dishTickets: [{
                productId: "prod-1",
                snapshotName: "Panino",
                pizzaNumber: 81,
                state: "QUEUED"
            }]
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
                categoryId: { toString: () => "cat-pizza" },
                basePrice: 7,
                shortName: "PIZ"
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-pizza" },
                name: "Pizze",
                pizzaFlowEnabled: true,
                printerId: {
                    _id: "kitchen-printer-1",
                    name: "Forno",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-pizza", "pos-1");
        const printedJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const cashierJob = printedJobs.find((job) => job.printType === "CASHIER_SUMMARY");
        const kitchenJob = printedJobs.find((job) => job.printType === "KITCHEN_ORDER");
        const customerJob = printedJobs.find((job) => job.printType === "CUSTOMER_ORDER");

        expect(result).toEqual([true, true, true]);
        expect(printComandaSpy).toHaveBeenCalledTimes(3);
        expect(cashierJob).toEqual(expect.objectContaining({ printType: "CASHIER_SUMMARY" }));
        expect(cashierJob?.pizzaNumber).toBeUndefined();
        expect(cashierJob?.pizzaBarcodeValue).toBeUndefined();
        expect(kitchenJob).toEqual(expect.objectContaining({
            printType: "KITCHEN_ORDER",
            pizzaNumber: 81,
            pizzaBarcodeValue: "00000819"
        }));
        expect(customerJob).toEqual(expect.objectContaining({
            printType: "CUSTOMER_ORDER",
            pizzaNumber: 81
        }));
        expect(customerJob?.pizzaBarcodeValue).toBeUndefined();
    });

    test("keeps dish numbering on the customer copy but not the cashier summary without a department printer", async () => {
        mockOrder(buildOrder("order-pizza-cashier-only", {
            dishTickets: [{
                productId: "prod-1",
                snapshotName: "Panino",
                pizzaNumber: 81,
                state: "QUEUED"
            }]
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
                categoryId: { toString: () => "cat-pizza" },
                basePrice: 7,
                shortName: "PIZ"
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-pizza" },
                name: "Pizze",
                pizzaFlowEnabled: true
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-pizza-cashier-only", "pos-1");
        const printedJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const cashierJob = printedJobs.find((job) => job.printType === "CASHIER_SUMMARY");
        const kitchenJob = printedJobs.find((job) => job.printType === "KITCHEN_ORDER");
        const customerJob = printedJobs.find((job) => job.printType === "CUSTOMER_ORDER");

        expect(result).toEqual([true, true]);
        expect(printComandaSpy).toHaveBeenCalledTimes(2);
        expect(kitchenJob).toBeUndefined();
        expect(cashierJob).toEqual(expect.objectContaining({ printType: "CASHIER_SUMMARY" }));
        expect(cashierJob?.pizzaNumber).toBeUndefined();
        expect(cashierJob?.pizzaBarcodeValue).toBeUndefined();
        expect(customerJob).toEqual(expect.objectContaining({
            printType: "CUSTOMER_ORDER",
            pizzaNumber: 81,
            pizzaBarcodeValue: "00000819"
        }));
    });

    test("splits pizza and non-pizza kitchen jobs when they share the same printer", async () => {
        mockOrder(buildOrder("order-mixed-pizza", {
            cart: [
                {
                    productId: "prod-pizza",
                    snapshotName: "Margherita",
                    quantity: 1,
                    selectedOptions: []
                },
                {
                    productId: "prod-drink",
                    snapshotName: "Birra",
                    quantity: 1,
                    selectedOptions: []
                }
            ],
            dishTickets: [{
                productId: "prod-pizza",
                snapshotName: "Margherita",
                pizzaNumber: 81,
                state: "QUEUED"
            }]
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
                _id: { toString: () => "prod-pizza" },
                categoryId: { toString: () => "cat-pizza" },
                basePrice: 7
            },
            {
                _id: { toString: () => "prod-drink" },
                categoryId: { toString: () => "cat-bar" },
                basePrice: 4
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-pizza" },
                name: "Pizze",
                pizzaFlowEnabled: true,
                printerId: {
                    _id: "shared-kitchen-printer",
                    name: "Stampante Cucina",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            },
            {
                _id: { toString: () => "cat-bar" },
                name: "Bar",
                printerId: {
                    _id: "shared-kitchen-printer",
                    name: "Stampante Cucina",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-mixed-pizza", "pos-1");
        const printedJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const kitchenJobs = printedJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = printedJobs.filter((job) => job.printType === "CUSTOMER_ORDER");
        const pizzaKitchenJob = kitchenJobs.find((job) => getPrintedItemNames(job).includes("Margherita"));
        const standardKitchenJob = kitchenJobs.find((job) => getPrintedItemNames(job).includes("Birra"));
        const pizzaCustomerJob = customerJobs.find((job) => getPrintedItemNames(job).includes("Margherita"));
        const standardCustomerJob = customerJobs.find((job) => getPrintedItemNames(job).includes("Birra"));

        expect(result).toEqual([true, true, true, true, true]);
        expect(kitchenJobs).toHaveLength(2);
        expect(customerJobs).toHaveLength(2);
        expect(pizzaKitchenJob).toEqual(expect.objectContaining({
            items: [expect.objectContaining({ name: "Margherita" })],
            pizzaNumber: 81,
            pizzaBarcodeValue: "00000819"
        }));
        expect(standardKitchenJob).toEqual(expect.objectContaining({
            items: [expect.objectContaining({ name: "Birra" })]
        }));
        expect(standardKitchenJob?.pizzaNumber).toBeUndefined();
        expect(standardKitchenJob?.pizzaBarcodeValue).toBeUndefined();
        expect(pizzaCustomerJob).toEqual(expect.objectContaining({
            items: [expect.objectContaining({ name: "Margherita" })],
            pizzaNumber: 81
        }));
        expect(standardCustomerJob).toEqual(expect.objectContaining({
            items: [expect.objectContaining({ name: "Birra" })]
        }));
        expect(standardCustomerJob?.pizzaNumber).toBeUndefined();
    });

    test("assigns distinct numbers to pizza and calamari in the same order", async () => {
        mockOrder(buildOrder("order-mixed-numbered-dishes", {
            cart: [
                {
                    productId: "prod-pizza",
                    snapshotName: "Margherita",
                    quantity: 1,
                    selectedOptions: []
                },
                {
                    productId: "prod-calamari",
                    snapshotName: "Calamari fritti",
                    quantity: 1,
                    selectedOptions: []
                }
            ],
            dishTickets: [
                { productId: "prod-pizza", snapshotName: "Margherita", pizzaNumber: 81, state: "QUEUED" },
                { productId: "prod-calamari", snapshotName: "Calamari fritti", pizzaNumber: 82, state: "QUEUED" }
            ]
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
                _id: { toString: () => "prod-pizza" },
                categoryId: { toString: () => "cat-pizza" },
                basePrice: 7,
                shortName: "PIZ"
            },
            {
                _id: { toString: () => "prod-calamari" },
                categoryId: { toString: () => "cat-calamari" },
                basePrice: 9,
                shortName: "CALAMARI"
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-pizza" },
                name: "Pizze",
                pizzaFlowEnabled: true,
                printerId: {
                    _id: "pizza-printer",
                    name: "Forno",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            },
            {
                _id: { toString: () => "cat-calamari" },
                name: "Calamari",
                pizzaFlowEnabled: true,
                printerId: {
                    _id: "calamari-printer",
                    name: "Friggitoria",
                    ip: "192.168.178.211",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-mixed-numbered-dishes", "pos-1");
        const printedJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const cashierJob = printedJobs.find((job) => job.printType === "CASHIER_SUMMARY");
        const kitchenJobs = printedJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = printedJobs.filter((job) => job.printType === "CUSTOMER_ORDER");

        expect(result).toEqual([true, true, true, true, true]);
        expect(cashierJob?.pizzaNumber).toBeUndefined();
        expect(cashierJob?.pizzaBarcodeValue).toBeUndefined();
        expect(kitchenJobs).toHaveLength(2);
        expect(customerJobs).toHaveLength(2);
        expect(kitchenJobs.map((job) => job.pizzaNumber).sort()).toEqual([81, 82]);
        expect(kitchenJobs.map((job) => job.pizzaBarcodeValue).sort()).toEqual(["00000819", "00000826"]);
        expect(customerJobs.map((job) => job.pizzaNumber).sort()).toEqual([81, 82]);
        expect(customerJobs.every((job) => job.pizzaBarcodeValue === undefined)).toBe(true);
    });

    test("splits kitchen and customer jobs per unit when the product flag is enabled", async () => {
        mockOrder(buildOrder("order-split", {
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Patatine",
                    quantity: 10,
                    selectedOptions: []
                }
            ]
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
                basePrice: 4,
                shortName: "PAT",
                splitKitchenPrintPerUnit: true
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-1" },
                name: "Friggitoria",
                printerId: {
                    _id: "kitchen-printer-1",
                    name: "Stampante Friggitoria",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-split", "pos-1");
        const allJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const kitchenJobs = allJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = allJobs.filter((job) => job.printType === "CUSTOMER_ORDER");
        const cashierJob = allJobs.find((job) => job.printType === "CASHIER_SUMMARY");

        expect(result).toHaveLength(21);
        expect(cashierJob).toEqual(expect.objectContaining({
            printType: "CASHIER_SUMMARY",
            items: [expect.objectContaining({ name: "PAT", quantity: 10 })]
        }));
        expect(kitchenJobs).toHaveLength(10);
        expect(customerJobs).toHaveLength(10);
        expect(kitchenJobs.every((job) => job.items.length === 1 && job.items[0]?.quantity === 1)).toBe(true);
        expect(customerJobs.every((job) => job.items.length === 1 && job.items[0]?.quantity === 1)).toBe(true);
    });

    test("keeps default kitchen and customer grouping when the product flag is disabled", async () => {
        mockOrder(buildOrder("order-nosplit", {
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Patatine",
                    quantity: 10,
                    selectedOptions: []
                }
            ]
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
                basePrice: 4,
                shortName: "PAT",
                splitKitchenPrintPerUnit: false
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-1" },
                name: "Friggitoria",
                printerId: {
                    _id: "kitchen-printer-1",
                    name: "Stampante Friggitoria",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-nosplit", "pos-1");
        const allJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const kitchenJobs = allJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = allJobs.filter((job) => job.printType === "CUSTOMER_ORDER");

        expect(result).toEqual([true, true, true]);
        expect(kitchenJobs).toHaveLength(1);
        expect(customerJobs).toHaveLength(1);
        expect(kitchenJobs[0]?.items).toEqual([expect.objectContaining({ name: "PAT", quantity: 10 })]);
        expect(customerJobs[0]?.items).toEqual([expect.objectContaining({ name: "PAT", quantity: 10 })]);
    });

    test("splits only the products marked with separate per-unit printing", async () => {
        mockOrder(buildOrder("order-mixed-split", {
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Patatine",
                    quantity: 2,
                    selectedOptions: []
                },
                {
                    productId: "prod-2",
                    snapshotName: "Crocchette",
                    quantity: 2,
                    selectedOptions: []
                }
            ]
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
                basePrice: 4,
                shortName: "PAT",
                splitKitchenPrintPerUnit: true
            },
            {
                _id: { toString: () => "prod-2" },
                categoryId: { toString: () => "cat-1" },
                basePrice: 5,
                shortName: "CRO",
                splitKitchenPrintPerUnit: false
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-1" },
                name: "Friggitoria",
                printerId: {
                    _id: "kitchen-printer-1",
                    name: "Stampante Friggitoria",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-mixed-split", "pos-1");
        const allJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const kitchenJobs = allJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = allJobs.filter((job) => job.printType === "CUSTOMER_ORDER");

        expect(result).toHaveLength(7);
        expect(kitchenJobs).toHaveLength(3);
        expect(customerJobs).toHaveLength(3);
        expect(kitchenJobs.filter((job) => getPrintedItemNames(job)[0] === "PAT")).toHaveLength(2);
        expect(customerJobs.filter((job) => getPrintedItemNames(job)[0] === "PAT")).toHaveLength(2);
        expect(kitchenJobs.find((job) => getPrintedItemNames(job)[0] === "CRO")?.items).toEqual([
            expect.objectContaining({ name: "CRO", quantity: 2 })
        ]);
    });

    test("splits menu components per unit based on the printed component product flag", async () => {
        mockOrder(buildOrder("order-fixed-menu-split", {
            cart: [
                {
                    productId: "menu-1",
                    snapshotName: "Menu Degustazione",
                    quantity: 1,
                    selectedOptions: [],
                    includedComponents: [
                        {
                            productId: "prod-1",
                            snapshotName: "Nuggets",
                            quantity: 2,
                            source: "FIXED_ITEM"
                        }
                    ]
                }
            ]
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
                _id: { toString: () => "menu-1" },
                categoryId: { toString: () => "cat-menu" },
                basePrice: 12,
                shortName: "MENU",
                splitKitchenPrintPerUnit: false
            },
            {
                _id: { toString: () => "prod-1" },
                categoryId: { toString: () => "cat-1" },
                basePrice: 4,
                shortName: "NUG",
                splitKitchenPrintPerUnit: true
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-menu" },
                name: "Menu"
            },
            {
                _id: { toString: () => "cat-1" },
                name: "Friggitoria",
                printerId: {
                    _id: "kitchen-printer-1",
                    name: "Stampante Friggitoria",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-fixed-menu-split", "pos-1");
        const allJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const kitchenJobs = allJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = allJobs.filter((job) => job.printType === "CUSTOMER_ORDER");
        const cashierJob = allJobs.find((job) => job.printType === "CASHIER_SUMMARY");

        expect(result).toHaveLength(5);
        expect(cashierJob?.items).toEqual([expect.objectContaining({ name: "MENU", quantity: 1 })]);
        expect(kitchenJobs).toHaveLength(2);
        expect(customerJobs).toHaveLength(2);
        expect(kitchenJobs.every((job) => job.items[0]?.name === "NUG" && job.items[0]?.quantity === 1)).toBe(true);
        expect(customerJobs.every((job) => job.items[0]?.name === "NUG" && job.items[0]?.quantity === 1)).toBe(true);
    });

    test("keeps pizza metadata on each separated kitchen and customer copy", async () => {
        mockOrder(buildOrder("order-pizza-split", {
            dishTickets: [{
                productId: "prod-1",
                snapshotName: "Pizza Margherita",
                pizzaNumber: 88,
                state: "QUEUED"
            }],
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Pizza Margherita",
                    quantity: 2,
                    selectedOptions: []
                }
            ]
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
                categoryId: { toString: () => "cat-pizza" },
                basePrice: 7,
                shortName: "PIZ",
                splitKitchenPrintPerUnit: true
            }
        ]);
        mockCategories([
            {
                _id: { toString: () => "cat-pizza" },
                name: "Pizze",
                pizzaFlowEnabled: true,
                printerId: {
                    _id: "kitchen-printer-1",
                    name: "Forno",
                    ip: "192.168.178.210",
                    port: 9100,
                    isVirtual: false
                }
            }
        ]);

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.routeOrderToPrinters("order-pizza-split", "pos-1");
        const allJobs = printComandaSpy.mock.calls.map(([job]) => job);
        const kitchenJobs = allJobs.filter((job) => job.printType === "KITCHEN_ORDER");
        const customerJobs = allJobs.filter((job) => job.printType === "CUSTOMER_ORDER");

        expect(result).toHaveLength(5);
        expect(kitchenJobs).toHaveLength(2);
        expect(customerJobs).toHaveLength(2);
        expect(kitchenJobs.every((job) => job.pizzaNumber === 88 && job.pizzaBarcodeValue === "00000888")).toBe(true);
        expect(customerJobs.every((job) => job.pizzaNumber === 88 && job.pizzaBarcodeValue === undefined)).toBe(true);
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
