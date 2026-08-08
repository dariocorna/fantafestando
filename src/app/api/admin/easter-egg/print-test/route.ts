import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz";
import { getAdminContextEventId } from "@/lib/events";
import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import Printer from "@/models/Printer";
import { parseThermalRasterFormData } from "@/lib/easter-egg-raster-upload";
import { sanitizePrintableHeaderLogoUrl, sanitizeReceiptHeaderLogoUrl } from "@/lib/print-branding";
import { PrinterService } from "@/lib/printer";
import { DEFAULT_PRINTER_PORT, selectBestEasterEggPrinter } from "@/lib/printer-config";

export async function POST(request: NextRequest) {
    try {
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) {
            return adminUnauthorizedJson(sessionCheck);
        }

        const contextEventId = await getAdminContextEventId();
        if (!contextEventId) {
            return NextResponse.json({ error: "Seleziona una festa valida prima di stampare" }, { status: 400 });
        }

        const formData = await request.formData();
        const parsedRaster = await parseThermalRasterFormData(formData);
        if (!parsedRaster.success) {
            return NextResponse.json({ error: parsedRaster.error }, { status: 400 });
        }

        await dbConnect();
        const event = await Event.findById(contextEventId)
            .select("name settings.defaultCashierPrinterIp settings.menuHeaderLogoUrl settings.receiptHeaderLogoUrl")
            .lean() as ({
                name?: string;
                settings?: {
                    defaultCashierPrinterIp?: string;
                    menuHeaderLogoUrl?: string;
                    receiptHeaderLogoUrl?: string;
                };
            } | null);

        if (!event) {
            return NextResponse.json({ error: "Festa non trovata" }, { status: 404 });
        }

        const printers = await Printer.find({ eventId: contextEventId })
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

        const requestedPrinterId = String(formData.get("printerId") || "").trim();
        const explicitPrinter = requestedPrinterId
            ? printers.find((candidate) => String(candidate._id) === requestedPrinterId)
            : null;

        if (requestedPrinterId && !explicitPrinter) {
            return NextResponse.json({ error: "Stampante selezionata non trovata" }, { status: 400 });
        }

        const printer = explicitPrinter || selectBestEasterEggPrinter(printers, event.settings?.defaultCashierPrinterIp);
        if (!printer?.ip?.trim()) {
            return NextResponse.json({ error: "Nessuna stampante configurata per la festa corrente." }, { status: 400 });
        }

        const printed = await PrinterService.printRasterImage({
            ip: printer.ip,
            port: printer.port || DEFAULT_PRINTER_PORT,
            printerId: String(printer._id),
            eventId: contextEventId,
            source: "MANUAL_TEST",
            printType: "EASTER_EGG_IMAGE",
            isVirtual: Boolean(printer.isVirtual),
            emulatorSlot: printer.emulatorSlot,
            title: "Easter Egg Portale",
            eventName: event.name?.trim() || undefined,
            brandingLogoUrl: sanitizeReceiptHeaderLogoUrl(event.settings?.receiptHeaderLogoUrl)
                || sanitizePrintableHeaderLogoUrl(event.settings?.menuHeaderLogoUrl),
            copyLabel: "EASTER EGG",
            footerLines: ["Raster generato solo lato client"]
        }, {
            width: parsedRaster.raster.width,
            height: parsedRaster.raster.height,
            data: Buffer.from(parsedRaster.raster.data)
        });

        if (!printed) {
            return NextResponse.json({ error: "Invio stampa non riuscito. Controlla il Monitor Stampa." }, { status: 500 });
        }

        return NextResponse.json({ success: "Stampa easter egg inviata." });
    } catch (error) {
        console.error("Admin easter egg print test API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
