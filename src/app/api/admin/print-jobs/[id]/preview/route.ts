import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import dbConnect from "@/lib/mongoose";
import { getAdminContextEventId } from "@/lib/events";
import PrintJob from "@/models/PrintJob";
import { renderEscPosRawToPng } from "@/lib/escpos-preview";
import {
    preparePrintableEasterEggRasterFromUrl,
    renderThermalRasterToPng
} from "@/lib/easter-egg-image";

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const contextEventId = await getAdminContextEventId();
        if (!contextEventId) {
            return NextResponse.json({ error: "Nessuna festa selezionata" }, { status: 400 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ error: "ID job mancante" }, { status: 400 });
        }

        await dbConnect();
        const job = await PrintJob.findOne({ _id: id, eventId: contextEventId })
            .select("rawCapturePath printType document")
            .lean() as ({
                rawCapturePath?: string;
                printType?: string;
                document?: Record<string, unknown>;
            } | null);

        const rawCapturePath = job?.rawCapturePath?.trim();
        if (rawCapturePath) {
            const raw = await fs.readFile(rawCapturePath);
            const image = await renderEscPosRawToPng(raw);
            const imageDataUrl = `data:image/png;base64,${image.toString("base64")}`;

            return NextResponse.json({ imageDataUrl });
        }

        if (job?.printType === "EASTER_EGG_IMAGE") {
            const imageUrl = typeof job.document?.imageUrl === "string" ? job.document.imageUrl : "";
            const crop = job.document?.crop && typeof job.document.crop === "object"
                ? job.document.crop as Record<string, unknown>
                : undefined;
            const processing = job.document?.processing && typeof job.document.processing === "object"
                ? job.document.processing as Record<string, unknown>
                : undefined;

            const raster = imageUrl
                ? await preparePrintableEasterEggRasterFromUrl(imageUrl, crop, processing)
                : undefined;

            if (raster) {
                const image = await renderThermalRasterToPng(raster, { centerOnPaper: true });
                const imageDataUrl = `data:image/png;base64,${image.toString("base64")}`;
                return NextResponse.json({ imageDataUrl, source: "fallback-image" });
            }
        }

        return NextResponse.json({ error: "Anteprima non disponibile per questo job" }, { status: 404 });
    } catch (error) {
        console.error("Print Job preview API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
