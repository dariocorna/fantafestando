import { beforeEach, describe, expect, test, vi } from "vitest";
import { getThermalContentWidth } from "@/lib/easter-egg-config";

const {
    dbConnectMock,
    printJobCreateMock,
    printJobUpdateOneMock,
    preparePrintableLogoPngBufferFromUrlMock,
    isPrinterConnectedMock,
    executeMock,
    addMock,
    alignCenterMock,
    alignLeftMock,
    clearMock,
    printImageBufferMock,
    getBufferMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobCreateMock: vi.fn(),
    printJobUpdateOneMock: vi.fn(),
    preparePrintableLogoPngBufferFromUrlMock: vi.fn(),
    isPrinterConnectedMock: vi.fn(),
    executeMock: vi.fn(),
    addMock: vi.fn(),
    alignCenterMock: vi.fn(),
    alignLeftMock: vi.fn(),
    clearMock: vi.fn(),
    printImageBufferMock: vi.fn(),
    getBufferMock: vi.fn()
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
    preparePrintableLogoPngBufferFromUrl: preparePrintableLogoPngBufferFromUrlMock,
    sanitizePrintableHeaderLogoUrl: vi.fn((value) => value),
    sanitizeReceiptHeaderLogoUrl: vi.fn((value) => value)
}));

vi.mock("@/lib/print-report", () => ({
    buildCashSessionPrintDocumentV2: vi.fn(),
    buildOrderPrintDocumentV2: vi.fn(),
    normalizeLegacyPrintDocument: vi.fn((input) => input),
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

        add(buffer: Buffer) {
            return addMock(buffer);
        }
        printImageBuffer(buffer: Buffer) {
            return printImageBufferMock(buffer);
        }
        println() {}
        cut() {}
        alignCenter() {
            return alignCenterMock();
        }
        alignLeft() {
            return alignLeftMock();
        }
        clear() {
            return clearMock();
        }
        getBuffer() {
            return getBufferMock();
        }
        setTextDoubleWidth() {}
        setTextDoubleHeight() {}
        setTextNormal() {}
        bold() {}
        setTypeFontA() {}
        setTypeFontB() {}
    }

    return {
        ThermalPrinter: ThermalPrinterMock,
        PrinterTypes: { EPSON: "EPSON" },
        CharacterSet: { WPC1252: "WPC1252" }
    };
});

import { PrinterService } from "@/lib/printer";

describe("PrinterService.printRasterImage", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        printJobCreateMock.mockResolvedValue({ _id: { toString: () => "job-raster-1" } });
        printJobUpdateOneMock.mockResolvedValue({ acknowledged: true });
        isPrinterConnectedMock.mockResolvedValue(true);
        executeMock.mockResolvedValue(undefined);
        addMock.mockResolvedValue(undefined);
        preparePrintableLogoPngBufferFromUrlMock.mockResolvedValue(undefined);
        printImageBufferMock.mockResolvedValue(undefined);
        getBufferMock.mockReturnValue(Buffer.from("raw-capture"));
    });

    test("prints raster images and persists the job log", async () => {
        const raster = {
            width: 384,
            height: 10,
            data: Buffer.alloc((384 / 8) * 10, 0xaa)
        };

        const result = await PrinterService.printRasterImage({
            ip: "127.0.0.1",
            port: 19100,
            eventId: "event-1",
            printerId: "printer-1",
            source: "MANUAL_TEST",
            printType: "EASTER_EGG_IMAGE",
            title: "Easter Egg Portale",
            eventName: "Sagra Demo"
        }, raster);

        expect(result).toBe(true);
        expect(printJobCreateMock).toHaveBeenCalledTimes(1);
        expect(addMock).not.toHaveBeenCalled();
        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(printImageBufferMock).toHaveBeenCalledTimes(1);
        expect(alignCenterMock).toHaveBeenCalledTimes(2);
        expect(alignLeftMock).toHaveBeenCalledTimes(2);
        expect(executeMock).toHaveBeenCalledTimes(1);
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-raster-1" },
            {
                $set: {
                    status: "SENT",
                    errorMessage: undefined,
                    rawCapturePath: expect.stringContaining("/tmp/fantafestando-printer-captures/"),
                    automaticRetryCount: 0
                }
            }
        );
    });

    test("prints standard raster images as a single prepared thermal image on physical printers", async () => {
        const raster = {
            width: 576,
            height: 300,
            data: Buffer.alloc((576 / 8) * 300, 0xaa)
        };

        const result = await PrinterService.printRasterImage({
            ip: "127.0.0.1",
            port: 19100,
            eventId: "event-1",
            printerId: "printer-1",
            source: "ORDER",
            printType: "EASTER_EGG_IMAGE",
            title: "Easter Egg Cliente"
        }, raster);

        expect(result).toBe(true);
        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(printImageBufferMock).toHaveBeenCalledTimes(1);
        expect(addMock).not.toHaveBeenCalled();
        expect(executeMock).toHaveBeenCalledTimes(1);
    });

    test("splits only exceptionally tall raster images into prepared stripes on physical printers", async () => {
        const contentWidth = getThermalContentWidth();
        const raster = {
            width: contentWidth,
            height: 2300,
            data: Buffer.alloc((contentWidth / 8) * 2300, 0xaa)
        };

        const result = await PrinterService.printRasterImage({
            ip: "127.0.0.1",
            port: 19100,
            eventId: "event-1",
            printerId: "printer-1",
            source: "MANUAL_TEST",
            printType: "EASTER_EGG_IMAGE",
            title: "Easter Egg Portale"
        }, raster);

        expect(result).toBe(true);
        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(printImageBufferMock).toHaveBeenCalledTimes(2);
        expect(addMock).not.toHaveBeenCalled();
        expect(executeMock).toHaveBeenCalledTimes(1);
    });

    test("prints the event header logo before the raster when branding is configured", async () => {
        preparePrintableLogoPngBufferFromUrlMock.mockResolvedValue(Buffer.from("png"));

        const raster = {
            width: 384,
            height: 10,
            data: Buffer.alloc((384 / 8) * 10, 0xaa)
        };

        const result = await PrinterService.printRasterImage({
            ip: "127.0.0.1",
            port: 19100,
            eventId: "event-1",
            printerId: "printer-1",
            source: "MANUAL_TEST",
            printType: "EASTER_EGG_IMAGE",
            title: "Easter Egg Portale",
            eventName: "Sagra Demo",
            brandingLogoUrl: "/uploads/receipt-headers/logo.png"
        }, raster);

        expect(result).toBe(true);
        expect(preparePrintableLogoPngBufferFromUrlMock).toHaveBeenCalledWith("/uploads/receipt-headers/logo.png");
        expect(printImageBufferMock).toHaveBeenCalledTimes(2);
    });
});
