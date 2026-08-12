"use server";

import dbConnect from "@/lib/mongoose";
import {
    normalizeEasterEggCrop,
    normalizeEasterEggProcessingSettings,
    type EasterEggAspectRatio
} from "@/lib/easter-egg-config";
import {
    preparePrintableEasterEggRasterFromUrl,
    sanitizeEasterEggImageUrl
} from "@/lib/easter-egg-image";
import {
    DEFAULT_PRINTER_PORT,
    selectBestEasterEggPrinter
} from "@/lib/printer-config";
import {
    sanitizePrintableHeaderLogoUrl,
    sanitizeReceiptHeaderLogoUrl
} from "@/lib/print-branding";
import { PrinterService } from "@/lib/printer";
import Event from "@/models/Event";
import Printer from "@/models/Printer";
import { revalidatePath } from "next/cache";
import {
    requireAdminAuthorization,
    requireContextEventId,
    resolveEventScope
} from "../action-context";
import {
    deleteEasterEggImageIfManaged,
    persistEasterEggImage
} from "../media";

function parseEasterEggAspectRatio(value: FormDataEntryValue | null): EasterEggAspectRatio {
    if (value === "SQUARE_1_1" || value === "THERMAL_58" || value === "PORTRAIT_3_4") {
        return value;
    }
    return "PORTRAIT_3_4";
}

function getOptionalFormString(value: FormDataEntryValue | null): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function getOptionalFormNumber(value: FormDataEntryValue | null): number | undefined {
    const normalized = getOptionalFormString(value);
    if (normalized === undefined) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export interface PortalEasterEggActionState {
    success?: string;
    error?: string;
    imageUrl?: string;
}

export async function savePortalEasterEggSettingsAction(formData: FormData): Promise<PortalEasterEggActionState> {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const submittedEventId = formData.get("eventId") as string | null;
    const enabled = formData.get("portalEasterEggEnabled") === "on";
    const removeImage = formData.get("removePortalEasterEggImage") === "on";
    const imageFile = formData.get("portalEasterEggImageFile");

    const crop = normalizeEasterEggCrop({
        centerX: getOptionalFormNumber(formData.get("portalEasterEggCenterX")),
        centerY: getOptionalFormNumber(formData.get("portalEasterEggCenterY")),
        zoom: getOptionalFormNumber(formData.get("portalEasterEggZoom")),
        aspectRatio: parseEasterEggAspectRatio(formData.get("portalEasterEggAspectRatio"))
    });
    const processing = normalizeEasterEggProcessingSettings({
        autoEnhance: formData.get("portalEasterEggAutoEnhance") === "on",
        brightnessBoost: getOptionalFormNumber(formData.get("portalEasterEggBrightnessBoost")),
        thresholdBase: getOptionalFormNumber(formData.get("portalEasterEggThresholdBase"))
    });

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };

    await dbConnect();
    const targetEvent = await Event.findOne({ _id: scopedEvent.eventId, archived: { $ne: true } })
        .select("settings.portalEasterEggImageUrl")
        .lean() as ({ settings?: { portalEasterEggImageUrl?: string } } | null);

    if (!targetEvent) return { error: "Festa non trovata" };

    const currentImageUrl = sanitizeEasterEggImageUrl(targetEvent.settings?.portalEasterEggImageUrl) || "";
    let nextImageUrl: string | null = null;

    if (imageFile instanceof File && imageFile.size > 0) {
        const uploadResult = await persistEasterEggImage(imageFile);
        if ("error" in uploadResult) {
            return { error: uploadResult.error };
        }
        nextImageUrl = uploadResult.url;
    } else if (removeImage) {
        nextImageUrl = "";
    }

    const settingsSet: Record<string, unknown> = {
        "settings.portalEasterEggEnabled": enabled,
        "settings.portalEasterEggCrop": crop,
        "settings.portalEasterEggProcessing": processing
    };
    const settingsUnset: Record<string, number> = {};

    if (nextImageUrl !== null && nextImageUrl) {
        settingsSet["settings.portalEasterEggImageUrl"] = nextImageUrl;
    }
    if (nextImageUrl === "") {
        settingsUnset["settings.portalEasterEggImageUrl"] = 1;
    }

    try {
        await Event.updateOne(
            { _id: scopedEvent.eventId, archived: { $ne: true } },
            {
                $set: settingsSet,
                ...(Object.keys(settingsUnset).length > 0 ? { $unset: settingsUnset } : {})
            }
        );
    } catch (error) {
        if (nextImageUrl) await deleteEasterEggImageIfManaged(nextImageUrl);
        throw error;
    }

    if (nextImageUrl !== null && currentImageUrl && currentImageUrl !== nextImageUrl) {
        await deleteEasterEggImageIfManaged(currentImageUrl);
    }

    revalidatePath("/admin/settings");
    revalidatePath("/admin/easter-egg");
    return {
        success: "Configurazione easter egg salvata.",
        imageUrl: nextImageUrl !== null
            ? (nextImageUrl || undefined)
            : (sanitizeEasterEggImageUrl(currentImageUrl) || undefined)
    };
}

export async function printPortalEasterEggAction(formData: FormData): Promise<PortalEasterEggActionState> {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const submittedEventId = formData.get("eventId") as string | null;
    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };

    await dbConnect();
    const event = await Event.findOne({ _id: scopedEvent.eventId, archived: { $ne: true } })
        .select("name settings.portalEasterEggImageUrl settings.portalEasterEggCrop settings.portalEasterEggProcessing settings.defaultCashierPrinterIp settings.menuHeaderLogoUrl settings.receiptHeaderLogoUrl")
        .lean() as ({
            name?: string;
            settings?: {
                portalEasterEggImageUrl?: string;
                portalEasterEggCrop?: {
                    centerX?: number;
                    centerY?: number;
                    zoom?: number;
                    aspectRatio?: EasterEggAspectRatio;
                };
                portalEasterEggProcessing?: {
                    autoEnhance?: boolean;
                    brightnessBoost?: number;
                    thresholdBase?: number;
                };
                defaultCashierPrinterIp?: string;
                menuHeaderLogoUrl?: string;
                receiptHeaderLogoUrl?: string;
            };
        } | null);

    if (!event) return { error: "Festa non trovata" };

    const imageUrl = sanitizeEasterEggImageUrl(event.settings?.portalEasterEggImageUrl);
    if (!imageUrl) {
        return { error: "Carica prima una immagine easter egg." };
    }

    const raster = await preparePrintableEasterEggRasterFromUrl(
        imageUrl,
        event.settings?.portalEasterEggCrop,
        event.settings?.portalEasterEggProcessing
    );
    if (!raster) {
        return { error: "Impossibile preparare l'immagine per la stampa." };
    }

    const printers = await Printer.find({ eventId: scopedEvent.eventId })
        .select("_id ip port isVirtual emulatorSlot type")
        .sort({ type: 1, createdAt: 1 })
        .lean() as Array<{
            _id: unknown;
            ip?: string;
            port?: number;
            isVirtual?: boolean;
            emulatorSlot?: number;
            type?: "CASHIER" | "KITCHEN";
        }>;

    const printer = selectBestEasterEggPrinter(printers, event.settings?.defaultCashierPrinterIp);
    if (!printer?.ip?.trim()) {
        return { error: "Nessuna stampante configurata per la festa corrente." };
    }

    const printed = await PrinterService.printRasterImage({
        ip: printer.ip,
        port: printer.port || DEFAULT_PRINTER_PORT,
        printerId: String(printer._id),
        eventId: scopedEvent.eventId,
        source: "MANUAL_TEST",
        printType: "EASTER_EGG_IMAGE",
        isVirtual: Boolean(printer.isVirtual),
        emulatorSlot: printer.emulatorSlot,
        title: "Easter Egg Portale",
        eventName: event.name?.trim() || undefined,
        brandingLogoUrl: sanitizeReceiptHeaderLogoUrl(event.settings?.receiptHeaderLogoUrl)
            || sanitizePrintableHeaderLogoUrl(event.settings?.menuHeaderLogoUrl),
        copyLabel: "EASTER EGG",
        imageUrl,
        crop: normalizeEasterEggCrop(event.settings?.portalEasterEggCrop),
        processing: normalizeEasterEggProcessingSettings(event.settings?.portalEasterEggProcessing),
        footerLines: ["Scatto inviato da webapp mobile"]
    }, raster, 1);

    if (!printed) {
        return { error: "Invio stampa non riuscito. Controlla il Monitor Stampa." };
    }

    revalidatePath("/admin/settings/hardware");
    revalidatePath("/admin/easter-egg");
    return { success: "Stampa easter egg inviata." };
}
