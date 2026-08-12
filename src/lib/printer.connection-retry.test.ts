import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    dbConnectMock,
    printJobCreateMock,
    printJobDistinctMock,
    printJobUpdateManyMock,
    printJobUpdateOneMock,
    printJobExistsMock,
    printerFindOneAndUpdateMock,
    printerExistsMock,
    printerDistinctMock,
    printerUpdateOneMock,
    buildOrderPrintDocumentV2Mock,
    normalizeLegacyPrintDocumentMock,
    isPrinterConnectedMock,
    executeMock,
    thermalPrinterCtorMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobCreateMock: vi.fn(),
    printJobDistinctMock: vi.fn(),
    printJobUpdateManyMock: vi.fn(),
    printJobUpdateOneMock: vi.fn(),
    printJobExistsMock: vi.fn(),
    printerFindOneAndUpdateMock: vi.fn(),
    printerExistsMock: vi.fn(),
    printerDistinctMock: vi.fn(),
    printerUpdateOneMock: vi.fn(),
    buildOrderPrintDocumentV2Mock: vi.fn(),
    normalizeLegacyPrintDocumentMock: vi.fn(),
    isPrinterConnectedMock: vi.fn(),
    executeMock: vi.fn(),
    thermalPrinterCtorMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/PrintJob", () => ({
    default: {
        create: printJobCreateMock,
        distinct: printJobDistinctMock,
        updateMany: printJobUpdateManyMock,
        updateOne: printJobUpdateOneMock,
        exists: printJobExistsMock
    }
}));

vi.mock("@/models/Printer", () => ({
    default: {
        findOneAndUpdate: printerFindOneAndUpdateMock,
        exists: printerExistsMock,
        distinct: printerDistinctMock,
        updateOne: printerUpdateOneMock
    }
}));

vi.mock("@/models/Order", () => ({ default: {} }));
vi.mock("@/models/Product", () => ({ default: {} }));
vi.mock("@/models/Category", () => ({ default: {} }));
vi.mock("@/models/PosDevice", () => ({ default: {} }));
vi.mock("@/models/Event", () => ({ default: {} }));

vi.mock("@/lib/print-branding", () => ({
    preparePrintableLogoPngBufferFromUrl: vi.fn(),
    resolvePrintableLogoPathFromUrl: vi.fn(() => null),
    sanitizePrintableHeaderLogoUrl: vi.fn((value) => value),
    sanitizeReceiptHeaderLogoUrl: vi.fn((value) => value)
}));

vi.mock("@/lib/print-report", () => ({
    buildCashSessionPrintDocumentV2: vi.fn(),
    buildOrderPrintDocumentV2: buildOrderPrintDocumentV2Mock,
    normalizeLegacyPrintDocument: normalizeLegacyPrintDocumentMock,
    toOrderJobPayloadFromDocument: vi.fn()
}));

vi.mock("node-thermal-printer", () => {
    class ThermalPrinterMock {
        constructor(config: unknown) {
            thermalPrinterCtorMock(config);
        }

        isPrinterConnected() {
            return isPrinterConnectedMock();
        }

        execute() {
            return executeMock();
        }

        alignCenter() {}
        alignLeft() {}
        println() {}
        setTextDoubleWidth() {}
        setTextDoubleHeight() {}
        setTextNormal() {}
        bold() {}
        setTypeFontA() {}
        setTypeFontB() {}
        cut() {}
        printImage() {
            return Promise.resolve(true);
        }
    }

    return {
        ThermalPrinter: ThermalPrinterMock,
        PrinterTypes: { EPSON: "EPSON" },
        CharacterSet: { WPC1252: "WPC1252", PC858_EURO: "PC858_EURO" }
    };
});

import { PrinterService } from "@/lib/printer";
import { holdFailedKitchenPrintJobs } from "@/lib/print-queue";

function buildDocument(input: {
    printType?: string;
    title?: string;
    eventName?: string;
    copyLabel?: string;
    shortCode?: string;
    customerName?: string;
    tableNumber?: string;
    items?: Array<{
        name: string;
        quantity: number;
        notes?: string;
        unitPrice?: number;
        lineTotal?: number;
        selectedOptions?: Array<{ name: string; priceVariation: number }>;
    }>;
    totals?: Array<{ label: string; value: string; emphasis?: "normal" | "strong" }>;
    footerLines?: string[];
}) {
    return {
        schemaVersion: 2,
        printType: input.printType || "MANUAL_TEST",
        eventName: input.eventName || "Evento Demo",
        title: input.title || "TEST",
        copyLabel: input.copyLabel || "ORIGINALE",
        referenceCode: input.shortCode || "",
        customerName: input.customerName || "",
        tableNumber: input.tableNumber || "",
        headerLines: [],
        items: (input.items || []).map((item) => ({
            qty: item.quantity,
            name: item.name,
            notes: item.notes,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            selectedOptions: item.selectedOptions || []
        })),
        totals: input.totals || [],
        footerLines: input.footerLines || [],
        createdAt: new Date().toISOString(),
        branding: {}
    };
}

function baseJob() {
    return {
        ip: "192.168.178.203",
        port: 9100,
        isVirtual: false,
        eventId: "evt-1",
        source: "MANUAL_TEST" as const,
        printType: "MANUAL_TEST" as const,
        title: "Test",
        eventName: "Evento Demo",
        copyLabel: "ORIGINALE",
        orderId: "order-1",
        items: [{ name: "Voce prova", quantity: 1 }],
        footerLines: ["footer"]
    };
}

describe("PrinterService.printComanda connection retry", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.useRealTimers();

        printJobCreateMock.mockResolvedValue({ _id: { toString: () => "job-1" } });
        printJobDistinctMock.mockResolvedValue([]);
        printJobUpdateManyMock.mockResolvedValue({ modifiedCount: 0 });
        printJobUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
        printJobExistsMock.mockResolvedValue(null);
        printerDistinctMock.mockResolvedValue([]);
        printerFindOneAndUpdateMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ _id: "printer-1" })
            })
        });
        printerExistsMock.mockResolvedValue({ _id: "printer-1" });
        printerUpdateOneMock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, acknowledged: true });
        buildOrderPrintDocumentV2Mock.mockImplementation((input) => buildDocument(input));
        normalizeLegacyPrintDocumentMock.mockImplementation((input) => input);
    });

    test("retries temporary unreachable checks before failing the job", async () => {
        vi.useFakeTimers();
        isPrinterConnectedMock
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        executeMock.mockResolvedValue(undefined);

        const resultPromise = PrinterService.printComanda(baseJob(), 1);

        await vi.advanceTimersByTimeAsync(500);
        const result = await resultPromise;

        expect(result).toBe(true);
        expect(thermalPrinterCtorMock).toHaveBeenCalledWith(expect.objectContaining({
            characterSet: "PC858_EURO"
        }));
        expect(isPrinterConnectedMock).toHaveBeenCalledTimes(3);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "SENT",
                    rawCapturePath: undefined,
                    automaticRetryCount: 0
                },
                $unset: { errorMessage: 1 }
            }
        );
    });

    test("skips dispatch when the same persisted print intent already exists", async () => {
        printJobCreateMock.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: 11000 }));

        await expect(PrinterService.printComanda({
            ...baseJob(),
            idempotencyKey: "SUMUP_CALLBACK:order-1:cashier-summary"
        }, 1)).resolves.toBe(true);

        expect(isPrinterConnectedMock).not.toHaveBeenCalled();
        expect(executeMock).not.toHaveBeenCalled();
        expect(printJobUpdateOneMock).not.toHaveBeenCalled();
    });

    test("does not dispatch an idempotent intent when its log cannot be persisted", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        printJobCreateMock.mockRejectedValueOnce(new Error("database unavailable"));

        await expect(PrinterService.printComanda({
            ...baseJob(),
            idempotencyKey: "SUMUP_CALLBACK:order-1:cashier-summary"
        }, 1)).resolves.toBe(false);

        expect(isPrinterConnectedMock).not.toHaveBeenCalled();
        expect(executeMock).not.toHaveBeenCalled();
        expect(printJobUpdateOneMock).not.toHaveBeenCalled();
    });

    test("automatically retries not reachable jobs before succeeding", async () => {
        vi.useFakeTimers();
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const waitForPrinterReachableSpy = vi.spyOn(
            PrinterService as unknown as {
                waitForPrinterReachable: (printer: unknown, timeoutMs: number) => Promise<boolean>;
            },
            "waitForPrinterReachable"
        );

        waitForPrinterReachableSpy
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        executeMock.mockResolvedValue(undefined);

        const resultPromise = PrinterService.printComanda(baseJob(), 1);

        await vi.advanceTimersByTimeAsync(3000);
        const result = await resultPromise;

        expect(result).toBe(true);
        expect(waitForPrinterReachableSpy).toHaveBeenCalledTimes(3);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
        expect(printJobUpdateOneMock).toHaveBeenCalledTimes(1);
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "SENT",
                    rawCapturePath: undefined,
                    automaticRetryCount: 2
                },
                $unset: { errorMessage: 1 }
            }
        );
    });

    test("marks the job as failed after exhausting the automatic not reachable retries", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const waitForPrinterReachableSpy = vi.spyOn(
            PrinterService as unknown as {
                waitForPrinterReachable: (printer: unknown, timeoutMs: number) => Promise<boolean>;
            },
            "waitForPrinterReachable"
        );

        waitForPrinterReachableSpy.mockResolvedValue(false);

        const resultPromise = PrinterService.printComanda(baseJob(), 1);

        await vi.advanceTimersByTimeAsync(5000);
        const result = await resultPromise;

        expect(result).toBe(false);
        expect(waitForPrinterReachableSpy).toHaveBeenCalledTimes(6);
        expect(executeMock).not.toHaveBeenCalled();
        expect(printJobUpdateOneMock).toHaveBeenCalledTimes(1);
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "FAILED",
                    errorMessage: "Printer not reachable",
                    rawCapturePath: undefined,
                    automaticRetryCount: 5
                }
            }
        );
    });

    test("retries execute on ECONNREFUSED before returning success", async () => {
        vi.useFakeTimers();
        isPrinterConnectedMock.mockResolvedValue(true);
        executeMock
            .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED 192.168.178.203:9100"), { code: "ECONNREFUSED" }))
            .mockResolvedValueOnce(undefined);

        const resultPromise = PrinterService.printComanda(baseJob(), 1);

        await vi.advanceTimersByTimeAsync(250);
        const result = await resultPromise;

        expect(result).toBe(true);
        expect(isPrinterConnectedMock).toHaveBeenCalledTimes(1);
        expect(executeMock).toHaveBeenCalledTimes(2);
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "SENT",
                    rawCapturePath: undefined,
                    automaticRetryCount: 0
                },
                $unset: { errorMessage: 1 }
            }
        );
    });

    test("puts new kitchen jobs behind an accepted backlog without sending them", async () => {
        printJobExistsMock.mockResolvedValue({ _id: "held-1" });
        const kitchenJob = {
            ...baseJob(),
            source: "ORDER" as const,
            printType: "KITCHEN_ORDER" as const,
            queueRecoverable: true,
            printerId: "printer-1"
        };

        await expect(PrinterService.printComanda(kitchenJob, 1)).resolves.toBe(true);

        expect(printJobExistsMock).toHaveBeenCalledWith(expect.objectContaining({
            eventId: "evt-1",
            printerId: "printer-1",
            queueRecoverable: true,
            status: { $in: ["HELD", "QUEUED"] },
            heldSince: { $exists: true }
        }));
        expect(printJobCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            queueRecoverable: true,
            status: "QUEUED",
            liveClaimExpiresAt: expect.any(Date)
        }));
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1", status: "QUEUED" },
            {
                $set: {
                    status: "HELD",
                    heldSince: expect.any(Date),
                    errorMessage: "Accodata dietro stampe reparto già in attesa"
                },
                $unset: { liveClaimExpiresAt: 1 }
            }
        );
        expect(printJobUpdateOneMock).not.toHaveBeenCalledWith(
            { _id: "job-1" },
            expect.objectContaining({ $set: expect.objectContaining({ status: "SENT" }) })
        );
        expect(isPrinterConnectedMock).not.toHaveBeenCalled();
        expect(executeMock).not.toHaveBeenCalled();
    });

    test("does not claim the printer or report success when a recoverable job cannot be persisted", async () => {
        printJobExistsMock.mockResolvedValue({ _id: "held-1" });
        printJobCreateMock.mockRejectedValueOnce(new Error("write failed"));
        const kitchenJob = {
            ...baseJob(),
            source: "ORDER" as const,
            printType: "KITCHEN_ORDER" as const,
            queueRecoverable: true,
            printerId: "printer-1"
        };
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect(PrinterService.printComanda(kitchenJob, 1)).resolves.toBe(false);

        expect(isPrinterConnectedMock).not.toHaveBeenCalled();
        expect(executeMock).not.toHaveBeenCalled();
        expect(printerFindOneAndUpdateMock).not.toHaveBeenCalled();
        expect(printerUpdateOneMock).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });

    test("serializes concurrent kitchen prints so the second POS joins the held queue", async () => {
        let releaseFirstExecute: (() => void) | undefined;
        isPrinterConnectedMock.mockResolvedValue(true);
        executeMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
            releaseFirstExecute = resolve;
        }));
        printerFindOneAndUpdateMock
            .mockReturnValueOnce({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({ _id: "printer-1" })
                })
            })
            .mockReturnValueOnce({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(null)
                })
            });
        printJobCreateMock
            .mockResolvedValueOnce({ _id: { toString: () => "job-live" } })
            .mockResolvedValueOnce({ _id: { toString: () => "job-held" } });

        const liveJob = {
            ...baseJob(),
            source: "ORDER" as const,
            printType: "KITCHEN_ORDER" as const,
            queueRecoverable: true,
            printerId: "printer-1",
            orderId: "507f1f77bcf86cd799439011"
        };
        const queuedJob = {
            ...baseJob(),
            source: "ORDER" as const,
            printType: "KITCHEN_ORDER" as const,
            queueRecoverable: true,
            printerId: "printer-1",
            orderId: "507f1f77bcf86cd799439012"
        };

        const livePromise = PrinterService.printComanda(liveJob, 1);
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));

        await expect(PrinterService.printComanda(queuedJob, 1)).resolves.toBe(true);

        releaseFirstExecute?.();
        await expect(livePromise).resolves.toBe(true);

        expect(printJobExistsMock).toHaveBeenCalledTimes(1);
        expect(printJobCreateMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            queueRecoverable: true,
            orderId: "507f1f77bcf86cd799439011"
        }));
        expect(printJobCreateMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            queueRecoverable: true,
            orderId: "507f1f77bcf86cd799439012"
        }));
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-held", status: "QUEUED" },
            {
                $set: {
                    status: "HELD",
                    heldSince: expect.any(Date),
                    errorMessage: "Accodata dietro stampe reparto già in attesa"
                },
                $unset: { liveClaimExpiresAt: 1 }
            }
        );
        expect(executeMock).toHaveBeenCalledTimes(1);
    });

    test("fails instead of orphaning a held job when printer deletion wins the lease race", async () => {
        printerFindOneAndUpdateMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        });
        printerExistsMock.mockResolvedValue(null);
        const kitchenJob = {
            ...baseJob(),
            source: "ORDER" as const,
            printType: "KITCHEN_ORDER" as const,
            queueRecoverable: true,
            printerId: "printer-deleted"
        };

        await expect(PrinterService.printComanda(kitchenJob, 1)).resolves.toBe(false);

        expect(printerExistsMock).toHaveBeenCalledWith({
            _id: "printer-deleted",
            eventId: "evt-1",
            type: "KITCHEN"
        });
        expect(printJobCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            printerId: "printer-deleted",
            queueRecoverable: true
        }));
        expect(printJobCreateMock.mock.invocationCallOrder[0]).toBeLessThan(
            printerFindOneAndUpdateMock.mock.invocationCallOrder[0]
        );
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "FAILED",
                    errorMessage: "Stampante reparto non disponibile",
                    rawCapturePath: undefined,
                    automaticRetryCount: 0
                },
                $unset: { liveClaimExpiresAt: 1 }
            }
        );
        expect(printJobUpdateOneMock).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ $set: expect.objectContaining({ status: "HELD" }) })
        );
        expect(isPrinterConnectedMock).not.toHaveBeenCalled();
        expect(executeMock).not.toHaveBeenCalled();
    });

    test("keeps cashier-routed department copies out of queue recovery even with KITCHEN_ORDER printType", async () => {
        isPrinterConnectedMock.mockResolvedValue(true);
        executeMock.mockResolvedValue(undefined);
        const cashierKitchenCopy = {
            ...baseJob(),
            source: "ORDER" as const,
            printType: "KITCHEN_ORDER" as const,
            queueRecoverable: false,
            printerId: "cashier-printer-1"
        };

        await expect(PrinterService.printComanda(cashierKitchenCopy, 1)).resolves.toBe(true);

        expect(printerFindOneAndUpdateMock).not.toHaveBeenCalled();
        expect(printJobExistsMock).not.toHaveBeenCalled();
        expect(printJobCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            queueRecoverable: false,
            printType: "KITCHEN_ORDER",
            printerId: "cashier-printer-1"
        }));
        expect(executeMock).toHaveBeenCalledTimes(1);
    });

    test("refuses a concurrent hold while the live sender has already checked backlog and owns the lease", async () => {
        let releaseFirstExecute: (() => void) | undefined;
        isPrinterConnectedMock.mockResolvedValue(true);
        executeMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
            releaseFirstExecute = resolve;
        }));
        printJobExistsMock.mockResolvedValue(false);
        printJobDistinctMock.mockResolvedValueOnce(["printer-1"]);
        printerDistinctMock.mockResolvedValueOnce(["printer-1"]);
        printerFindOneAndUpdateMock
            .mockReturnValueOnce({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({ _id: "printer-1" })
                })
            })
            .mockReturnValueOnce({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(null)
                })
            });

        const liveJob = {
            ...baseJob(),
            source: "ORDER" as const,
            printType: "KITCHEN_ORDER" as const,
            queueRecoverable: true,
            printerId: "printer-1",
            orderId: "507f1f77bcf86cd799439021"
        };

        const livePromise = PrinterService.printComanda(liveJob, 1);
        await vi.waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
        expect(printJobExistsMock).toHaveBeenCalledTimes(1);

        await expect(holdFailedKitchenPrintJobs({
            eventId: "evt-1",
            orderId: "order-older-failed",
            jobIds: ["job-failed"]
        })).resolves.toEqual({
            held: 0,
            busyPrinterIds: ["printer-1"]
        });

        expect(printJobUpdateManyMock).not.toHaveBeenCalled();

        releaseFirstExecute?.();
        await expect(livePromise).resolves.toBe(true);
    });
});
