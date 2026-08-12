"use server";

import dbConnect from "@/lib/mongoose";
import Peripheral from "@/models/Peripheral";
import PosDevice from "@/models/PosDevice";
import Printer from "@/models/Printer";
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
            type: { $in: ["SUMUP", "ELECTRONIC_MANUAL"] }
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
            type: { $in: ["SUMUP", "ELECTRONIC_MANUAL"] }
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
        { returnDocument: "after" }
    ).select("_id").lean();

    if (!updatedDevice) {
        return { error: "Punto cassa non trovato nella festa selezionata" };
    }

    revalidateHardwareViews();
    return { success: true };
}
