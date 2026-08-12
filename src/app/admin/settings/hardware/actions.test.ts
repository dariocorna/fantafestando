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
    printerFindOne: vi.fn(),
    printerFindOneAndDelete: vi.fn(),
    printerFindOneAndUpdate: vi.fn(),
    categoryUpdateMany: vi.fn(),
    posDeviceDeleteMany: vi.fn(),
    posDeviceDistinct: vi.fn(),
    posDeviceUpdateMany: vi.fn(),
    orderExists: vi.fn(),
    peripheralCreate: vi.fn(),
    peripheralDistinct: vi.fn(),
    peripheralFindOne: vi.fn(),
    peripheralFindOneAndDelete: vi.fn(),
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
vi.mock("@/models/Order", () => ({ default: { exists: mocks.orderExists } }));
vi.mock("@/models/Peripheral", () => ({
    default: {
        create: mocks.peripheralCreate,
        distinct: mocks.peripheralDistinct,
        findOne: mocks.peripheralFindOne,
        findOneAndDelete: mocks.peripheralFindOneAndDelete,
        findOneAndUpdate: mocks.peripheralFindOneAndUpdate
    }
}));
vi.mock("@/models/PosDevice", () => ({
    default: {
        deleteMany: mocks.posDeviceDeleteMany,
        distinct: mocks.posDeviceDistinct,
        updateMany: mocks.posDeviceUpdateMany
    }
}));
vi.mock("@/models/PrintJob", () => ({ default: { exists: mocks.printJobExists } }));
vi.mock("@/models/Printer", () => ({
    default: {
        findOne: mocks.printerFindOne,
        findOneAndDelete: mocks.printerFindOneAndDelete,
        findOneAndUpdate: mocks.printerFindOneAndUpdate,
        exists: mocks.printerExists
    }
}));

import {
    createPeripheralAction,
    deletePeripheralAction,
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

function legacySumUpRefundQuery(posDeviceId: string | { $in: string[] }) {
    return {
        eventId: "event-1",
        posDeviceId,
        "sumupRefundCredentials.apiKey": { $in: [null, ""] },
        "stornoMeta.refundStatus": { $ne: "DONE" },
        $or: [
            {
                status: "PAID",
                $or: [
                    { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                    { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                ]
            },
            {
                status: "CANCELLED",
                sumupLateSuccessDetectedAt: { $exists: true, $ne: null }
            }
        ]
    };
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
        mocks.printerFindOne.mockReturnValue(queryResult({
            _id: "printer-1",
            ip: "10.0.0.10",
            port: 9100,
            isVirtual: false,
            type: "KITCHEN"
        }));
        mocks.printerFindOneAndDelete.mockReturnValue(queryResult({ _id: "printer-1" }));
        mocks.printerFindOneAndUpdate.mockReturnValue(queryResult({ _id: "printer-1" }));
        mocks.peripheralDistinct.mockResolvedValue([]);
        mocks.posDeviceDistinct.mockResolvedValue([]);
        mocks.orderExists.mockResolvedValue(false);
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

    test("blocks deleting a cashier printer that would remove a POS with a pending SumUp checkout", async () => {
        mocks.peripheralDistinct.mockResolvedValue(["terminal-1"]);
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockResolvedValue(true);
        const formData = new FormData();
        formData.set("id", "printer-1");
        formData.set("eventId", "event-1");

        await expect(deletePrinterAction(formData)).resolves.toEqual({
            error: expect.stringMatching(/ordine SumUp in attesa/i)
        });

        expect(mocks.peripheralDistinct).toHaveBeenCalledWith("_id", {
            eventId: "event-1",
            type: "SUMUP"
        });
        expect(mocks.posDeviceDistinct).toHaveBeenCalledWith("_id", {
            eventId: "event-1",
            printerId: "printer-1",
            paymentTerminalId: { $in: ["terminal-1"] }
        });
        expect(mocks.orderExists).toHaveBeenCalledWith({
            eventId: "event-1",
            status: "PENDING",
            posDeviceId: { $in: ["pos-1"] },
            sumupCheckoutId: { $exists: true, $nin: [null, ""] }
        });
        expect(mocks.printerFindOneAndDelete).not.toHaveBeenCalled();
        expect(mocks.posDeviceDeleteMany).not.toHaveBeenCalled();
    });

    test("blocks deleting a printer that would remove a POS needed for a legacy SumUp refund", async () => {
        mocks.peripheralDistinct.mockResolvedValue(["terminal-1"]);
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const formData = new FormData();
        formData.set("id", "printer-1");
        formData.set("eventId", "event-1");

        await expect(deletePrinterAction(formData)).resolves.toEqual({
            error: expect.stringMatching(/pagamento SumUp non ancora rimborsato/i)
        });

        expect(mocks.orderExists).toHaveBeenNthCalledWith(
            2,
            legacySumUpRefundQuery({ $in: ["pos-1"] })
        );
        expect(mocks.printerFindOneAndDelete).not.toHaveBeenCalled();
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

    test("blocks changing the destination of a printer used by a pending SumUp checkout", async () => {
        mocks.normalizePrinterConfig.mockReturnValue({
            success: true,
            data: { ip: "10.0.0.20", port: 9100, isVirtual: false, emulatorSlot: undefined }
        });
        mocks.peripheralDistinct.mockResolvedValue(["terminal-1"]);
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockResolvedValue(true);

        await expect(updatePrinterAction(printerForm("KITCHEN"))).resolves.toEqual({
            error: expect.stringMatching(/ordine SumUp in attesa/i)
        });

        expect(mocks.printerFindOne).toHaveBeenCalledWith({ _id: "printer-1", eventId: "event-1" });
        expect(mocks.posDeviceDistinct).toHaveBeenCalledWith("_id", {
            eventId: "event-1",
            printerId: "printer-1",
            paymentTerminalId: { $in: ["terminal-1"] }
        });
        expect(mocks.orderExists).toHaveBeenCalledWith({
            eventId: "event-1",
            status: "PENDING",
            posDeviceId: { $in: ["pos-1"] },
            sumupCheckoutId: { $exists: true, $nin: [null, ""] }
        });
        expect(mocks.printerFindOneAndUpdate).not.toHaveBeenCalled();
    });

    test("does not apply the legacy refund guard when updating a printer", async () => {
        mocks.normalizePrinterConfig.mockReturnValue({
            success: true,
            data: { ip: "10.0.0.20", port: 9100, isVirtual: false, emulatorSlot: undefined }
        });
        mocks.peripheralDistinct.mockResolvedValue(["terminal-1"]);
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockImplementation(async (query: Record<string, unknown>) => (
            "sumupRefundCredentials.apiKey" in query
        ));

        await expect(updatePrinterAction(printerForm("KITCHEN"))).resolves.toEqual({ success: true });

        expect(mocks.orderExists).toHaveBeenCalledTimes(1);
        expect(mocks.orderExists).toHaveBeenCalledWith({
            eventId: "event-1",
            status: "PENDING",
            posDeviceId: { $in: ["pos-1"] },
            sumupCheckoutId: { $exists: true, $nin: [null, ""] }
        });
        expect(mocks.printerFindOneAndUpdate).toHaveBeenCalled();
    });

    test("allows renaming a printer used by a pending SumUp checkout", async () => {
        mocks.peripheralDistinct.mockResolvedValue(["terminal-1"]);
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockResolvedValue(true);
        const formData = printerForm("KITCHEN");
        formData.set("name", "Cucina rinominata");

        await expect(updatePrinterAction(formData)).resolves.toEqual({ success: true });

        expect(mocks.peripheralDistinct).not.toHaveBeenCalled();
        expect(mocks.posDeviceDistinct).not.toHaveBeenCalled();
        expect(mocks.orderExists).not.toHaveBeenCalled();
        expect(mocks.printerFindOneAndUpdate).toHaveBeenCalledWith(
            { _id: "printer-1", eventId: "event-1" },
            expect.objectContaining({
                name: "Cucina rinominata",
                ip: "10.0.0.10",
                port: 9100,
                type: "KITCHEN"
            }),
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
        mocks.peripheralFindOneAndDelete.mockReturnValue(queryResult({ _id: "peripheral-1" }));
        mocks.peripheralDistinct.mockResolvedValue([]);
        mocks.posDeviceDistinct.mockResolvedValue([]);
        mocks.posDeviceUpdateMany.mockResolvedValue({ acknowledged: true });
        mocks.orderExists.mockResolvedValue(false);
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
                type: "SUMUP",
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
                type: "SUMUP",
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
                type: "SUMUP",
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
                type: "SUMUP",
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
            lean: vi.fn().mockResolvedValue({ _id: "peripheral-1", type: "SUMUP" })
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

    test.each([
        { type: "SUMUP", apiKey: "sup_sk_replacement", affiliateKey: "affiliate-replacement" },
        { type: "ELECTRONIC_MANUAL", apiKey: "", affiliateKey: "" }
    ])("blocks changing SumUp credentials or type while a checkout is pending", async (changes) => {
        mocks.peripheralFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: "peripheral-1",
                type: "SUMUP",
                config: {
                    merchantCode: "MK10CL2A",
                    readerId: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65",
                    apiKey: "encrypted:old-api",
                    affiliateAppId: "it.fantafestando.pos",
                    affiliateKey: "encrypted:old-affiliate"
                }
            })
        });
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockResolvedValue(true);

        await expect(updatePeripheralAction(sumUpForm(changes))).resolves.toEqual({
            error: expect.stringMatching(/ordine SumUp in attesa/i)
        });

        expect(mocks.posDeviceDistinct).toHaveBeenCalledWith("_id", {
            eventId: "event-1",
            paymentTerminalId: "peripheral-1"
        });
        expect(mocks.orderExists).toHaveBeenCalledWith({
            eventId: "event-1",
            status: "PENDING",
            posDeviceId: { $in: ["pos-1"] },
            sumupCheckoutId: { $exists: true, $nin: [null, ""] }
        });
        expect(mocks.encryptSecret).not.toHaveBeenCalled();
        expect(mocks.peripheralFindOneAndUpdate).not.toHaveBeenCalled();
    });

    test.each([
        { type: "SUMUP", apiKey: "sup_sk_replacement", affiliateKey: "affiliate-replacement" },
        { type: "ELECTRONIC_MANUAL", apiKey: "", affiliateKey: "" }
    ])("blocks changing SumUp credentials or type needed for a legacy refund", async (changes) => {
        mocks.peripheralFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: "peripheral-1",
                type: "SUMUP",
                config: {
                    merchantCode: "MK10CL2A",
                    readerId: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65",
                    apiKey: "encrypted:old-api",
                    affiliateAppId: "it.fantafestando.pos",
                    affiliateKey: "encrypted:old-affiliate"
                }
            })
        });
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        await expect(updatePeripheralAction(sumUpForm(changes))).resolves.toEqual({
            error: expect.stringMatching(/pagamento SumUp non ancora rimborsato/i)
        });

        expect(mocks.orderExists).toHaveBeenNthCalledWith(
            2,
            legacySumUpRefundQuery({ $in: ["pos-1"] })
        );
        expect(mocks.encryptSecret).not.toHaveBeenCalled();
        expect(mocks.peripheralFindOneAndUpdate).not.toHaveBeenCalled();
    });

    test("allows renaming a SumUp peripheral used as a legacy refund fallback", async () => {
        mocks.peripheralFindOne.mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                _id: "peripheral-1",
                type: "SUMUP",
                config: {
                    merchantCode: "MK10CL2A",
                    readerId: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65",
                    apiKey: "encrypted:old-api",
                    affiliateAppId: "it.fantafestando.pos",
                    affiliateKey: "encrypted:old-affiliate"
                }
            })
        });
        mocks.orderExists.mockResolvedValue(true);

        await expect(updatePeripheralAction(sumUpForm({
            name: "SumUp rinominato",
            apiKey: "",
            affiliateKey: ""
        }))).resolves.toEqual({ success: true });

        expect(mocks.posDeviceDistinct).not.toHaveBeenCalled();
        expect(mocks.orderExists).not.toHaveBeenCalled();
        expect(mocks.peripheralFindOneAndUpdate).toHaveBeenCalled();
    });

    test("blocks deleting a SumUp peripheral while a checkout is pending", async () => {
        mocks.peripheralFindOne.mockReturnValue(queryResult({ _id: "peripheral-1", type: "SUMUP" }));
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockResolvedValue(true);

        await expect(deletePeripheralAction(sumUpForm())).resolves.toEqual({
            error: expect.stringMatching(/ordine SumUp in attesa/i)
        });

        expect(mocks.peripheralFindOneAndDelete).not.toHaveBeenCalled();
        expect(mocks.posDeviceUpdateMany).not.toHaveBeenCalled();
    });

    test("blocks deleting a SumUp peripheral needed for a legacy refund", async () => {
        mocks.peripheralFindOne.mockReturnValue(queryResult({ _id: "peripheral-1", type: "SUMUP" }));
        mocks.posDeviceDistinct.mockResolvedValue(["pos-1"]);
        mocks.orderExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        await expect(deletePeripheralAction(sumUpForm())).resolves.toEqual({
            error: expect.stringMatching(/pagamento SumUp non ancora rimborsato/i)
        });

        expect(mocks.orderExists).toHaveBeenNthCalledWith(
            2,
            legacySumUpRefundQuery({ $in: ["pos-1"] })
        );
        expect(mocks.peripheralFindOneAndDelete).not.toHaveBeenCalled();
        expect(mocks.posDeviceUpdateMany).not.toHaveBeenCalled();
    });

    test.each(["ELECTRONIC_MANUAL", "CASH_BOX"])(
        "allows deleting a %s peripheral without checking pending SumUp orders",
        async (type) => {
            mocks.peripheralFindOne.mockReturnValue(queryResult({
                _id: "peripheral-1",
                type
            }));

            await expect(deletePeripheralAction(sumUpForm())).resolves.toEqual({ success: true });

            expect(mocks.posDeviceDistinct).not.toHaveBeenCalled();
            expect(mocks.orderExists).not.toHaveBeenCalled();
            expect(mocks.peripheralFindOneAndDelete).toHaveBeenCalled();
            expect(mocks.posDeviceUpdateMany).toHaveBeenCalledTimes(2);
        }
    );
});
