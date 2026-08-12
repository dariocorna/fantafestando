"use server";

import dbConnect from "@/lib/mongoose";
import { normalizePosCatalogLayout } from "@/lib/pos-catalog-layout";
import {
    MAX_QUICK_DISCOUNT_PRESETS,
    resolveQuickDiscountPresetsFromSettings,
    toLegacyQuickDiscountSettings,
    validateQuickDiscountPresets
} from "@/lib/quick-discount-presets";
import {
    MAX_PREDEFINED_TABLES,
    parsePredefinedTablesInput
} from "@/lib/table-presets";
import Event from "@/models/Event";
import { revalidatePath } from "next/cache";
import {
    requireAdminAuthorization,
    requireContextEventId,
    resolveEventScope
} from "./action-context";
import {
    deleteMenuHeaderLogoIfManaged,
    deleteReceiptHeaderLogoIfManaged,
    persistMenuHeaderLogo,
    persistReceiptHeaderLogo
} from "./media";

function isValidTimezone(value: string): boolean {
    try {
        new Intl.DateTimeFormat("it-IT", { timeZone: value }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

export async function updateEventSettingsAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const eventId = formData.get("eventId") as string;
    const askName = formData.get("askName") === "on";
    const askTable = formData.get("askTable") === "on";
    const portalEasterEggEnabled = formData.get("portalEasterEggEnabled") === "on";
    const posCatalogLayoutRaw = ((formData.get("posCatalogLayout") as string | null) || "").trim();
    const timezone = ((formData.get("timezone") as string | null) || "").trim() || "Europe/Rome";
    const defaultCashierPrinterIp = formData.get("defaultCashierPrinterIp") as string;
    const quickDiscountPresetsRaw = (formData.get("quickDiscountPresets") as string | null)?.trim() || "";
    const menuHeaderLogoFile = formData.get("menuHeaderLogoFile");
    const removeMenuHeaderLogo = formData.get("removeMenuHeaderLogo") === "on";
    const receiptHeaderLogoFile = formData.get("receiptHeaderLogoFile");
    const removeReceiptHeaderLogo = formData.get("removeReceiptHeaderLogo") === "on";
    const active = formData.get("active") === "on";
    const predefinedTablesInput = formData.get("predefinedTables") as string | null;
    const normalizedInputTables = parsePredefinedTablesInput(predefinedTablesInput, Number.MAX_SAFE_INTEGER);
    const distinctPredefinedTablesCount = normalizedInputTables.length;

    if (!eventId) return { error: "Event ID obbligatorio" };
    if (!isValidTimezone(timezone)) {
        return { error: "Fuso orario non valido. Usa un identificatore IANA, ad esempio Europe/Rome." };
    }

    const posCatalogLayout = normalizePosCatalogLayout(posCatalogLayoutRaw);

    const contextEventId = await requireContextEventId();
    const scopedEvent = resolveEventScope(contextEventId, eventId);
    if ("error" in scopedEvent) return { error: scopedEvent.error };
    const scopedEventId = scopedEvent.eventId;

    await dbConnect();
    const targetEvent = await Event.findOne({ _id: scopedEventId, archived: { $ne: true } })
        .select("archived predefinedTables settings.menuHeaderLogoUrl settings.receiptHeaderLogoUrl")
        .lean() as ({ archived?: boolean; predefinedTables?: string[]; settings?: { menuHeaderLogoUrl?: string; receiptHeaderLogoUrl?: string } } | null);

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
    const currentReceiptHeaderLogoUrl = targetEvent.settings?.receiptHeaderLogoUrl?.trim() || "";
    let nextMenuHeaderLogoUrl: string | null = null;
    let nextReceiptHeaderLogoUrl: string | null = null;

    if (menuHeaderLogoFile instanceof File && menuHeaderLogoFile.size > 0) {
        const uploadResult = await persistMenuHeaderLogo(menuHeaderLogoFile);
        if ("error" in uploadResult) {
            return { error: uploadResult.error };
        }
        nextMenuHeaderLogoUrl = uploadResult.url;
    } else if (removeMenuHeaderLogo) {
        nextMenuHeaderLogoUrl = "";
    }

    if (receiptHeaderLogoFile instanceof File && receiptHeaderLogoFile.size > 0) {
        const uploadResult = await persistReceiptHeaderLogo(receiptHeaderLogoFile);
        if ("error" in uploadResult) {
            return { error: uploadResult.error };
        }
        nextReceiptHeaderLogoUrl = uploadResult.url;
    } else if (removeReceiptHeaderLogo) {
        nextReceiptHeaderLogoUrl = "";
    }

    const settingsSet: Record<string, unknown> = {
        active,
        "settings.askName": askName,
        "settings.askTable": askTable,
        "settings.portalEasterEggEnabled": portalEasterEggEnabled,
        "settings.posCatalogLayout": posCatalogLayout,
        "settings.timezone": timezone,
        "settings.defaultCashierPrinterIp": defaultCashierPrinterIp,
        "settings.quickDiscountPresets": quickDiscountPresets,
        "settings.quickStaffDiscountEnabled": legacyQuickDiscount.quickStaffDiscountEnabled,
        "settings.quickStaffDiscountLabel": legacyQuickDiscount.quickStaffDiscountLabel,
        "settings.quickStaffDiscountType": legacyQuickDiscount.quickStaffDiscountType,
        "settings.quickStaffDiscountValue": legacyQuickDiscount.quickStaffDiscountValue,
        predefinedTables
    };
    const settingsUnset: Record<string, number> = {
        "settings.sumupMerchantCode": 1,
        "settings.sumupApiKey": 1
    };

    if (nextMenuHeaderLogoUrl !== null && nextMenuHeaderLogoUrl) {
        settingsSet["settings.menuHeaderLogoUrl"] = nextMenuHeaderLogoUrl;
    }
    if (nextMenuHeaderLogoUrl === "") {
        settingsUnset["settings.menuHeaderLogoUrl"] = 1;
    }
    if (nextReceiptHeaderLogoUrl !== null && nextReceiptHeaderLogoUrl) {
        settingsSet["settings.receiptHeaderLogoUrl"] = nextReceiptHeaderLogoUrl;
    }
    if (nextReceiptHeaderLogoUrl === "") {
        settingsUnset["settings.receiptHeaderLogoUrl"] = 1;
    }

    if (active) {
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
        if (nextMenuHeaderLogoUrl) await deleteMenuHeaderLogoIfManaged(nextMenuHeaderLogoUrl);
        if (nextReceiptHeaderLogoUrl) await deleteReceiptHeaderLogoIfManaged(nextReceiptHeaderLogoUrl);
        throw error;
    }

    if (nextMenuHeaderLogoUrl !== null && currentMenuHeaderLogoUrl && currentMenuHeaderLogoUrl !== nextMenuHeaderLogoUrl) {
        await deleteMenuHeaderLogoIfManaged(currentMenuHeaderLogoUrl);
    }
    if (nextReceiptHeaderLogoUrl !== null && currentReceiptHeaderLogoUrl && currentReceiptHeaderLogoUrl !== nextReceiptHeaderLogoUrl) {
        await deleteReceiptHeaderLogoIfManaged(currentReceiptHeaderLogoUrl);
    }

    const resolvedMenuHeaderLogoUrl = nextMenuHeaderLogoUrl !== null
        ? nextMenuHeaderLogoUrl
        : currentMenuHeaderLogoUrl;
    const resolvedReceiptHeaderLogoUrl = nextReceiptHeaderLogoUrl !== null
        ? nextReceiptHeaderLogoUrl
        : currentReceiptHeaderLogoUrl;

    revalidatePath("/admin", "layout");
    revalidatePath("/admin/settings");
    revalidatePath("/admin/settings/events");
    revalidatePath("/menu");
    return {
        success: true,
        menuHeaderLogoUrl: resolvedMenuHeaderLogoUrl,
        receiptHeaderLogoUrl: resolvedReceiptHeaderLogoUrl
    };
}
