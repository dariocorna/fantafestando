import { describe, expect, test, vi } from "vitest";
import { PrinterService } from "@/lib/printer";
import type { PrintDocumentV2 } from "@/lib/print-report";

function createFakePrinter() {
    return {
        alignCenter: vi.fn(),
        alignLeft: vi.fn(),
        bold: vi.fn(),
        setTextQuadArea: vi.fn(),
        setTextDoubleWidth: vi.fn(),
        setTextDoubleHeight: vi.fn(),
        setTextNormal: vi.fn(),
        setTypeFontA: vi.fn(),
        setTypeFontB: vi.fn(),
        println: vi.fn(),
        printBarcode: vi.fn(),
        code128: vi.fn(),
        cut: vi.fn(),
    };
}

describe("PrinterService renderPrintDocument", () => {
    test("prints pizza barcodes as native EAN-8 commands on customer orders", async () => {
        const printer = createFakePrinter();
        const document: PrintDocumentV2 = {
            schemaVersion: 2,
            kind: "COMANDA",
            printType: "CUSTOMER_ORDER",
            title: "Comanda Cliente",
            copyLabel: "COPIA CLIENTE",
            pizzaNumber: 81,
            pizzaBarcodeValue: "00000819",
            createdAt: "2026-03-27T22:00:00.000Z",
            headerLines: [],
            items: [
                {
                    qty: 1,
                    quantity: 1,
                    name: "Margherita"
                }
            ],
            totals: [],
            footerLines: []
        };

        await (PrinterService as unknown as {
            renderPrintDocument: (
                printerInstance: ReturnType<typeof createFakePrinter>,
                printDocument: PrintDocumentV2,
                withLargeEventTitle: boolean
            ) => Promise<void>;
        }).renderPrintDocument(printer, document, false);

        expect(printer.printBarcode).toHaveBeenCalledWith("00000819", 68, {
            hriPos: 2,
            width: 5,
            height: 96
        });
        expect(printer.setTextQuadArea).toHaveBeenCalledTimes(1);
        expect(printer.printBarcode.mock.invocationCallOrder[0]).toBeLessThan(
            printer.setTextQuadArea.mock.invocationCallOrder[0]
        );
        expect(printer.code128).not.toHaveBeenCalled();
    });

    test("falls back to code128 for non-EAN-8 pizza barcode payloads", async () => {
        const printer = createFakePrinter();
        const document: PrintDocumentV2 = {
            schemaVersion: 2,
            kind: "COMANDA",
            printType: "CUSTOMER_ORDER",
            title: "Comanda Cliente",
            copyLabel: "COPIA CLIENTE",
            pizzaNumber: 81,
            pizzaBarcodeValue: "PZ:507f1f77bcf86cd799439011",
            createdAt: "2026-03-27T22:00:00.000Z",
            headerLines: [],
            items: [
                {
                    qty: 1,
                    quantity: 1,
                    name: "Margherita"
                }
            ],
            totals: [],
            footerLines: []
        };

        await (PrinterService as unknown as {
            renderPrintDocument: (
                printerInstance: ReturnType<typeof createFakePrinter>,
                printDocument: PrintDocumentV2,
                withLargeEventTitle: boolean
            ) => Promise<void>;
        }).renderPrintDocument(printer, document, false);

        expect(printer.printBarcode).not.toHaveBeenCalled();
        expect(printer.code128).toHaveBeenCalledWith("PZ:507f1f77bcf86cd799439011", {
            height: 60,
            text: 2
        });
    });
});
