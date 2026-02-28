"use server";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import dbConnect from "@/lib/mongoose";
import { getAdminContextEventId } from "@/lib/events";
import { ensureAdminSession } from "@/lib/authz";
import { encryptSecret, isEncryptedSecret } from "@/lib/secrets";
import Event from "@/models/Event";
import Category from "@/models/Category";
import Product from "@/models/Product";
import Printer from "@/models/Printer";
import PrintJob from "@/models/PrintJob";
import PosDevice from "@/models/PosDevice";
import Peripheral from "@/models/Peripheral";
import { revalidatePath } from "next/cache";
import {
    MAX_PREDEFINED_TABLES,
    parsePredefinedTablesInput
} from "@/lib/table-presets";
import { normalizeAvailableDays } from "@/lib/product-availability";
import { normalizeStockQuantity } from "@/lib/inventory";
import {
    MAX_QUICK_DISCOUNT_PRESETS,
    resolveQuickDiscountPresetsFromSettings,
    toLegacyQuickDiscountSettings,
    validateQuickDiscountPresets
} from "@/lib/quick-discount-presets";
import { normalizePosCatalogLayout } from "@/lib/pos-catalog-layout";
import {
    DEFAULT_PRINTER_PORT,
    MAX_VIRTUAL_PRINTER_SLOTS,
    normalizePrinterConfig
} from "@/lib/printer-config";

function revalidateHardwareViews() {
    revalidatePath("/admin/settings/hardware");
    revalidatePath("/admin/settings/pos");
}

async function requireContextEventId() {
    const eventId = await getAdminContextEventId();
    if (!eventId) return null;
    return eventId;
}

function resolveEventScope(contextEventId: string | null, submittedEventId?: string | null) {
    const normalizedSubmittedEventId = submittedEventId?.trim();
    if (contextEventId && normalizedSubmittedEventId && contextEventId !== normalizedSubmittedEventId) {
        return { error: "La festa selezionata non corrisponde al contesto amministrativo corrente" } as const;
    }

    const eventId = contextEventId || normalizedSubmittedEventId || null;
    if (!eventId) {
        return { error: "Seleziona una festa valida prima di procedere" } as const;
    }

    return { eventId } as const;
}

function getConfigString(config: unknown, key: string): string | undefined {
    if (!config || typeof config !== "object") return undefined;
    const value = (config as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MENU_HEADER_LOGO_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "menu-headers");
const MENU_HEADER_LOGO_URL_PREFIX = "/uploads/menu-headers";
const MENU_HEADER_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const MENU_HEADER_LOGO_TARGET_RATIO = 10 / 4;
const MENU_HEADER_LOGO_RATIO_TOLERANCE = 0.12;

const MENU_HEADER_LOGO_ALLOWED_TYPES = new Map<string, string>([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
]);

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
    if (buffer.length < 24) return null;
    const isPngSignature =
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a;
    if (!isPngSignature) return null;

    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    const sofMarkers = new Set([
        0xc0, 0xc1, 0xc2, 0xc3,
        0xc5, 0xc6, 0xc7, 0xc9,
        0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);

    while (offset + 8 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        const marker = buffer[offset + 1];
        if (marker === 0xd8 || marker === 0xd9) {
            offset += 2;
            continue;
        }

        if (offset + 3 >= buffer.length) return null;
        const segmentLength = buffer.readUInt16BE(offset + 2);
        if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) return null;

        if (sofMarkers.has(marker)) {
            if (offset + 8 >= buffer.length) return null;
            const height = buffer.readUInt16BE(offset + 5);
            const width = buffer.readUInt16BE(offset + 7);
            return { width, height };
        }

        offset += 2 + segmentLength;
    }

    return null;
}

function extractMenuHeaderLogoDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
    if (mimeType === "image/png") return readPngDimensions(buffer);
    if (mimeType === "image/jpeg") return readJpegDimensions(buffer);
    return null;
}

function buildMenuHeaderLogoFilePath(fileName: string) {
    return path.join(MENU_HEADER_LOGO_UPLOAD_DIR, fileName);
}

async function persistMenuHeaderLogo(file: File): Promise<{ url: string } | { error: string }> {
    const extension = MENU_HEADER_LOGO_ALLOWED_TYPES.get(file.type);
    if (!extension) {
        return { error: "Formato logo non supportato: usa PNG o JPEG." };
    }
    if (file.size <= 0) {
        return { error: "File logo vuoto." };
    }
    if (file.size > MENU_HEADER_LOGO_MAX_BYTES) {
        return { error: "Logo troppo grande: massimo 2MB." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const dimensions = extractMenuHeaderLogoDimensions(buffer, file.type);
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
        return { error: "Immagine logo non valida o corrotta." };
    }

    const ratio = dimensions.width / dimensions.height;
    if (Math.abs(ratio - MENU_HEADER_LOGO_TARGET_RATIO) > MENU_HEADER_LOGO_RATIO_TOLERANCE) {
        return { error: "Rapporto logo non valido: richiesto 10:4 (tolleranza ±12%)." };
    }

    await mkdir(MENU_HEADER_LOGO_UPLOAD_DIR, { recursive: true });
    const fileName = `menu-header-${Date.now()}-${randomUUID()}.${extension}`;
    await writeFile(buildMenuHeaderLogoFilePath(fileName), buffer);

    return { url: `${MENU_HEADER_LOGO_URL_PREFIX}/${fileName}` };
}

async function deleteMenuHeaderLogoIfManaged(url: string | null | undefined) {
    if (!url || !url.startsWith(`${MENU_HEADER_LOGO_URL_PREFIX}/`)) return;
    const filePath = path.join(process.cwd(), "public", url.replace(/^\//, ""));
    try {
        await unlink(filePath);
    } catch {
        // Ignore remove errors (file may already be absent)
    }
}

async function requireAdminAuthorization() {
    const sessionCheck = await ensureAdminSession();
    if (!sessionCheck.ok) {
        return { error: sessionCheck.error } as const;
    }
    return null;
}

export async function createEventAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const name = ((formData.get("name") as string | null) || "").trim();
    if (!name) return { error: "Nome obbligatorio" };

    await dbConnect();
    const existingEvent = await Event.findOne({
        name: { $regex: new RegExp(`^${escapeRegExp(name)}$`, "i") }
    }).select("_id").lean();

    if (existingEvent) {
        return { error: "Esiste già una festa con questo nome" };
    }

    await Event.create({
        name,
        active: false,
        archived: false,
        settings: { askName: false, askTable: false, posCatalogLayout: "COMPACT_COLUMNS" }
    });

    revalidatePath("/admin/settings/events");
    return { success: true };
}

export async function updateEventSettingsAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const eventId = formData.get("eventId") as string;
    const askName = formData.get("askName") === "on";
    const askTable = formData.get("askTable") === "on";
    const posCatalogLayoutRaw = ((formData.get("posCatalogLayout") as string | null) || "").trim();
    const defaultCashierPrinterIp = formData.get("defaultCashierPrinterIp") as string;
    const quickDiscountPresetsRaw = (formData.get("quickDiscountPresets") as string | null)?.trim() || "";
    const menuHeaderLogoFile = formData.get("menuHeaderLogoFile");
    const removeMenuHeaderLogo = formData.get("removeMenuHeaderLogo") === "on";
    const active = formData.get("active") === "on";
    const predefinedTablesInput = formData.get("predefinedTables") as string | null;
    const normalizedInputTables = parsePredefinedTablesInput(predefinedTablesInput, Number.MAX_SAFE_INTEGER);
    const distinctPredefinedTablesCount = normalizedInputTables.length;

    if (!eventId) return { error: "Event ID obbligatorio" };

    const posCatalogLayout = normalizePosCatalogLayout(posCatalogLayoutRaw);

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, eventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };
    const scopedEventId = scopedEvent.eventId;

    await dbConnect();
    const targetEvent = await Event.findOne({ _id: scopedEventId, archived: { $ne: true } })
        .select("archived predefinedTables settings.menuHeaderLogoUrl")
        .lean() as ({ archived?: boolean; predefinedTables?: string[]; settings?: { menuHeaderLogoUrl?: string } } | null);

    if (!targetEvent) return { error: "Festa non trovata" };
    if (targetEvent.archived) return { error: "Le feste archiviate non sono modificabili" };

    const normalizedExistingTables = parsePredefinedTablesInput(
        Array.isArray(targetEvent.predefinedTables) ? targetEvent.predefinedTables.join("\n") : "",
        Number.MAX_SAFE_INTEGER
    );
    const predefinedTablesChanged = normalizedInputTables.join("\n") !== normalizedExistingTables.join("\n");

    if (distinctPredefinedTablesCount > MAX_PREDEFINED_TABLES && predefinedTablesChanged) {
        return { error: `Puoi inserire al massimo ${MAX_PREDEFINED_TABLES} tavoli predefiniti` };
    }

    let quickDiscountPresets = resolveQuickDiscountPresetsFromSettings(null);
    if (quickDiscountPresetsRaw) {
        let parsedQuickDiscountPresets: unknown;
        try {
            parsedQuickDiscountPresets = JSON.parse(quickDiscountPresetsRaw);
        } catch {
            return { error: "Formato preset sconti non valido" };
        }

        const validatedPresets = validateQuickDiscountPresets(parsedQuickDiscountPresets, MAX_QUICK_DISCOUNT_PRESETS);
        if (!validatedPresets.success) {
            return { error: validatedPresets.error };
        }
        quickDiscountPresets = validatedPresets.presets;
    } else {
        // Backward compatibility for old forms posting a single quickStaff preset.
        const quickStaffDiscountEnabled = formData.get("quickStaffDiscountEnabled") === "on";
        const quickStaffDiscountLabel = (formData.get("quickStaffDiscountLabel") as string | null)?.trim() || "Staff";
        const quickStaffDiscountTypeRaw = (formData.get("quickStaffDiscountType") as string | null)?.trim().toUpperCase();
        const quickStaffDiscountType = quickStaffDiscountTypeRaw === "FIXED" ? "FIXED" : "PERCENT";
        const quickStaffDiscountValueRaw = (formData.get("quickStaffDiscountValue") as string | null)?.trim() || "";
        const parsedQuickStaffDiscountValue = Number(quickStaffDiscountValueRaw.replace(",", "."));
        const quickStaffDiscountValue = Number.isFinite(parsedQuickStaffDiscountValue)
            ? Number(Math.max(0, parsedQuickStaffDiscountValue).toFixed(2))
            : (quickStaffDiscountType === "PERCENT" ? 50 : 0);

        quickDiscountPresets = resolveQuickDiscountPresetsFromSettings({
            quickStaffDiscountEnabled,
            quickStaffDiscountLabel,
            quickStaffDiscountType,
            quickStaffDiscountValue
        });
    }
    const legacyQuickDiscount = toLegacyQuickDiscountSettings(quickDiscountPresets);

    const predefinedTables = distinctPredefinedTablesCount > MAX_PREDEFINED_TABLES
        ? normalizedInputTables
        : parsePredefinedTablesInput(predefinedTablesInput, MAX_PREDEFINED_TABLES);
    const currentMenuHeaderLogoUrl = targetEvent.settings?.menuHeaderLogoUrl?.trim() || "";
    let nextMenuHeaderLogoUrl: string | null = null;

    if (menuHeaderLogoFile instanceof File && menuHeaderLogoFile.size > 0) {
        const uploadResult = await persistMenuHeaderLogo(menuHeaderLogoFile);
        if ("error" in uploadResult) {
            return { error: uploadResult.error };
        }
        nextMenuHeaderLogoUrl = uploadResult.url;
    } else if (removeMenuHeaderLogo) {
        nextMenuHeaderLogoUrl = "";
    }

    const settingsSet: Record<string, unknown> = {
        active,
        "settings.askName": askName,
        "settings.askTable": askTable,
        "settings.posCatalogLayout": posCatalogLayout,
        "settings.defaultCashierPrinterIp": defaultCashierPrinterIp,
        "settings.quickDiscountPresets": quickDiscountPresets,
        "settings.quickStaffDiscountEnabled": legacyQuickDiscount.quickStaffDiscountEnabled,
        "settings.quickStaffDiscountLabel": legacyQuickDiscount.quickStaffDiscountLabel,
        "settings.quickStaffDiscountType": legacyQuickDiscount.quickStaffDiscountType,
        "settings.quickStaffDiscountValue": legacyQuickDiscount.quickStaffDiscountValue,
        predefinedTables
    };
    const settingsUnset: Record<string, number> = {
        // Cleanup legacy global SumUp configuration: now managed via Peripherals.
        "settings.sumupMerchantCode": 1,
        "settings.sumupApiKey": 1
    };

    if (nextMenuHeaderLogoUrl !== null && nextMenuHeaderLogoUrl) {
        settingsSet["settings.menuHeaderLogoUrl"] = nextMenuHeaderLogoUrl;
    }
    if (nextMenuHeaderLogoUrl === "") {
        settingsUnset["settings.menuHeaderLogoUrl"] = 1;
    }

    if (active) {
        // Deactivate all others first
        await Event.updateMany({ _id: { $ne: scopedEventId } }, { active: false });
    }

    try {
        await Event.findOneAndUpdate(
            { _id: scopedEventId, archived: { $ne: true } },
            {
                $set: settingsSet,
                $unset: settingsUnset
            }
        );
    } catch (error) {
        if (nextMenuHeaderLogoUrl && nextMenuHeaderLogoUrl.startsWith(`${MENU_HEADER_LOGO_URL_PREFIX}/`)) {
            await deleteMenuHeaderLogoIfManaged(nextMenuHeaderLogoUrl);
        }
        throw error;
    }

    if (nextMenuHeaderLogoUrl !== null && currentMenuHeaderLogoUrl && currentMenuHeaderLogoUrl !== nextMenuHeaderLogoUrl) {
        await deleteMenuHeaderLogoIfManaged(currentMenuHeaderLogoUrl);
    }

    revalidatePath("/admin/settings");
    revalidatePath("/admin/settings/events");
    return { success: true };
}

export async function cloneEventAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const sourceEventId = formData.get("sourceEventId") as string;
    const newName = formData.get("newName") as string;
    if (!sourceEventId || !newName) return { error: "Dati mancanti" };

    await dbConnect();

    const sourceEvent = await Event.findById(sourceEventId).lean();
    if (!sourceEvent) return { error: "Evento sorgente non trovato" };

    const clonedPredefinedTables = parsePredefinedTablesInput(
        Array.isArray(sourceEvent.predefinedTables) ? sourceEvent.predefinedTables.join("\n") : "",
        Number.MAX_SAFE_INTEGER
    );
    const quickDiscountPresets = resolveQuickDiscountPresetsFromSettings(sourceEvent.settings);
    const legacyQuickDiscount = toLegacyQuickDiscountSettings(quickDiscountPresets);

    // 1. Crea la nuova festa
    const newEvent = await Event.create({
        name: newName,
        active: false,
        archived: false,
        settings: {
            askName: sourceEvent.settings?.askName ?? false,
            askTable: sourceEvent.settings?.askTable ?? false,
            menuHeaderLogoUrl: sourceEvent.settings?.menuHeaderLogoUrl,
            defaultCashierPrinterIp: sourceEvent.settings?.defaultCashierPrinterIp,
            quickDiscountPresets,
            quickStaffDiscountEnabled: legacyQuickDiscount.quickStaffDiscountEnabled,
            quickStaffDiscountLabel: legacyQuickDiscount.quickStaffDiscountLabel,
            quickStaffDiscountType: legacyQuickDiscount.quickStaffDiscountType,
            quickStaffDiscountValue: legacyQuickDiscount.quickStaffDiscountValue
        },
        predefinedTables: clonedPredefinedTables
    });

    // 2. Clona i Printers
    const printers = await Printer.find({ eventId: sourceEventId }).lean();
    const printerMap = new Map(); // mappa vecchi id -> nuovi id

    for (const printer of printers) {
        const newPrinter = await Printer.create({
            eventId: newEvent._id,
            name: printer.name,
            ip: printer.ip,
            port: typeof printer.port === "number" ? printer.port : 9100,
            isVirtual: Boolean(printer.isVirtual),
            emulatorSlot: typeof printer.emulatorSlot === "number" ? printer.emulatorSlot : undefined,
            type: printer.type
        });
        printerMap.set(String(printer._id), newPrinter._id);
    }

    // 3. Clona le Periferiche
    const peripherals = await Peripheral.find({ eventId: sourceEventId }).lean();
    const peripheralMap = new Map();
    for (const peripheral of peripherals) {
        const newPeripheral = await Peripheral.create({
            eventId: newEvent._id,
            name: peripheral.name,
            type: peripheral.type,
            config: peripheral.config || {}
        });
        peripheralMap.set(String(peripheral._id), newPeripheral._id);
    }

    // 4. Clona i PosDevices
    const posDevices = await PosDevice.find({ eventId: sourceEventId }).lean();
    for (const posDevice of posDevices) {
        await PosDevice.create({
            eventId: newEvent._id,
            name: posDevice.name,
            printerId: posDevice.printerId ? printerMap.get(String(posDevice.printerId)) : null,
            paymentTerminalId: posDevice.paymentTerminalId ? peripheralMap.get(String(posDevice.paymentTerminalId)) : null,
            cashBoxId: posDevice.cashBoxId ? peripheralMap.get(String(posDevice.cashBoxId)) : null
        });
    }

    // 5. Clona le Categorie
    const categories = await Category.find({ eventId: sourceEventId }).lean();
    const categoryMap = new Map(); // mappa vecchi id -> nuovi id

    for (const cat of categories) {
        const newCat = await Category.create({
            eventId: newEvent._id,
            name: cat.name,
            uiColor: cat.uiColor,
            printerId: cat.printerId ? printerMap.get(String(cat.printerId)) : null
        });
        categoryMap.set(String(cat._id), newCat._id);
    }

    // 6. Clona i Prodotti associandoli alle nuove Categorie
    const products = await Product.find({ eventId: sourceEventId }).lean();
    for (const prod of products) {
        const productStockQuantity = normalizeStockQuantity(prod.stockQuantity ?? null);
        const clonedVariants = (prod.variants || []).map((variant: { optionName: string; priceVariation: number; stockQuantity?: number | null }) => {
            const variantStockQuantity = normalizeStockQuantity(variant.stockQuantity ?? null);
            return {
                optionName: variant.optionName,
                priceVariation: variant.priceVariation,
                stockQuantity: variantStockQuantity
            };
        });

        await Product.create({
            eventId: newEvent._id,
            categoryId: categoryMap.get(String(prod.categoryId)),
            name: prod.name,
            basePrice: prod.basePrice,
            isSoldOut: productStockQuantity !== null ? productStockQuantity <= 0 : false,
            stockQuantity: productStockQuantity,
            availableDays: normalizeAvailableDays(prod.availableDays || []),
            variants: clonedVariants
        });
    }

    revalidatePath("/admin/settings/events");
    return { success: true };
}

// PRINTER ACTIONS
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
    const deletedPrinter = await Printer.findOneAndDelete({ _id: id, eventId: scopedEventId }).select("_id").lean();
    if (!deletedPrinter) {
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
    const updatedPrinter = await Printer.findOneAndUpdate(
        { _id: id, eventId: scopedEvent.eventId },
        {
            name: name.trim(),
            ip: normalizedConfig.data.ip,
            port: normalizedConfig.data.port,
            isVirtual: normalizedConfig.data.isVirtual,
            emulatorSlot: normalizedConfig.data.emulatorSlot,
            type
        },
        { new: true }
    ).select("_id").lean();

    if (!updatedPrinter) {
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

    const destinationHost = printer?.ip || "demo-printer";
    const destinationPort = printer?.port || DEFAULT_PRINTER_PORT;

    await PrintJob.create({
        eventId: scopedEvent.eventId,
        printerId: printer?._id || undefined,
        source: "MANUAL_TEST",
        printType: "MANUAL_TEST",
        status: "SENT",
        destinationHost,
        destinationPort,
        isVirtual: Boolean(printer?.isVirtual),
        copies: 1,
        document: {
            kind: "MANUAL_TEST",
            title: "Ricevuta Demo",
            shortCode: `D-${Date.now().toString().slice(-5)}`,
            customerName: "Cliente Demo",
            tableNumber: "12",
            items: [
                { name: "Panino Salsiccia", quantity: 2 },
                { name: "Birra Media", quantity: 1 }
            ],
            totals: {
                totale: "18.00 EUR"
            },
            createdAt: new Date().toISOString()
        }
    });

    revalidateHardwareViews();
    return { success: true, name: "Job demo creato" };
}

export async function createPosDeviceAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const submittedEventId = formData.get("eventId") as string | null;
    const name = formData.get("name") as string;
    const printerId = formData.get("printerId") as string;
    const paymentTerminalId = formData.get("paymentTerminalId") as string;
    const cashBoxId = formData.get("cashBoxId") as string;

    if (!name || !printerId) return { error: "Dati mancanti" };

    const normalizedPaymentTerminalId = paymentTerminalId === "none" ? "" : paymentTerminalId;
    const normalizedCashBoxId = cashBoxId === "none" ? "" : cashBoxId;

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };
    const scopedEventId = scopedEvent.eventId;

    await dbConnect();

    const printer = await Printer.findOne({ _id: printerId, eventId: scopedEventId, type: "CASHIER" }).select("_id").lean();
    if (!printer) {
        return { error: "La stampante selezionata non appartiene alla festa corrente o non è di tipo cassa" };
    }

    if (normalizedPaymentTerminalId) {
        const paymentTerminal = await Peripheral.findOne({
            _id: normalizedPaymentTerminalId,
            eventId: scopedEventId,
            type: "SUMUP"
        }).select("_id").lean();

        if (!paymentTerminal) {
            return { error: "Il terminale elettronico selezionato non è valido per la festa corrente" };
        }
    }

    if (normalizedCashBoxId) {
        const cashBox = await Peripheral.findOne({
            _id: normalizedCashBoxId,
            eventId: scopedEventId,
            type: "CASH_BOX"
        }).select("_id").lean();

        if (!cashBox) {
            return { error: "La cassetta contanti selezionata non è valida per la festa corrente" };
        }
    }

    await PosDevice.create({
        eventId: scopedEventId,
        name,
        printerId,
        paymentTerminalId: normalizedPaymentTerminalId || undefined,
        cashBoxId: normalizedCashBoxId || undefined
    });

    revalidateHardwareViews();
    return { success: true };
}

export async function deletePosDeviceAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const id = formData.get("id") as string;
    const submittedEventId = formData.get("eventId") as string | null;
    if (!id) return { error: "ID punto cassa mancante" };

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };

    await dbConnect();
    const deletedDevice = await PosDevice.findOneAndDelete({ _id: id, eventId: scopedEvent.eventId }).select("_id").lean();

    if (!deletedDevice) {
        return { error: "Punto cassa non trovato nella festa selezionata" };
    }

    revalidateHardwareViews();
    return { success: true };
}

export async function updatePosDeviceAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const id = formData.get("id") as string;
    const submittedEventId = formData.get("eventId") as string | null;
    const name = formData.get("name") as string;
    const printerId = formData.get("printerId") as string;
    const paymentTerminalId = formData.get("paymentTerminalId") as string;
    const cashBoxId = formData.get("cashBoxId") as string;

    if (!id || !name || !printerId) return { error: "Dati mancanti" };

    const normalizedPaymentTerminalId = paymentTerminalId === "none" ? "" : paymentTerminalId;
    const normalizedCashBoxId = cashBoxId === "none" ? "" : cashBoxId;

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, submittedEventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };
    const scopedEventId = scopedEvent.eventId;

    await dbConnect();

    const printer = await Printer.findOne({ _id: printerId, eventId: scopedEventId, type: "CASHIER" }).select("_id").lean();
    if (!printer) {
        return { error: "La stampante selezionata non appartiene alla festa corrente o non è di tipo cassa" };
    }

    if (normalizedPaymentTerminalId) {
        const paymentTerminal = await Peripheral.findOne({
            _id: normalizedPaymentTerminalId,
            eventId: scopedEventId,
            type: "SUMUP"
        }).select("_id").lean();

        if (!paymentTerminal) {
            return { error: "Il terminale elettronico selezionato non è valido per la festa corrente" };
        }
    }

    if (normalizedCashBoxId) {
        const cashBox = await Peripheral.findOne({
            _id: normalizedCashBoxId,
            eventId: scopedEventId,
            type: "CASH_BOX"
        }).select("_id").lean();

        if (!cashBox) {
            return { error: "La cassetta contanti selezionata non è valida per la festa corrente" };
        }
    }

    const updatedDevice = await PosDevice.findOneAndUpdate(
        { _id: id, eventId: scopedEventId },
        {
            name,
            printerId,
            paymentTerminalId: normalizedPaymentTerminalId || null,
            cashBoxId: normalizedCashBoxId || null
        },
        { new: true }
    ).select("_id").lean();

    if (!updatedDevice) {
        return { error: "Punto cassa non trovato nella festa selezionata" };
    }

    revalidateHardwareViews();
    return { success: true };
}

// PERIPHERAL ACTIONS
export async function createPeripheralAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const submittedEventId = formData.get("eventId") as string | null;
    const name = formData.get("name") as string;
    const type = formData.get("type") as "SUMUP" | "CASH_BOX" | "OTHER";

    // SumUp specific config
    const merchantId = ((formData.get("merchantId") as string) || "").trim();
    const affiliateKey = ((formData.get("affiliateKey") as string) || "").trim();

    if (!name || !type) return { error: "Dati mancanti" };
    if (type === "SUMUP" && (!merchantId || !affiliateKey)) {
        return { error: "Merchant ID e API Key sono obbligatori per terminali SumUp" };
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
            ? { merchantId, affiliateKey: encryptSecret(affiliateKey) }
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
    const type = formData.get("type") as "SUMUP" | "CASH_BOX" | "OTHER";

    const merchantId = ((formData.get("merchantId") as string) || "").trim();
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

    const currentAffiliateKey = getConfigString(currentPeripheral.config, "affiliateKey");
    const currentMerchantId = getConfigString(currentPeripheral.config, "merchantId");

    if (type === "SUMUP") {
        const effectiveMerchantId = merchantId || currentMerchantId || "";
        const effectiveAffiliateKey = affiliateKey || currentAffiliateKey || "";

        if (!effectiveMerchantId || !effectiveAffiliateKey) {
            return { error: "Merchant ID e API Key sono obbligatori per terminali SumUp" };
        }

        const storedAffiliateKey = affiliateKey
            ? encryptSecret(affiliateKey)
            : (currentAffiliateKey && !isEncryptedSecret(currentAffiliateKey)
                ? encryptSecret(currentAffiliateKey)
                : currentAffiliateKey);

        await Peripheral.findOneAndUpdate(
            { _id: id, eventId: scopedEventId },
            {
                name,
                type,
                config: {
                    merchantId: effectiveMerchantId,
                    affiliateKey: storedAffiliateKey
                }
            },
            { new: true }
        );
    } else {
        await Peripheral.findOneAndUpdate(
            { _id: id, eventId: scopedEventId },
            {
                name,
                type,
                config: {}
            },
            { new: true }
        );
    }

    revalidateHardwareViews();
    return { success: true };
}
