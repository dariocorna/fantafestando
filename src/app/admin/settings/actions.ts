"use server";

import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import Category from "@/models/Category";
import Product from "@/models/Product";
import Printer from "@/models/Printer";
import PosDevice from "@/models/PosDevice";
import { revalidatePath } from "next/cache";

export async function createEventAction(formData: FormData) {
    const name = formData.get("name") as string;
    if (!name) return { error: "Nome obbligatorio" };

    await dbConnect();
    await Event.create({
        name,
        active: false,
        archived: false,
        settings: { askName: false, askTable: false }
    });

    revalidatePath("/admin/settings/events");
    return { success: true };
}

export async function updateEventSettingsAction(formData: FormData) {
    const eventId = formData.get("eventId") as string;
    const askName = formData.get("askName") === "on";
    const askTable = formData.get("askTable") === "on";
    const defaultCashierPrinterIp = formData.get("defaultCashierPrinterIp") as string;
    const active = formData.get("active") === "on";
    const sumupMerchantCode = formData.get("sumupMerchantCode") as string;
    const sumupApiKey = formData.get("sumupApiKey") as string;

    if (!eventId) return { error: "Event ID obbligatorio" };

    await dbConnect();

    if (active) {
        // Deactivate all others first
        await Event.updateMany({ _id: { $ne: eventId } }, { active: false });
    }

    await Event.findByIdAndUpdate(eventId, {
        active,
        "settings.askName": askName,
        "settings.askTable": askTable,
        "settings.defaultCashierPrinterIp": defaultCashierPrinterIp,
        "settings.sumupMerchantCode": sumupMerchantCode,
        "settings.sumupApiKey": sumupApiKey
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/settings/events");
    return { success: true };
}

export async function cloneEventAction(formData: FormData) {
    const sourceEventId = formData.get("sourceEventId") as string;
    const newName = formData.get("newName") as string;
    if (!sourceEventId || !newName) return { error: "Dati mancanti" };

    await dbConnect();

    const sourceEvent = await Event.findById(sourceEventId).lean();
    if (!sourceEvent) return { error: "Evento sorgente non trovato" };

    // 1. Crea la nuova festa
    const newEvent = await Event.create({
        name: newName,
        active: false,
        archived: false,
        settings: sourceEvent.settings
    });

    // 2. Clona i Printers
    const printers = await Printer.find({ eventId: sourceEventId }).lean();
    const printerMap = new Map(); // mappa vecchi id -> nuovi id

    for (const printer of printers) {
        const newPrinter = await Printer.create({
            eventId: newEvent._id,
            name: printer.name,
            ip: printer.ip,
            type: printer.type
        });
        printerMap.set(String(printer._id), newPrinter._id);
    }

    // 3. Clona i PosDevices
    const posDevices = await PosDevice.find({ eventId: sourceEventId }).lean();
    for (const posDevice of posDevices) {
        await PosDevice.create({
            eventId: newEvent._id,
            name: posDevice.name,
            printerId: posDevice.printerId ? printerMap.get(String(posDevice.printerId)) : null
        });
    }

    // 4. Clona le Categorie
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

    // 5. Clona i Prodotti associandoli alle nuove Categorie
    const products = await Product.find({ eventId: sourceEventId }).lean();
    for (const prod of products) {
        await Product.create({
            eventId: newEvent._id,
            categoryId: categoryMap.get(String(prod.categoryId)),
            name: prod.name,
            basePrice: prod.basePrice,
            isSoldOut: false,
            variants: prod.variants
        });
    }

    revalidatePath("/admin/settings/events");
    return { success: true };
}

// PRINTER ACTIONS
export async function createPrinterAction(formData: FormData) {
    const eventId = formData.get("eventId") as string;
    const name = formData.get("name") as string;
    const ip = formData.get("ip") as string;
    const type = formData.get("type") as "CASHIER" | "KITCHEN";

    if (!eventId || !name || !ip) return { error: "Dati mancanti" };

    await dbConnect();
    await Printer.create({ eventId, name, ip, type });

    revalidatePath("/admin/settings/printers");
    return { success: true };
}

export async function deletePrinterAction(formData: FormData) {
    const id = formData.get("id") as string;
    if (!id) return;

    await dbConnect();
    await Printer.findByIdAndDelete(id);

    // Unlink from categories
    const Category = (await import("@/models/Category")).default;
    await Category.updateMany({ printerId: id }, { $unset: { printerId: 1 } });

    // Delete PosDevices linked to this printer
    const PosDevice = (await import("@/models/PosDevice")).default;
    await PosDevice.deleteMany({ printerId: id });

    revalidatePath("/admin/settings/printers");
}

export async function updatePrinterAction(formData: FormData) {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const ip = formData.get("ip") as string;
    const type = formData.get("type") as "CASHIER" | "KITCHEN";

    if (!id || !name || !ip) return { error: "Dati mancanti" };

    await dbConnect();
    await Printer.findByIdAndUpdate(id, { name, ip, type });

    revalidatePath("/admin/settings/printers");
    return { success: true };
}

// POS DEVICE ACTIONS
export async function createPosDeviceAction(formData: FormData) {
    const eventId = formData.get("eventId") as string;
    const name = formData.get("name") as string;
    const printerId = formData.get("printerId") as string;

    if (!eventId || !name || !printerId) return { error: "Dati mancanti" };

    await dbConnect();
    await PosDevice.create({ eventId, name, printerId });
    revalidatePath("/admin/settings/pos");
    return { success: true };
}

export async function deletePosDeviceAction(formData: FormData) {
    const id = formData.get("id") as string;
    if (!id) return;

    await dbConnect();
    await PosDevice.findByIdAndDelete(id);

    revalidatePath("/admin/settings/pos");
}

export async function updatePosDeviceAction(formData: FormData) {
    const id = formData.get("id") as string;
    const name = formData.get("name") as string;
    const printerId = formData.get("printerId") as string;

    if (!id || !name || !printerId) return { error: "Dati mancanti" };

    await dbConnect();
    await PosDevice.findByIdAndUpdate(id, { name, printerId });

    revalidatePath("/admin/settings/pos");
    return { success: true };
}
