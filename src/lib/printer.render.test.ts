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
    test("renders cash-session products in Font B and restores Font A without double-size text", () => {
        const printer = createFakePrinter();
        const document: PrintDocumentV2 = {
            schemaVersion: 2,
            kind: "CASH_SESSION_SUMMARY",
            printType: "CASH_SESSION_SUMMARY",
            title: "Chiusura Cassa",
            copyLabel: "COPIA CASSA",
            createdAt: "2026-03-27T22:00:00.000Z",
            headerLines: [],
            items: [
                { categoryName: "Cucina", qty: 2, name: "PANINO", groupLabel: "PREZZO PIENO", grossAmount: 10, discountAmount: 0, lineTotal: 10 },
                { categoryName: "Bar", qty: 1, name: "BIBITA", groupLabel: "Staff", grossAmount: 5, discountAmount: 1, lineTotal: 4 }
            ],
            totals: [
                { label: "LORDO", value: "15.00 EUR" },
                { label: "NETTO / INCASSI", value: "14.00 EUR", emphasis: "strong" }
            ],
            footerLines: []
        };
        const service = PrinterService as unknown as {
            printItems: (printerInstance: ReturnType<typeof createFakePrinter>, printDocument: PrintDocumentV2) => void;
            printTotals: (printerInstance: ReturnType<typeof createFakePrinter>, printDocument: PrintDocumentV2) => void;
        };

        service.printItems(printer, document);

        expect(printer.setTypeFontB).toHaveBeenCalledTimes(1);
        expect(printer.setTypeFontA).toHaveBeenCalledTimes(1);
        expect(printer.setTypeFontB.mock.invocationCallOrder[0]).toBeLessThan(printer.setTypeFontA.mock.invocationCallOrder[0]);
        expect(printer.println).toHaveBeenCalledWith(expect.stringContaining("PANINO"));
        expect(printer.println).toHaveBeenCalledWith(expect.stringContaining("SUBT. SCONTO"));
        expect(printer.println).toHaveBeenCalledWith(expect.stringContaining("CATEGORIA: CUCINA"));
        expect(printer.println).toHaveBeenCalledWith(expect.stringContaining("CATEGORIA: BAR"));
        expect(printer.println).toHaveBeenCalledWith(expect.stringContaining("CAT. Q.TA"));
        expect(printer.println).toHaveBeenCalledWith(expect.stringContaining("CAT. NETTO"));
        expect(printer.setTextDoubleWidth).not.toHaveBeenCalled();
        expect(printer.setTextDoubleHeight).not.toHaveBeenCalled();

        service.printTotals(printer, document);

        expect(printer.bold).toHaveBeenCalledWith(true);
        expect(printer.setTextDoubleWidth).not.toHaveBeenCalled();
        expect(printer.setTextDoubleHeight).not.toHaveBeenCalled();
    });

    test("prints numbered-dish barcodes as native EAN-8 commands on customer orders", async () => {
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
        expect(printer.println).toHaveBeenCalledWith("PIATTO N°");
    });

    test("does not print dish numbers or barcodes on cashier summaries", async () => {
        const printer = createFakePrinter();
        const document: PrintDocumentV2 = {
            schemaVersion: 2,
            kind: "COMANDA",
            printType: "CASHIER_SUMMARY",
            title: "Scontrino Cassa",
            copyLabel: "COPIA CASSA",
            pizzaNumber: 81,
            pizzaBarcodeValue: "00000819",
            createdAt: "2026-03-27T22:00:00.000Z",
            headerLines: [],
            items: [{ qty: 1, quantity: 1, name: "Calamari" }],
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
        expect(printer.code128).not.toHaveBeenCalled();
        expect(printer.setTextQuadArea).not.toHaveBeenCalled();
        expect(printer.println).not.toHaveBeenCalledWith("PIATTO N°");
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
