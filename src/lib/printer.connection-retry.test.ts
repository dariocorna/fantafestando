import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    dbConnectMock,
    printJobCreateMock,
    printJobUpdateOneMock,
    buildOrderPrintDocumentV2Mock,
    normalizeLegacyPrintDocumentMock,
    isPrinterConnectedMock,
    executeMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobCreateMock: vi.fn(),
    printJobUpdateOneMock: vi.fn(),
    buildOrderPrintDocumentV2Mock: vi.fn(),
    normalizeLegacyPrintDocumentMock: vi.fn(),
    isPrinterConnectedMock: vi.fn(),
    executeMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/PrintJob", () => ({
    default: {
        create: printJobCreateMock,
        updateOne: printJobUpdateOneMock
    }
}));

vi.mock("@/models/Order", () => ({ default: {} }));
vi.mock("@/models/Product", () => ({ default: {} }));
vi.mock("@/models/Category", () => ({ default: {} }));
vi.mock("@/models/PosDevice", () => ({ default: {} }));
vi.mock("@/models/Event", () => ({ default: {} }));

vi.mock("@/lib/print-branding", () => ({
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
        CharacterSet: { WPC1252: "WPC1252" }
    };
});

import { PrinterService } from "@/lib/printer";

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
        printJobUpdateOneMock.mockResolvedValue({ acknowledged: true });
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
        expect(isPrinterConnectedMock).toHaveBeenCalledTimes(3);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "SENT",
                    errorMessage: undefined,
                    rawCapturePath: undefined,
                    automaticRetryCount: 0
                }
            }
        );
    });

    test("automatically retries not reachable jobs after 1s and 2s before succeeding", async () => {
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
                    errorMessage: undefined,
                    rawCapturePath: undefined,
                    automaticRetryCount: 2
                }
            }
        );
    });

    test("marks the job as failed after exhausting the two automatic not reachable retries", async () => {
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

        await vi.advanceTimersByTimeAsync(3000);
        const result = await resultPromise;

        expect(result).toBe(false);
        expect(waitForPrinterReachableSpy).toHaveBeenCalledTimes(3);
        expect(executeMock).not.toHaveBeenCalled();
        expect(printJobUpdateOneMock).toHaveBeenCalledTimes(1);
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "FAILED",
                    errorMessage: "Printer not reachable",
                    rawCapturePath: undefined,
                    automaticRetryCount: 2
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
                    errorMessage: undefined,
                    rawCapturePath: undefined,
                    automaticRetryCount: 0
                }
            }
        );
    });
});
