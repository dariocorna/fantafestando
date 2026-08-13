"use server";

import dbConnect from "@/lib/mongoose";
import {
    sanitizePrintableHeaderLogoUrl,
    sanitizeReceiptHeaderLogoUrl
} from "@/lib/print-branding";
import { PrinterService } from "@/lib/printer";
import {
    DEFAULT_PRINTER_PORT,
    MAX_VIRTUAL_PRINTER_SLOTS,
    normalizePrinterConfig
} from "@/lib/printer-config";
import { recoverStaleLiveKitchenPrintJobs } from "@/lib/print-queue";
import { encryptSecret } from "@/lib/secrets";
import { hasPendingSumUpPrintRouting } from "@/lib/sumup-print-routing";
import Category from "@/models/Category";
import Event from "@/models/Event";
import Order from "@/models/Order";
import Peripheral from "@/models/Peripheral";
import PosDevice from "@/models/PosDevice";
import PrintJob from "@/models/PrintJob";
import Printer from "@/models/Printer";
import Product from "@/models/Product";
import { revalidatePath } from "next/cache";
import {
    requireAdminAuthorization,
    requireContextEventId,
    resolveEventScope
} from "../action-context";

function revalidateHardwareViews() {
    revalidatePath("/admin/settings/hardware");
    revalidatePath("/admin/settings/pos");
}

function getConfigString(config: unknown, key: string): string | undefined {
    if (!config || typeof config !== "object") return undefined;
    const value = (config as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

function hasPendingPrintQueue(eventId: string, printerId: string) {
    return PrintJob.exists({
        eventId,
        printerId,
        queueRecoverable: true,
        status: { $in: ["HELD", "QUEUED"] }
    });
}

function availablePrintQueueLease(now: Date = new Date()) {
    return {
        $or: [
            { printQueueLeaseToken: { $exists: false } },
            { printQueueLeaseExpiresAt: { $exists: false } },
            { printQueueLeaseExpiresAt: { $lte: now } }
        ]
    };
}

const PENDING_SUMUP_HARDWARE_ERROR = "Operazione bloccata: un ordine SumUp in attesa usa questa configurazione hardware. Completa o recupera il pagamento prima di modificarla.";
const LEGACY_SUMUP_REFUND_HARDWARE_ERROR = "Operazione bloccata: un pagamento SumUp non ancora rimborsato usa questa configurazione hardware. Completa il rimborso prima di modificarla.";

async function hasPendingSumUpCheckout(
    eventId: string,
    posDeviceFilter: Record<string, unknown>
) {
    const posDeviceIds = (await PosDevice.distinct("_id", { eventId, ...posDeviceFilter }))
        .map((value: unknown) => String(value ?? "").trim())
        .filter(Boolean);

    if (posDeviceIds.length === 0) return false;

    return Boolean(await Order.exists({
        eventId,
        status: "PENDING",
        posDeviceId: { $in: posDeviceIds },
        sumupCheckoutId: { $exists: true, $nin: [null, ""] }
    }));
}

async function hasPendingSumUpPrinterDependency(eventId: string, printerIds: string[]) {
    if (printerIds.length === 0) return false;

    const sumUpTerminalIds = await Peripheral.distinct("_id", { eventId, type: "SUMUP" });
    if (sumUpTerminalIds.length > 0 && await hasPendingSumUpCheckout(eventId, {
        printerId: { $in: printerIds },
        paymentTerminalId: { $in: sumUpTerminalIds }
    })) {
        return true;
    }

    const categoryIds = await Category.distinct("_id", { eventId, printerId: { $in: printerIds } });
    const productIds = categoryIds.length > 0
        ? (await Product.distinct("_id", { eventId, categoryId: { $in: categoryIds } }))
            .map((value: unknown) => String(value))
        : [];
    return hasPendingSumUpPrintRouting(eventId, productIds);
}

async function hasLegacySumUpRefundDependency(
    eventId: string,
    posDeviceFilter: Record<string, unknown>
) {
    const posDeviceIds = (await PosDevice.distinct("_id", { eventId, ...posDeviceFilter }))
        .map((value: unknown) => String(value ?? "").trim())
        .filter(Boolean);

    if (posDeviceIds.length === 0) return false;

    return Boolean(await Order.exists({
        eventId,
        posDeviceId: { $in: posDeviceIds },
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
    }));
}

export async function createPrinterAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const submittedEventId = formData.get("eventId") as string | null;
    const name = formData.get("name") as string;
    const ip = formData.get("ip");
    const port = formData.get("port");
    const isVirtual = formData.get("isVirtual") === "on";
    const emulatorSlot = formData.get("emulatorSlot");
    const type = formData.get("type") as "CASHIER" | "KITCHEN";

    if (!name || !type) return { error: "Dati mancanti" };

    const normalizedConfig = normalizePrinterConfig({
        ip,
        port,
        isVirtual,
        emulatorSlot
    });
    if (!normalizedConfig.success) return { error: normalizedConfig.error };

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };

    await dbConnect();
    await Printer.create({
        eventId: scopedEvent.eventId,
        name: name.trim(),
        ip: normalizedConfig.data.ip,
        port: normalizedConfig.data.port,
        isVirtual: normalizedConfig.data.isVirtual,
        emulatorSlot: normalizedConfig.data.emulatorSlot,
        type
    });

    revalidateHardwareViews();
    return { success: true };
}

export async function deletePrinterAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const id = formData.get("id") as string;
    const submittedEventId = formData.get("eventId") as string | null;
    if (!id) return { error: "ID stampante mancante" };

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };
    const scopedEventId = scopedEvent.eventId;

    await dbConnect();
    await recoverStaleLiveKitchenPrintJobs({ eventId: scopedEventId, printerId: id });
    if (await hasPendingPrintQueue(scopedEventId, id)) {
        return { error: "La stampante ha stampe reparto in attesa o in invio. Attendi lo svuotamento della coda prima di eliminarla." };
    }
    const sumUpTerminalIds = await Peripheral.distinct("_id", { eventId: scopedEventId, type: "SUMUP" });
    if (sumUpTerminalIds.length > 0 && await hasPendingSumUpCheckout(scopedEventId, {
        printerId: id,
        paymentTerminalId: { $in: sumUpTerminalIds }
    })) {
        return { error: PENDING_SUMUP_HARDWARE_ERROR };
    }
    if (sumUpTerminalIds.length > 0 && await hasLegacySumUpRefundDependency(scopedEventId, {
        printerId: id,
        paymentTerminalId: { $in: sumUpTerminalIds }
    })) {
        return { error: LEGACY_SUMUP_REFUND_HARDWARE_ERROR };
    }
    const deletedPrinter = await Printer.findOneAndDelete({
        _id: id,
        eventId: scopedEventId,
        ...availablePrintQueueLease()
    }).select("_id").lean();
    if (!deletedPrinter) {
        if (await Printer.exists({ _id: id, eventId: scopedEventId })) {
            return { error: "La stampante ha stampe reparto in attesa o in invio. Attendi lo svuotamento della coda prima di eliminarla." };
        }
        return { error: "Stampante non trovata nella festa selezionata" };
    }

    await Category.updateMany({ eventId: scopedEventId, printerId: id }, { $unset: { printerId: 1 } });
    await PosDevice.deleteMany({ eventId: scopedEventId, printerId: id });

    revalidateHardwareViews();
    return { success: true };
}

export async function updatePrinterAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const id = formData.get("id") as string;
    const submittedEventId = formData.get("eventId") as string | null;
    const name = formData.get("name") as string;
    const ip = formData.get("ip");
    const port = formData.get("port");
    const isVirtual = formData.get("isVirtual") === "on";
    const emulatorSlot = formData.get("emulatorSlot");
    const type = formData.get("type") as "CASHIER" | "KITCHEN";

    if (!id || !name || !type) return { error: "Dati mancanti" };

    const normalizedConfig = normalizePrinterConfig({
        ip,
        port,
        isVirtual,
        emulatorSlot
    });
    if (!normalizedConfig.success) return { error: normalizedConfig.error };

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };

    await dbConnect();
    if (type === "CASHIER") {
        await recoverStaleLiveKitchenPrintJobs({ eventId: scopedEvent.eventId, printerId: id });
    }
    if (type === "CASHIER" && await hasPendingPrintQueue(scopedEvent.eventId, id)) {
        return { error: "La stampante ha stampe reparto in attesa o in invio. Attendi lo svuotamento della coda prima di cambiarne il tipo." };
    }
    const currentPrinter = await Printer.findOne({ _id: id, eventId: scopedEvent.eventId })
        .select("_id ip port isVirtual emulatorSlot type")
        .lean() as ({
            ip?: string;
            port?: number;
            isVirtual?: boolean;
            emulatorSlot?: number | null;
            type?: "CASHIER" | "KITCHEN";
        } | null);
    if (!currentPrinter) {
        return { error: "Stampante non trovata nella festa selezionata" };
    }
    const changesPrintDestination = currentPrinter.ip !== normalizedConfig.data.ip
        || currentPrinter.port !== normalizedConfig.data.port
        || currentPrinter.isVirtual !== normalizedConfig.data.isVirtual
        || (currentPrinter.emulatorSlot ?? undefined) !== normalizedConfig.data.emulatorSlot
        || currentPrinter.type !== type;
    if (changesPrintDestination) {
        if (await hasPendingSumUpPrinterDependency(scopedEvent.eventId, [id])) {
            return { error: PENDING_SUMUP_HARDWARE_ERROR };
        }
    }
    const updatedPrinter = await Printer.findOneAndUpdate(
        {
            _id: id,
            eventId: scopedEvent.eventId,
            ...(type === "CASHIER" ? availablePrintQueueLease() : {})
        },
        {
            name: name.trim(),
            ip: normalizedConfig.data.ip,
            port: normalizedConfig.data.port,
            isVirtual: normalizedConfig.data.isVirtual,
            emulatorSlot: normalizedConfig.data.emulatorSlot,
            type
        },
        { returnDocument: "after" }
    ).select("_id").lean();

    if (!updatedPrinter) {
        if (type === "CASHIER" && await Printer.exists({ _id: id, eventId: scopedEvent.eventId })) {
            return { error: "La stampante ha stampe reparto in attesa o in invio. Attendi lo svuotamento della coda prima di cambiarne il tipo." };
        }
        return { error: "Stampante non trovata nella festa selezionata" };
    }

    revalidateHardwareViews();
    return { success: true };
}

export async function provisionVirtualPrintersAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const submittedEventId = formData.get("eventId") as string | null;
    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };

    await dbConnect();

    const createdOrUpdated: string[] = [];
    const existingPrinters = await Printer.find({
        eventId: scopedEvent.eventId,
        isVirtual: true,
        emulatorSlot: { $gte: 1, $lte: MAX_VIRTUAL_PRINTER_SLOTS }
    }).select("_id emulatorSlot type").lean() as Array<{
        _id: unknown;
        emulatorSlot?: number;
        type?: "CASHIER" | "KITCHEN";
    }>;

    const bySlot = new Map<number, { _id: unknown; type?: "CASHIER" | "KITCHEN" }>();
    existingPrinters.forEach((printer) => {
        if (typeof printer.emulatorSlot === "number") {
            bySlot.set(printer.emulatorSlot, { _id: printer._id, type: printer.type });
        }
    });
    const existingPrinterIds = existingPrinters.map((printer) => String(printer._id));
    if (await hasPendingSumUpPrinterDependency(scopedEvent.eventId, existingPrinterIds)) {
        return { error: PENDING_SUMUP_HARDWARE_ERROR };
    }

    for (let slot = 1; slot <= MAX_VIRTUAL_PRINTER_SLOTS; slot += 1) {
        const port = 19099 + slot;
        const existing = bySlot.get(slot);

        if (existing) {
            await Printer.updateOne(
                { _id: existing._id, eventId: scopedEvent.eventId },
                {
                    $set: {
                        ip: "printer-emulator",
                        port,
                        isVirtual: true,
                        emulatorSlot: slot
                    }
                }
            );
        } else {
            await Printer.create({
                eventId: scopedEvent.eventId,
                name: `Virtual Printer ${String(slot).padStart(2, "0")}`,
                ip: "printer-emulator",
                port,
                isVirtual: true,
                emulatorSlot: slot,
                type: slot === 1 ? "CASHIER" : "KITCHEN"
            });
        }

        createdOrUpdated.push(`S${slot}`);
    }

    revalidateHardwareViews();
    return {
        success: true,
        name: `${createdOrUpdated.length} stampanti virtuali configurate`
    };
}

export async function createManualPrintJobAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const submittedEventId = formData.get("eventId") as string | null;
    const submittedPrinterId = (formData.get("printerId") as string | null)?.trim() || "";

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };

    await dbConnect();

    const eventConfig = await Event.findById(scopedEvent.eventId)
        .select("name settings.menuHeaderLogoUrl settings.receiptHeaderLogoUrl")
        .lean() as ({ name?: string; settings?: { menuHeaderLogoUrl?: string; receiptHeaderLogoUrl?: string } } | null);

    let printer = null as ({
        _id: unknown;
        ip?: string;
        port?: number;
        isVirtual?: boolean;
    } | null);

    if (submittedPrinterId) {
        printer = await Printer.findOne({ _id: submittedPrinterId, eventId: scopedEvent.eventId })
            .select("_id ip port isVirtual")
            .lean() as ({
                _id: unknown;
                ip?: string;
                port?: number;
                isVirtual?: boolean;
            } | null);
    }

    if (!printer) {
        printer = await Printer.findOne({ eventId: scopedEvent.eventId })
            .sort({ createdAt: 1 })
            .select("_id ip port isVirtual")
            .lean() as ({
                _id: unknown;
                ip?: string;
                port?: number;
                isVirtual?: boolean;
            } | null);
    }

    const manualOrderId = `manual-${Date.now().toString().slice(-8)}`;
    const manualShortCode = `D-${Date.now().toString().slice(-5)}`;
    const printSuccess = await PrinterService.printComanda({
        ip: printer?.ip || "",
        port: printer?.port || DEFAULT_PRINTER_PORT,
        printerId: printer?._id ? String(printer._id) : undefined,
        eventId: scopedEvent.eventId,
        source: "MANUAL_TEST",
        printType: "MANUAL_TEST",
        isVirtual: Boolean(printer?.isVirtual),
        title: "Ricevuta Demo",
        eventName: eventConfig?.name,
        copyLabel: "COPIA TEST",
        orderId: manualOrderId,
        shortCode: manualShortCode,
        customerName: "Cliente Demo",
        tableNumber: "12",
        items: [
            { name: "Panino Salsiccia", quantity: 2 },
            { name: "Birra Media", quantity: 1 }
        ],
        totals: [
            { label: "TOTALE", value: "18.00 EUR", emphasis: "strong" }
        ],
        brandingLogoUrl: sanitizeReceiptHeaderLogoUrl(eventConfig?.settings?.receiptHeaderLogoUrl)
            || sanitizePrintableHeaderLogoUrl(eventConfig?.settings?.menuHeaderLogoUrl)
    }, 1);

    if (!printSuccess) {
        return { error: "Stampa demo non riuscita: controlla configurazione stampante o monitor stampa." };
    }

    revalidateHardwareViews();
    return { success: true, name: "Job demo creato" };
}

export async function createPeripheralAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const submittedEventId = formData.get("eventId") as string | null;
    const name = formData.get("name") as string;
    const type = formData.get("type") as "SUMUP" | "CASH_BOX" | "ELECTRONIC_MANUAL" | "OTHER";

    const merchantCode = ((formData.get("merchantCode") as string) || "").trim();
    const readerId = ((formData.get("readerId") as string) || "").trim();
    const apiKey = ((formData.get("apiKey") as string) || "").trim();
    const affiliateAppId = ((formData.get("affiliateAppId") as string) || "").trim();
    const affiliateKey = ((formData.get("affiliateKey") as string) || "").trim();

    if (!name || !type) return { error: "Dati mancanti" };
    if (type === "SUMUP" && (!merchantCode || !readerId || !apiKey || !affiliateAppId || !affiliateKey)) {
        return { error: "Merchant Code, Reader ID, API Key, Affiliate App ID e Affiliate Key sono obbligatori per terminali SumUp" };
    }

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };

    await dbConnect();
    await Peripheral.create({
        eventId: scopedEvent.eventId,
        name,
        type,
        config: type === "SUMUP"
            ? {
                merchantCode,
                readerId,
                apiKey: encryptSecret(apiKey),
                affiliateAppId,
                affiliateKey: encryptSecret(affiliateKey)
            }
            : {}
    });

    revalidateHardwareViews();
    return { success: true };
}

export async function deletePeripheralAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const id = formData.get("id") as string;
    const submittedEventId = formData.get("eventId") as string | null;
    if (!id) return { error: "ID periferica mancante" };

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };
    const scopedEventId = scopedEvent.eventId;

    await dbConnect();
    const currentPeripheral = await Peripheral.findOne({ _id: id, eventId: scopedEventId })
        .select("_id type")
        .lean();
    if (!currentPeripheral) {
        return { error: "Periferica non trovata nella festa selezionata" };
    }
    if (currentPeripheral.type === "SUMUP") {
        if (await hasPendingSumUpCheckout(scopedEventId, { paymentTerminalId: id })) {
            return { error: PENDING_SUMUP_HARDWARE_ERROR };
        }
        if (await hasLegacySumUpRefundDependency(scopedEventId, { paymentTerminalId: id })) {
            return { error: LEGACY_SUMUP_REFUND_HARDWARE_ERROR };
        }
    }
    const deletedPeripheral = await Peripheral.findOneAndDelete({ _id: id, eventId: scopedEventId }).select("_id").lean();

    if (!deletedPeripheral) {
        return { error: "Periferica non trovata nella festa selezionata" };
    }

    await PosDevice.updateMany({ eventId: scopedEventId, paymentTerminalId: id }, { $unset: { paymentTerminalId: 1 } });
    await PosDevice.updateMany({ eventId: scopedEventId, cashBoxId: id }, { $unset: { cashBoxId: 1 } });

    revalidateHardwareViews();
    return { success: true };
}

export async function updatePeripheralAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const id = formData.get("id") as string;
    const submittedEventId = formData.get("eventId") as string | null;
    const name = formData.get("name") as string;
    const type = formData.get("type") as "SUMUP" | "CASH_BOX" | "ELECTRONIC_MANUAL" | "OTHER";

    const merchantCode = ((formData.get("merchantCode") as string) || "").trim();
    const readerId = ((formData.get("readerId") as string) || "").trim();
    const apiKey = ((formData.get("apiKey") as string) || "").trim();
    const affiliateAppId = ((formData.get("affiliateAppId") as string) || "").trim();
    const affiliateKey = ((formData.get("affiliateKey") as string) || "").trim();

    if (!id || !name || !type) return { error: "Dati mancanti" };

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };
    const scopedEventId = scopedEvent.eventId;

    await dbConnect();
    const currentPeripheral = await Peripheral.findOne({ _id: id, eventId: scopedEventId }).lean();
    if (!currentPeripheral) {
        return { error: "Periferica non trovata nella festa selezionata" };
    }

    const currentMerchantCode = getConfigString(currentPeripheral.config, "merchantCode");
    const currentReaderId = getConfigString(currentPeripheral.config, "readerId");
    const currentApiKey = getConfigString(currentPeripheral.config, "apiKey");
    const currentAffiliateAppId = getConfigString(currentPeripheral.config, "affiliateAppId");
    const currentAffiliateKey = getConfigString(currentPeripheral.config, "affiliateKey");
    const migratesLegacySumUpConfiguration = currentPeripheral.type === "SUMUP"
        && type === "SUMUP"
        && !currentApiKey
        && Boolean(currentAffiliateKey)
        && Boolean(apiKey)
        && Boolean(affiliateKey);
    const changesSumUpConfiguration = currentPeripheral.type === "SUMUP" && (
        type !== "SUMUP"
        || Boolean(apiKey)
        || Boolean(affiliateKey)
        || Boolean(merchantCode && merchantCode !== getConfigString(currentPeripheral.config, "merchantCode"))
        || Boolean(readerId && readerId !== getConfigString(currentPeripheral.config, "readerId"))
        || Boolean(affiliateAppId && affiliateAppId !== getConfigString(currentPeripheral.config, "affiliateAppId"))
    );
    if (changesSumUpConfiguration) {
        if (await hasPendingSumUpCheckout(scopedEventId, { paymentTerminalId: id })) {
            return { error: PENDING_SUMUP_HARDWARE_ERROR };
        }
        if (!migratesLegacySumUpConfiguration
            && await hasLegacySumUpRefundDependency(scopedEventId, { paymentTerminalId: id })) {
            return { error: LEGACY_SUMUP_REFUND_HARDWARE_ERROR };
        }
    }

    if (type === "SUMUP") {
        if (!currentApiKey && currentAffiliateKey && (!apiKey || !affiliateKey)) {
            return { error: "Per migrare il terminale SumUp inserisci sia API Key sia Affiliate Key" };
        }

        const effectiveMerchantCode = merchantCode || currentMerchantCode || "";
        const effectiveReaderId = readerId || currentReaderId || "";
        const effectiveApiKey = apiKey || currentApiKey || "";
        const effectiveAffiliateAppId = affiliateAppId || currentAffiliateAppId || "";
        const effectiveAffiliateKey = affiliateKey || (currentApiKey ? currentAffiliateKey : "") || "";

        if (!effectiveMerchantCode || !effectiveReaderId || !effectiveApiKey || !effectiveAffiliateAppId || !effectiveAffiliateKey) {
            return { error: "Merchant Code, Reader ID, API Key, Affiliate App ID e Affiliate Key sono obbligatori per terminali SumUp" };
        }

        await Peripheral.findOneAndUpdate(
            { _id: id, eventId: scopedEventId },
            {
                name,
                type,
                config: {
                    merchantCode: effectiveMerchantCode,
                    readerId: effectiveReaderId,
                    apiKey: apiKey ? encryptSecret(apiKey) : currentApiKey,
                    affiliateAppId: effectiveAffiliateAppId,
                    affiliateKey: affiliateKey ? encryptSecret(affiliateKey) : currentAffiliateKey
                }
            },
            { returnDocument: "after" }
        );
    } else {
        await Peripheral.findOneAndUpdate(
            { _id: id, eventId: scopedEventId },
            {
                name,
                type,
                config: {}
            },
            { returnDocument: "after" }
        );
    }

    revalidateHardwareViews();
    return { success: true };
}
