import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    requireContextEventId: vi.fn(),
    resolveEventScope: vi.fn(),
    dbConnect: vi.fn(),
    revalidatePath: vi.fn(),
    normalizePrinterConfig: vi.fn(),
    recoverStaleLiveKitchenPrintJobs: vi.fn(),
    printJobExists: vi.fn(),
    printerExists: vi.fn(),
    printerFindOneAndDelete: vi.fn(),
    printerFindOneAndUpdate: vi.fn(),
    categoryUpdateMany: vi.fn(),
    posDeviceDeleteMany: vi.fn(),
    peripheralCreate: vi.fn(),
    peripheralFindOne: vi.fn(),
    peripheralFindOneAndUpdate: vi.fn(),
    encryptSecret: vi.fn((value: string) => `encrypted:${value}`)
}));

vi.mock("../action-context", () => ({
    requireAdminAuthorization: mocks.authorize,
    requireContextEventId: mocks.requireContextEventId,
    resolveEventScope: mocks.resolveEventScope
}));
vi.mock("@/lib/mongoose", () => ({ default: mocks.dbConnect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/print-branding", () => ({
    sanitizePrintableHeaderLogoUrl: vi.fn(),
    sanitizeReceiptHeaderLogoUrl: vi.fn()
}));
vi.mock("@/lib/printer", () => ({ PrinterService: {} }));
vi.mock("@/lib/printer-config", () => ({
    DEFAULT_PRINTER_PORT: 9100,
    MAX_VIRTUAL_PRINTER_SLOTS: 10,
    normalizePrinterConfig: mocks.normalizePrinterConfig
}));
vi.mock("@/lib/print-queue", () => ({
    recoverStaleLiveKitchenPrintJobs: mocks.recoverStaleLiveKitchenPrintJobs
}));
vi.mock("@/lib/secrets", () => ({ encryptSecret: mocks.encryptSecret }));
vi.mock("@/models/Category", () => ({ default: { updateMany: mocks.categoryUpdateMany } }));
vi.mock("@/models/Event", () => ({ default: {} }));
vi.mock("@/models/Peripheral", () => ({
    default: {
        create: mocks.peripheralCreate,
        findOne: mocks.peripheralFindOne,
        findOneAndUpdate: mocks.peripheralFindOneAndUpdate
    }
}));
vi.mock("@/models/PosDevice", () => ({ default: { deleteMany: mocks.posDeviceDeleteMany } }));
vi.mock("@/models/PrintJob", () => ({ default: { exists: mocks.printJobExists } }));
vi.mock("@/models/Printer", () => ({
    default: {
        findOneAndDelete: mocks.printerFindOneAndDelete,
        findOneAndUpdate: mocks.printerFindOneAndUpdate,
        exists: mocks.printerExists
    }
}));

import {
    createPeripheralAction,
    deletePrinterAction,
    updatePeripheralAction,
    updatePrinterAction
} from "./actions";

function queryResult(value: unknown) {
    return {
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(value)
        })
    };
}

function printerForm(type: "CASHIER" | "KITCHEN") {
    const formData = new FormData();
    formData.set("id", "printer-1");
    formData.set("eventId", "event-1");
    formData.set("name", "Cucina");
    formData.set("ip", "10.0.0.10");
    formData.set("port", "9100");
    formData.set("type", type);
    return formData;
}

function sumUpForm(overrides: Record<string, string | undefined> = {}) {
    const formData = new FormData();
    const fields = {
        id: "peripheral-1",
        eventId: "event-1",
        name: "SumUp Front",
        type: "SUMUP",
        merchantCode: "MK10CL2A",
        readerId: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65",
        apiKey: "sup_sk_api",
        affiliateAppId: "it.fantafestando.pos",
        affiliateKey: "affiliate-secret",
        ...overrides
    };
    Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined) formData.set(key, value);
    });
    return formData;
}

describe("printer queue lifecycle guards", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockResolvedValue(null);
        mocks.requireContextEventId.mockResolvedValue("event-1");
        mocks.resolveEventScope.mockReturnValue({ eventId: "event-1" });
        mocks.dbConnect.mockResolvedValue(undefined);
        mocks.normalizePrinterConfig.mockReturnValue({
            success: true,
            data: { ip: "10.0.0.10", port: 9100, isVirtual: false, emulatorSlot: undefined }
        });
        mocks.printJobExists.mockResolvedValue(false);
        mocks.recoverStaleLiveKitchenPrintJobs.mockResolvedValue({ recovered: 0 });
        mocks.printerExists.mockResolvedValue(null);
        mocks.printerFindOneAndDelete.mockReturnValue(queryResult({ _id: "printer-1" }));
        mocks.printerFindOneAndUpdate.mockReturnValue(queryResult({ _id: "printer-1" }));
    });

    test("blocks deletion while held or claimed jobs still reference the printer", async () => {
        mocks.printJobExists.mockResolvedValue(true);
        const formData = new FormData();
        formData.set("id", "printer-1");
        formData.set("eventId", "event-1");

        await expect(deletePrinterAction(formData)).resolves.toEqual({
            error: expect.stringMatching(/stampe reparto in attesa o in invio/i)
        });

        expect(mocks.printJobExists).toHaveBeenCalledWith({
            eventId: "event-1",
            printerId: "printer-1",
            queueRecoverable: true,
            status: { $in: ["HELD", "QUEUED"] }
        });
        expect(mocks.recoverStaleLiveKitchenPrintJobs).toHaveBeenCalledWith({
            eventId: "event-1",
            printerId: "printer-1"
        });
        expect(mocks.printerFindOneAndDelete).not.toHaveBeenCalled();
        expect(mocks.categoryUpdateMany).not.toHaveBeenCalled();
        expect(mocks.posDeviceDeleteMany).not.toHaveBeenCalled();
    });

    test("blocks deletion atomically while a live department print owns the lease", async () => {
        mocks.printerFindOneAndDelete.mockReturnValue(queryResult(null));
        mocks.printerExists.mockResolvedValue({ _id: "printer-1" });
        const formData = new FormData();
        formData.set("id", "printer-1");
        formData.set("eventId", "event-1");

        await expect(deletePrinterAction(formData)).resolves.toEqual({
            error: expect.stringMatching(/stampe reparto in attesa o in invio/i)
        });

        expect(mocks.printerFindOneAndDelete).toHaveBeenCalledWith({
            _id: "printer-1",
            eventId: "event-1",
            $or: [
                { printQueueLeaseToken: { $exists: false } },
                { printQueueLeaseExpiresAt: { $exists: false } },
                { printQueueLeaseExpiresAt: { $lte: expect.any(Date) } }
            ]
        });
        expect(mocks.printerExists).toHaveBeenCalledWith({ _id: "printer-1", eventId: "event-1" });
        expect(mocks.categoryUpdateMany).not.toHaveBeenCalled();
        expect(mocks.posDeviceDeleteMany).not.toHaveBeenCalled();
    });

    test("blocks changing a queued department printer to CASHIER", async () => {
        mocks.printJobExists.mockResolvedValue(true);

        await expect(updatePrinterAction(printerForm("CASHIER"))).resolves.toEqual({
            error: expect.stringMatching(/stampe reparto in attesa o in invio/i)
        });

        expect(mocks.printJobExists).toHaveBeenCalledTimes(1);
        expect(mocks.recoverStaleLiveKitchenPrintJobs).toHaveBeenCalledWith({
            eventId: "event-1",
            printerId: "printer-1"
        });
        expect(mocks.printerFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });

    test("allows updating a KITCHEN printer so its held queue can recover", async () => {
        await expect(updatePrinterAction(printerForm("KITCHEN"))).resolves.toEqual({ success: true });

        expect(mocks.printJobExists).not.toHaveBeenCalled();
        expect(mocks.printerFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: "printer-1", eventId: "event-1" },
            expect.objectContaining({ type: "KITCHEN", ip: "10.0.0.10", port: 9100 }),
            { returnDocument: "after" }
        );
    });

    test("blocks changing a printer to CASHIER atomically while a live department print owns the lease", async () => {
        mocks.printerFindOneAndUpdate.mockReturnValue(queryResult(null));
        mocks.printerExists.mockResolvedValue({ _id: "printer-1" });

        await expect(updatePrinterAction(printerForm("CASHIER"))).resolves.toEqual({
            error: expect.stringMatching(/stampe reparto in attesa o in invio/i)
        });

        expect(mocks.printerFindOneAndUpdate).toHaveBeenCalledWith(
            {
                _id: "printer-1",
                eventId: "event-1",
                $or: [
                    { printQueueLeaseToken: { $exists: false } },
                    { printQueueLeaseExpiresAt: { $exists: false } },
                    { printQueueLeaseExpiresAt: { $lte: expect.any(Date) } }
                ]
            },
            expect.objectContaining({ type: "CASHIER" }),
            { returnDocument: "after" }
        );
        expect(mocks.printerExists).toHaveBeenCalledWith({ _id: "printer-1", eventId: "event-1" });
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
});

describe("SumUp peripheral configuration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.authorize.mockResolvedValue(null);
        mocks.requireContextEventId.mockResolvedValue("event-1");
        mocks.resolveEventScope.mockReturnValue({ eventId: "event-1" });
        mocks.dbConnect.mockResolvedValue(undefined);
        mocks.peripheralCreate.mockResolvedValue({ _id: "peripheral-1" });
        mocks.peripheralFindOneAndUpdate.mockResolvedValue({ _id: "peripheral-1" });
    });

    test("creates a complete Cloud API configuration with both secrets encrypted", async () => {
        await expect(createPeripheralAction(sumUpForm({ id: undefined }))).resolves.toEqual({ success: true });

        expect(mocks.peripheralCreate).toHaveBeenCalledWith({
            eventId: "event-1",
            name: "SumUp Front",
            type: "SUMUP",
            config: {
                merchantCode: "MK10CL2A",
                readerId: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65",
                apiKey: "encrypted:sup_sk_api",
                affiliateAppId: "it.fantafestando.pos",
                affiliateKey: "encrypted:affiliate-secret"
            }
        });
        expect(mocks.encryptSecret).toHaveBeenNthCalledWith(1, "sup_sk_api");
        expect(mocks.encryptSecret).toHaveBeenNthCalledWith(2, "affiliate-secret");
    });

    test("rejects an incomplete Cloud API configuration before persisting it", async () => {
        const result = await createPeripheralAction(sumUpForm({ id: undefined, readerId: "" }));

        expect(result).toEqual({
            error: "Merchant Code, Reader ID, API Key, Affiliate App ID e Affiliate Key sono obbligatori per terminali SumUp"
        });
        expect(mocks.dbConnect).not.toHaveBeenCalled();
        expect(mocks.peripheralCreate).not.toHaveBeenCalled();
    });

    test("preserves encrypted secrets when an update leaves password fields empty", async () => {
        mocks.peripheralFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: "peripheral-1",
                config: {
                    merchantCode: "OLD-MERCHANT",
                    readerId: "old-reader",
                    apiKey: "encrypted:stored-api",
                    affiliateAppId: "old.app",
                    affiliateKey: "encrypted:stored-affiliate"
                }
            })
        });

        await expect(updatePeripheralAction(sumUpForm({ apiKey: "", affiliateKey: "" }))).resolves.toEqual({ success: true });

        expect(mocks.peripheralFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: "peripheral-1", eventId: "event-1" },
            {
                name: "SumUp Front",
                type: "SUMUP",
                config: {
                    merchantCode: "MK10CL2A",
                    readerId: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65",
                    apiKey: "encrypted:stored-api",
                    affiliateAppId: "it.fantafestando.pos",
                    affiliateKey: "encrypted:stored-affiliate"
                }
            },
            { returnDocument: "after" }
        );
        expect(mocks.encryptSecret).not.toHaveBeenCalled();
    });

    test("encrypts replacement secrets during an update", async () => {
        mocks.peripheralFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: "peripheral-1",
                config: {
                    merchantCode: "MK10CL2A",
                    readerId: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65",
                    apiKey: "encrypted:old-api",
                    affiliateAppId: "it.fantafestando.pos",
                    affiliateKey: "encrypted:old-affiliate"
                }
            })
        });

        await expect(updatePeripheralAction(sumUpForm())).resolves.toEqual({ success: true });

        expect(mocks.peripheralFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: "peripheral-1", eventId: "event-1" },
            expect.objectContaining({
                config: expect.objectContaining({
                    apiKey: "encrypted:sup_sk_api",
                    affiliateKey: "encrypted:affiliate-secret"
                })
            }),
            { returnDocument: "after" }
        );
    });

    test.each([
        { apiKey: "sup_sk_replacement", affiliateKey: "" },
        { apiKey: "", affiliateKey: "affiliate-replacement" }
    ])("requires both new secrets when migrating a legacy SumUp configuration", async (secrets) => {
        mocks.peripheralFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: "peripheral-1",
                config: {
                    merchantId: "legacy-merchant",
                    affiliateKey: "encrypted:legacy-api-key"
                }
            })
        });

        const result = await updatePeripheralAction(sumUpForm(secrets));

        expect(result).toEqual({
            error: "Per migrare il terminale SumUp inserisci sia API Key sia Affiliate Key"
        });
        expect(mocks.encryptSecret).not.toHaveBeenCalled();
        expect(mocks.peripheralFindOneAndUpdate).not.toHaveBeenCalled();
    });

    test("replaces the legacy API credential without reusing it as Affiliate Key", async () => {
        mocks.peripheralFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: "peripheral-1",
                config: {
                    merchantId: "legacy-merchant",
                    affiliateKey: "encrypted:legacy-api-key"
                }
            })
        });

        await expect(updatePeripheralAction(sumUpForm())).resolves.toEqual({ success: true });

        expect(mocks.peripheralFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: "peripheral-1", eventId: "event-1" },
            expect.objectContaining({
                config: expect.objectContaining({
                    apiKey: "encrypted:sup_sk_api",
                    affiliateKey: "encrypted:affiliate-secret"
                })
            }),
            { returnDocument: "after" }
        );
    });

    test("returns a validation error instead of crashing on an incomplete stored record", async () => {
        mocks.peripheralFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({ _id: "peripheral-1" })
        });

        const result = await updatePeripheralAction(sumUpForm({
            merchantCode: "",
            readerId: "",
            apiKey: "",
            affiliateAppId: "",
            affiliateKey: ""
        }));

        expect(result).toEqual({
            error: "Merchant Code, Reader ID, API Key, Affiliate App ID e Affiliate Key sono obbligatori per terminali SumUp"
        });
        expect(mocks.peripheralFindOneAndUpdate).not.toHaveBeenCalled();
    });
});
