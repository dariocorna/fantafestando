import { beforeEach, describe, expect, test, vi } from "vitest";
import { Binary } from "bson";
import mongoose from "mongoose";
import { getThermalContentWidth } from "@/lib/easter-egg-config";

const { dbConnectMock, printJobFindOneAndUpdateMock, printJobUpdateOneMock, orderFindOneMock } = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobFindOneAndUpdateMock: vi.fn(),
    printJobUpdateOneMock: vi.fn(),
    orderFindOneMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/PrintJob", () => ({
    default: {
        findOneAndUpdate: printJobFindOneAndUpdateMock,
        updateOne: printJobUpdateOneMock
    }
}));

vi.mock("@/models/Order", () => ({
    default: {
        findOne: orderFindOneMock
    }
}));
vi.mock("@/models/Product", () => ({ default: {} }));
vi.mock("@/models/Category", () => ({ default: {} }));
vi.mock("@/models/PosDevice", () => ({ default: {} }));

import { PrinterService } from "@/lib/printer";

function mockFindOneJob(job: unknown) {
    printJobFindOneAndUpdateMock.mockReturnValue({
        populate: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(job)
        })
    });
}

describe("PrinterService.retryPrintJobById", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        orderFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        });
    });

    test("registers the Printer model required by populate", () => {
        expect(mongoose.models.Printer).toBeDefined();
    });

    test("returns validation error when ids are missing", async () => {
        const result = await PrinterService.retryPrintJobById("", "");
        expect(result).toEqual({ success: false, error: "Parametri mancanti" });
    });

    test("returns not found when print job does not exist", async () => {
        mockFindOneJob(null);

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: false, error: "Job non disponibile o già acquisito" });
    });

    test("retries legacy cash session summaries without losing their document", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            source: "CASH_SESSION",
            printType: "CASH_SESSION_SUMMARY",
            copies: 1,
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            document: {
                kind: "CASH_SESSION_SUMMARY",
                sessionId: "session-12345678",
                items: [{ name: "Panino", quantity: 2, lineTotal: 10 }],
                totals: { totaleIncassi: "10.00 EUR" }
            }
        });
        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({
            success: true,
            rawCapturePath: "/tmp/receipt.raw",
            automaticRetryCount: 1
        });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: true });
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            printType: "CASH_SESSION_SUMMARY",
            document: expect.objectContaining({
                printType: "CASH_SESSION_SUMMARY",
                items: [expect.objectContaining({ name: "Panino", qty: 2, lineTotal: 10 })]
            })
        }));
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1" },
            {
                $set: {
                    status: "SENT",
                    rawCapturePath: "/tmp/receipt.raw",
                    automaticRetryCount: 1
                },
                $unset: { errorMessage: 1, retryClaimedAt: 1 }
            }
        );
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

        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: true, automaticRetryCount: 0 });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            printType: "MANUAL_TEST",
            copies: 2,
            document: expect.objectContaining({ title: "Ricevuta Demo", copyLabel: "COPIA TEST", orderId: "order-1", shortCode: "D-12345" })
        }));
        expect(result).toEqual({ success: true });
        expect(printJobFindOneAndUpdateMock).toHaveBeenCalledWith(
            { _id: "job-1", eventId: "evt-1", status: "FAILED" },
            { $set: { status: "QUEUED", retryClaimedAt: expect.any(Date) } },
            { returnDocument: "after" }
        );
    });

    test("returns unexpectedly interrupted retries to FAILED", async () => {
        mockFindOneJob({
            _id: { toString: () => "job-1" },
            source: "ORDER",
            printType: "MANUAL_TEST",
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            document: { title: "Ricevuta Demo", items: [] }
        });
        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockRejectedValue(new Error("render failed"));

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        const retryClaimedAt = printJobFindOneAndUpdateMock.mock.calls[0][1].$set.retryClaimedAt;

        expect(result).toEqual({ success: false, error: "Reinvio stampa interrotto" });
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1", eventId: "evt-1", status: "QUEUED", retryClaimedAt },
            {
                $set: { status: "FAILED", errorMessage: "Reinvio stampa interrotto" },
                $unset: { retryClaimedAt: 1 }
            }
        );
    });

    test("returns a claimed job to FAILED when populate fails", async () => {
        printJobFindOneAndUpdateMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockRejectedValue(new Error("populate failed"))
            })
        });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        const retryClaimedAt = printJobFindOneAndUpdateMock.mock.calls[0][1].$set.retryClaimedAt;

        expect(result).toEqual({ success: false, error: "Reinvio stampa interrotto" });
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: "job-1", eventId: "evt-1", status: "QUEUED", retryClaimedAt },
            {
                $set: { status: "FAILED", errorMessage: "Reinvio stampa interrotto" },
                $unset: { retryClaimedAt: 1 }
            }
        );
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

        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: true, automaticRetryCount: 0 });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-legacy");
        expect(result).toEqual({ success: true });
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            printType: "CUSTOMER_ORDER",
            document: expect.objectContaining({ title: "Comanda Cliente", shortCode: "123", customerName: "Mario", tableNumber: "A1", totals: [{ label: "TOTALE", value: "10.00 EUR", emphasis: "strong" }] })
        }));
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

        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: false, errorMessage: "Printer not reachable", automaticRetryCount: 0 });
        const result = await PrinterService.retryPrintJobById("evt-1", "job-1");
        expect(result).toEqual({ success: false, error: "Invio stampa fallito" });
    });

    test("retries easter egg jobs using the raster stored on the order before falling back to legacy image URLs", async () => {
        const rasterWidth = getThermalContentWidth();
        mockFindOneJob({
            _id: { toString: () => "job-raster" },
            eventId: { toString: () => "evt-1" },
            orderId: { toString: () => "order-1" },
            source: "ORDER",
            printType: "EASTER_EGG_IMAGE",
            destinationHost: "printer-emulator",
            destinationPort: 19100,
            printerId: {
                _id: "printer-1",
                ip: "printer-emulator",
                port: 19100,
                isVirtual: false
            },
            document: {
                title: "Easter Egg Cliente"
            }
        });
        orderFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    easterEggAttachment: {
                        rasterWidth,
                        rasterHeight: 20,
                        rasterData: new Binary(Buffer.alloc((rasterWidth / 8) * 20, 0xaa))
                    }
                })
            })
        });

        const printRasterSpy = vi.spyOn(
            PrinterService as unknown as { dispatchRasterImageWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchRasterImageWithAutomaticRetry"
        ).mockResolvedValue({ success: true, automaticRetryCount: 0 });
        const result = await PrinterService.retryPrintJobById("evt-1", "job-raster");

        expect(result).toEqual({ success: true });
        expect(printRasterSpy).toHaveBeenCalledWith(expect.objectContaining({
            raster: expect.objectContaining({
                width: rasterWidth,
                height: 20
            }),
            copies: 1
        }));
    });
});
