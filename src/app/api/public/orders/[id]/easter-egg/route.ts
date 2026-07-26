import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { hashEasterEggUploadToken } from "@/lib/easter-egg-order";
import { parseThermalRasterFormData } from "@/lib/easter-egg-raster-upload";
import { consumeRateLimit, resolveClientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await context.params;
        if (!id) {
            return NextResponse.json({ error: "Ordine non valido" }, { status: 400 });
        }

        const { allowed } = consumeRateLimit(
            `easter-egg-upload:${resolveClientKey(request.headers)}`,
            30,
            10 * 60 * 1000
        );
        if (!allowed) {
            return NextResponse.json({ error: "Troppe richieste" }, { status: 429 });
        }

        const formData = await request.formData();
        const token = String(formData.get("token") || "").trim();
        if (!token) {
            return NextResponse.json({ error: "Token upload mancante" }, { status: 400 });
        }

        const parsedRaster = await parseThermalRasterFormData(formData);
        if (!parsedRaster.success) {
            return NextResponse.json({ error: parsedRaster.error }, { status: 400 });
        }

        await dbConnect();
        const order = await Order.findById(id)
            .select("status easterEggAttachment.uploadTokenHash easterEggAttachment.printedAt")
            .lean() as ({
                status?: string;
                easterEggAttachment?: {
                    uploadTokenHash?: string;
                    printedAt?: Date | string;
                };
            } | null);

        if (!order) {
            return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
        }
        if (order.status !== "PENDING") {
            return NextResponse.json({ error: "Ordine non più modificabile" }, { status: 409 });
        }
        if (order.easterEggAttachment?.printedAt) {
            return NextResponse.json({ error: "Immagine già stampata" }, { status: 409 });
        }

        const expectedHash = order.easterEggAttachment?.uploadTokenHash?.trim();
        if (!expectedHash || expectedHash !== hashEasterEggUploadToken(token)) {
            return NextResponse.json({ error: "Token upload non valido" }, { status: 403 });
        }

        const updateResult = await Order.updateOne(
            {
                _id: id,
                status: "PENDING",
                "easterEggAttachment.printedAt": { $exists: false },
                "easterEggAttachment.uploadTokenHash": expectedHash
            },
            {
                $set: {
                    "easterEggAttachment.rasterWidth": parsedRaster.raster.width,
                    "easterEggAttachment.rasterHeight": parsedRaster.raster.height,
                    "easterEggAttachment.rasterData": Buffer.from(parsedRaster.raster.data),
                    "easterEggAttachment.uploadedAt": new Date()
                }
            }
        );

        if (!updateResult.acknowledged || updateResult.matchedCount !== 1) {
            return NextResponse.json({ error: "Ordine non più modificabile" }, { status: 409 });
        }

        return NextResponse.json({
            success: "Foto allegata all'ordine. Puoi sostituirla finché non paghi in cassa."
        });
    } catch (error) {
        console.error("Public easter egg upload API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
