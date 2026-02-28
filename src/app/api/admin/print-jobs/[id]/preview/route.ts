import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import dbConnect from "@/lib/mongoose";
import { getAdminContextEventId } from "@/lib/events";
import PrintJob from "@/models/PrintJob";
import { renderEscPosRawToPng } from "@/lib/escpos-preview";

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
            .select("rawCapturePath")
            .lean() as ({ rawCapturePath?: string } | null);

        const rawCapturePath = job?.rawCapturePath?.trim();
        if (!rawCapturePath) {
            return NextResponse.json({ error: "Raw ESC/POS non disponibile per questo job" }, { status: 404 });
        }

        const raw = await fs.readFile(rawCapturePath);
        const image = await renderEscPosRawToPng(raw);
        const imageDataUrl = `data:image/png;base64,${image.toString("base64")}`;

        return NextResponse.json({ imageDataUrl });
    } catch (error) {
        console.error("Print Job preview API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}

