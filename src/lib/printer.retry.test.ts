import { beforeEach, describe, expect, test, vi } from "vitest";

const { dbConnectMock, printJobFindOneMock } = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobFindOneMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/PrintJob", () => ({
    default: {
        findOne: printJobFindOneMock
    }
}));

vi.mock("@/models/Order", () => ({ default: {} }));
vi.mock("@/models/Product", () => ({ default: {} }));
vi.mock("@/models/Category", () => ({ default: {} }));
vi.mock("@/models/PosDevice", () => ({ default: {} }));

import { PrinterService } from "@/lib/printer";

function mockFindOneJob(job: unknown) {
    printJobFindOneMock.mockReturnValue({
        populate: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(job)
        })
    });
}

describe("PrinterService.retryPrintJobById", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("returns validation error when ids are missing", async () => {
        const result = await PrinterService.retryPrintJobById("", "");
        expect(result).toEqual({ success: false, error: "Parametri mancanti" });
    });

    test("returns not found when print job does not exist", async () => {
        mockFindOneJob(null);

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: false, error: "Job non trovato" });
    });

    test("returns unsupported error for cash session summary", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            source: "CASH_SESSION",
            printType: "CASH_SESSION_SUMMARY",
            document: {}
        });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: false, error: "Reinvio non supportato per chiusure cassa" });
    });

    test("retries a failed order print and returns success", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            eventId: { toString: () => "evt-1" },
            source: "ORDER",
            printType: "MANUAL_TEST",
            copies: 2,
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            isVirtual: false,
            printerId: {
                _id: "printer-1",
                ip: "printer-emulator",
                port: 19100,
                isVirtual: false
            },
            document: {
                schemaVersion: 2,
                printType: "MANUAL_TEST",
                copyLabel: "COPIA TEST",
                title: "Ricevuta Demo",
                orderId: "order-1",
                shortCode: "D-12345",
                items: [{ qty: 1, name: "Panino" }],
                totals: [{ label: "TOTALE", value: "5.00 EUR" }]
            }
        });

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(printComandaSpy).toHaveBeenCalledTimes(1);
        expect(printComandaSpy.mock.calls[0]?.[0]).toMatchObject({
            eventId: "evt-1",
            source: "ORDER",
            printType: "MANUAL_TEST",
            title: "Ricevuta Demo",
            copyLabel: "COPIA TEST",
            orderId: "order-1",
            shortCode: "D-12345"
        });
        expect(printComandaSpy.mock.calls[0]?.[1]).toBe(2);
        expect(result).toEqual({ success: true });
    });

    test("retries legacy print documents with object totals", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-legacy" },
            source: "ORDER",
            printType: "CUSTOMER_ORDER",
            copies: 1,
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            document: {
                kind: "COMANDA",
                title: "Comanda Cliente",
                shortCode: "123",
                customerName: "Mario",
                tableNumber: "A1",
                items: [{ name: "Panino", quantity: 2, notes: "No salsa" }],
                totals: { totale: "10.00 EUR" }
            }
        });

        const printComandaSpy = vi.spyOn(PrinterService, "printComanda").mockResolvedValue(true);

        const result = await PrinterService.retryPrintJobById("evt-1", "job-legacy");
        expect(result).toEqual({ success: true });
        expect(printComandaSpy).toHaveBeenCalledTimes(1);
        expect(printComandaSpy.mock.calls[0]?.[0]).toMatchObject({
            printType: "CUSTOMER_ORDER",
            title: "Comanda Cliente",
            shortCode: "123",
            customerName: "Mario",
            tableNumber: "A1"
        });
        expect(printComandaSpy.mock.calls[0]?.[0].totals).toEqual([
            { label: "TOTALE", value: "10.00 EUR", emphasis: "strong" }
        ]);
    });

    test("returns retry failure when print dispatch fails", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            source: "ORDER",
            printType: "MANUAL_TEST",
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            document: {
                title: "Ricevuta Demo",
                orderId: "order-1",
                items: [{ name: "Panino", quantity: 1 }]
            }
        });

        vi.spyOn(PrinterService, "printComanda").mockResolvedValue(false);
        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: false, error: "Invio stampa fallito" });
    });
});
