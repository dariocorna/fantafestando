import { beforeEach, describe, expect, test, vi } from "vitest";
import { Binary } from "bson";
import mongoose from "mongoose";
import { getThermalContentWidth } from "@/lib/easter-egg-config";

const {
    dbConnectMock,
    printJobFindOneAndUpdateMock,
    printJobFindOneMock,
    printJobUpdateOneMock,
    printJobExistsMock,
    orderFindOneMock,
    buildPrintQueueLeaseMock,
    claimKitchenPrinterQueueLeaseMock,
    releaseKitchenPrinterQueueLeaseMock,
    completeSumUpPrintIntentsForSentJobMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobFindOneAndUpdateMock: vi.fn(),
    printJobFindOneMock: vi.fn(),
    printJobUpdateOneMock: vi.fn(),
    printJobExistsMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    buildPrintQueueLeaseMock: vi.fn(),
    claimKitchenPrinterQueueLeaseMock: vi.fn(),
    releaseKitchenPrinterQueueLeaseMock: vi.fn(),
    completeSumUpPrintIntentsForSentJobMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/PrintJob", () => ({
    default: {
        findOneAndUpdate: printJobFindOneAndUpdateMock,
        findOne: printJobFindOneMock,
        updateOne: printJobUpdateOneMock,
        exists: printJobExistsMock
    }
}));

vi.mock("@/lib/print-queue", () => ({
    buildPrintQueueLease: buildPrintQueueLeaseMock,
    claimKitchenPrinterQueueLease: claimKitchenPrinterQueueLeaseMock,
    refreshKitchenPrinterQueueLease: vi.fn(),
    releaseKitchenPrinterQueueLease: releaseKitchenPrinterQueueLeaseMock
}));
vi.mock("@/lib/sumup-print-routing", () => ({
    completeSumUpPrintIntentsForSentJob: completeSumUpPrintIntentsForSentJobMock,
    completeSumUpPrintIntentsIfSent: vi.fn()
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

function recoverableKitchenJob() {
    return {
        _id: { toString: () => "job-kitchen" },
        eventId: { toString: () => "evt-1" },
        source: "ORDER",
        printType: "KITCHEN_ORDER",
        queueRecoverable: true,
        copies: 1,
        printerId: {
            _id: "printer-kitchen",
            ip: "printer-emulator",
            port: 19101,
            isVirtual: false
        },
        document: {
            schemaVersion: 2,
            printType: "KITCHEN_ORDER",
            title: "Comanda reparto",
            items: [{ name: "Panino", qty: 1 }]
        }
    };
}

describe("PrinterService.retryPrintJobById", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildPrintQueueLeaseMock.mockReturnValue({
            token: "lease-token",
            expiresAt: new Date("2026-08-12T10:00:00.000Z")
        });
        claimKitchenPrinterQueueLeaseMock.mockResolvedValue(true);
        releaseKitchenPrinterQueueLeaseMock.mockResolvedValue(undefined);
        completeSumUpPrintIntentsForSentJobMock.mockResolvedValue(false);
        printJobExistsMock.mockResolvedValue(false);
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
        expect(completeSumUpPrintIntentsForSentJobMock).toHaveBeenCalledWith("evt-1", "job-1");
        expect(printJobFindOneAndUpdateMock).toHaveBeenCalledWith(
            { _id: "job-1", eventId: "evt-1", status: "FAILED" },
            { $set: { status: "QUEUED", retryClaimedAt: expect.any(Date) } },
            { returnDocument: "after" }
        );
    });

    test("retries a recoverable kitchen print while holding the printer queue lease", async () => {
        mockFindOneJob(recoverableKitchenJob());
        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: true, automaticRetryCount: 0 });

        const result = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

        expect(result).toEqual({ success: true });
        expect(claimKitchenPrinterQueueLeaseMock).toHaveBeenCalledWith(
            "printer-kitchen",
            "lease-token",
            new Date("2026-08-12T10:00:00.000Z")
        );
        expect(dispatchSpy).toHaveBeenCalledOnce();
        expect(releaseKitchenPrinterQueueLeaseMock).toHaveBeenCalledWith("printer-kitchen", "lease-token");
    });

    test("returns a recoverable kitchen retry to failed when the printer lease is busy", async () => {
        const job = recoverableKitchenJob();
        mockFindOneJob(job);
        claimKitchenPrinterQueueLeaseMock.mockResolvedValue(false);
        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        );

        const result = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

        const retryClaimedAt = printJobFindOneAndUpdateMock.mock.calls[0][1].$set.retryClaimedAt;
        const error = "La stampante sta già inviando una comanda. Riprova tra poco.";
        expect(result).toEqual({ success: false, error });
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: job._id, eventId: "evt-1", status: "QUEUED", retryClaimedAt },
            { $set: { status: "FAILED", errorMessage: error }, $unset: { retryClaimedAt: 1 } }
        );
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(releaseKitchenPrinterQueueLeaseMock).not.toHaveBeenCalled();
    });

    test("does not let a recoverable kitchen retry bypass an existing held queue", async () => {
        const job = recoverableKitchenJob();
        mockFindOneJob(job);
        printJobExistsMock.mockResolvedValue(true);
        const dispatchSpy = vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        );

        const result = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

        const retryClaimedAt = printJobFindOneAndUpdateMock.mock.calls[0][1].$set.retryClaimedAt;
        const error = "Ci sono già stampe reparto in coda. Attendi il completamento prima di riprovare.";
        expect(result).toEqual({ success: false, error });
        expect(printJobExistsMock).toHaveBeenCalledWith(expect.objectContaining({
            eventId: "evt-1",
            printerId: "printer-kitchen",
            queueRecoverable: true,
            status: { $in: ["HELD", "QUEUED"] },
            heldSince: { $exists: true }
        }));
        expect(printJobUpdateOneMock).toHaveBeenCalledWith(
            { _id: job._id, eventId: "evt-1", status: "QUEUED", retryClaimedAt },
            { $set: { status: "FAILED", errorMessage: error }, $unset: { retryClaimedAt: 1 } }
        );
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(releaseKitchenPrinterQueueLeaseMock).toHaveBeenCalledWith("printer-kitchen", "lease-token");
    });

    test("releases the printer queue lease when a recoverable kitchen retry is interrupted", async () => {
        mockFindOneJob(recoverableKitchenJob());
        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockRejectedValue(new Error("render failed"));

        const result = await PrinterService.retryPrintJobById("evt-1", "job-kitchen");

        expect(result).toEqual({ success: false, error: "Reinvio stampa interrotto" });
        expect(releaseKitchenPrinterQueueLeaseMock).toHaveBeenCalledWith("printer-kitchen", "lease-token");
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

    test("dispatches a queue-owned kitchen job without mutating its status", async () => {
        printJobFindOneMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    printerId: {
                        ip: "printer-emulator",
                        port: 19101,
                        type: "KITCHEN",
                        isVirtual: false
                    },
                    copies: 1,
                    document: {
                        schemaVersion: 2,
                        printType: "KITCHEN_ORDER",
                        title: "Comanda reparto",
                        copyLabel: "CUCINA",
                        items: [{ name: "Panino", qty: 1 }],
                        totals: []
                    }
                })
            })
        });
        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: true, rawCapturePath: "/tmp/kitchen.raw", automaticRetryCount: 0 });

        await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1")).resolves.toEqual({
            success: true,
            rawCapturePath: "/tmp/kitchen.raw",
            automaticRetryCount: 0
        });
        expect(printJobFindOneMock).toHaveBeenCalledWith(expect.objectContaining({
            _id: "job-1",
            eventId: "evt-1",
            status: "QUEUED",
            printType: "KITCHEN_ORDER",
            queueRecoverable: true,
            queueClaimToken: { $exists: true }
        }));
        expect(printJobUpdateOneMock).not.toHaveBeenCalled();
    });

    test("classifies physical dispatch failures as recoverable for the queue", async () => {
        printJobFindOneMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    printerId: { ip: "printer-emulator", port: 19101, type: "KITCHEN" },
                    copies: 1,
                    document: { title: "Comanda reparto", items: [] }
                })
            })
        });
        vi.spyOn(
            PrinterService as unknown as { dispatchPrintDocumentWithAutomaticRetry: (params: unknown) => Promise<unknown> },
            "dispatchPrintDocumentWithAutomaticRetry"
        ).mockResolvedValue({ success: false, errorMessage: "Printer not reachable", automaticRetryCount: 5 });

        await expect(PrinterService.dispatchHeldKitchenPrintJob("evt-1", "job-1")).resolves.toEqual({
            success: false,
            recoverable: true,
            error: "Printer not reachable",
            automaticRetryCount: 5
        });
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
