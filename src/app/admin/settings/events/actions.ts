"use server";

import dbConnect from "@/lib/mongoose";
import { normalizeAvailableDays } from "@/lib/product-availability";
import { normalizeStockQuantity } from "@/lib/inventory";
import {
    resolveQuickDiscountPresetsFromSettings,
    toLegacyQuickDiscountSettings
} from "@/lib/quick-discount-presets";
import { parsePredefinedTablesInput } from "@/lib/table-presets";
import Category from "@/models/Category";
import CashSession from "@/models/CashSession";
import Event from "@/models/Event";
import Ingredient from "@/models/Ingredient";
import Order from "@/models/Order";
import OrderCounter from "@/models/OrderCounter";
import Peripheral from "@/models/Peripheral";
import PosDevice from "@/models/PosDevice";
import Printer from "@/models/Printer";
import PrintJob from "@/models/PrintJob";
import Product from "@/models/Product";
import { revalidatePath } from "next/cache";
import { requireAdminAuthorization } from "../action-context";
import { claimSumUpEventOperation, releaseSumUpEventOperation } from "@/lib/sumup-event-operation";

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BLOCKING_SUMUP_EVENT_ERROR = "Operazione bloccata: la festa contiene pagamenti SumUp in attesa o non ancora rimborsati.";

async function hasBlockingSumUpPayments(eventId: string) {
    return Boolean(await Order.exists({
        eventId,
        $or: [
            {
                status: "PENDING",
                sumupCheckoutId: { $exists: true, $nin: [null, ""] }
            },
            {
                status: "PAID",
                $or: [
                    { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                    { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                ]
            },
            {
                status: "CANCELLED",
                sumupRecoveryCancelledAt: { $exists: true, $ne: null },
                sumupRecoveryResolvedAt: { $exists: false },
                "stornoMeta.refundStatus": { $ne: "DONE" }
            }
        ]
    }));
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

    const newEvent = await Event.create({
        name: newName,
        active: false,
        archived: false,
        settings: {
            askName: sourceEvent.settings?.askName ?? false,
            askTable: sourceEvent.settings?.askTable ?? false,
            menuHeaderLogoUrl: sourceEvent.settings?.menuHeaderLogoUrl,
            receiptHeaderLogoUrl: sourceEvent.settings?.receiptHeaderLogoUrl,
            portalEasterEggEnabled: sourceEvent.settings?.portalEasterEggEnabled ?? false,
            defaultCashierPrinterIp: sourceEvent.settings?.defaultCashierPrinterIp,
            timezone: sourceEvent.settings?.timezone || "Europe/Rome",
            quickDiscountPresets,
            quickStaffDiscountEnabled: legacyQuickDiscount.quickStaffDiscountEnabled,
            quickStaffDiscountLabel: legacyQuickDiscount.quickStaffDiscountLabel,
            quickStaffDiscountType: legacyQuickDiscount.quickStaffDiscountType,
            quickStaffDiscountValue: legacyQuickDiscount.quickStaffDiscountValue
        },
        predefinedTables: clonedPredefinedTables
    });

    const printers = await Printer.find({ eventId: sourceEventId }).lean();
    const printerMap = new Map();

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

    const categories = await Category.find({ eventId: sourceEventId }).lean();
    const categoryMap = new Map();

    for (const cat of categories) {
        const newCat = await Category.create({
            eventId: newEvent._id,
            name: cat.name,
            uiColor: cat.uiColor,
            printerId: cat.printerId ? printerMap.get(String(cat.printerId)) : null
        });
        categoryMap.set(String(cat._id), newCat._id);
    }

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
            shortName: typeof prod.shortName === "string" ? prod.shortName : undefined,
            description: typeof prod.description === "string" ? prod.description : undefined,
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

export async function archiveEventAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const eventId = formData.get("eventId") as string;
    if (!eventId) return;

    await dbConnect();
    const operationToken = await claimSumUpEventOperation(eventId);
    if (!operationToken) {
        return { error: "Operazione bloccata: un pagamento SumUp o una modifica della festa è già in corso." };
    }
    if (await hasBlockingSumUpPayments(eventId)) {
        await releaseSumUpEventOperation(eventId, operationToken);
        return { error: BLOCKING_SUMUP_EVENT_ERROR };
    }
    await Event.findOneAndUpdate(
        { _id: eventId, "sumupOperationClaim.token": operationToken },
        { $set: { archived: true, active: false }, $unset: { sumupOperationClaim: 1 } }
    );
    revalidatePath("/admin/settings/events");
}

export async function deleteEventAction(formData: FormData) {
    const authError = await requireAdminAuthorization();
    if (authError) return authError;

    const eventId = formData.get("eventId") as string;
    if (!eventId) return;

    await dbConnect();
    const operationToken = await claimSumUpEventOperation(eventId);
    if (!operationToken) {
        return { error: "Operazione bloccata: un pagamento SumUp o una modifica della festa è già in corso." };
    }
    if (await hasBlockingSumUpPayments(eventId)) {
        await releaseSumUpEventOperation(eventId, operationToken);
        return { error: BLOCKING_SUMUP_EVENT_ERROR };
    }
    await PrintJob.deleteMany({ eventId });
    await CashSession.deleteMany({ eventId });
    await Order.deleteMany({ eventId });
    await OrderCounter.deleteMany({ eventId });
    await PosDevice.deleteMany({ eventId });
    await Peripheral.deleteMany({ eventId });
    await Printer.deleteMany({ eventId });
    await Product.deleteMany({ eventId });
    await Ingredient.deleteMany({ eventId });
    await Category.deleteMany({ eventId });
    await Event.findOneAndDelete({ _id: eventId, "sumupOperationClaim.token": operationToken });

    revalidatePath("/admin/settings/events");
}
