import { NextRequest, NextResponse } from "next/server";
import {
    normalizeEasterEggCrop,
    normalizeEasterEggProcessingSettings,
    type EasterEggAspectRatio,
} from "@/lib/easter-egg-config";
import {
    preparePrintableEasterEggRasterFromUrl,
    renderThermalRasterToPng,
    sanitizeEasterEggImageUrl
} from "@/lib/easter-egg-image";
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz";

function parseBoolean(value: string | null): boolean {
    return value === "true" || value === "1" || value === "on";
}

function parseOptionalNumber(value: string | null): number | undefined {
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAspectRatio(value: string | null): EasterEggAspectRatio | undefined {
    if (value === "PORTRAIT_3_4" || value === "SQUARE_1_1" || value === "THERMAL_58") {
        return value;
    }
    return undefined;
}

export async function GET(request: NextRequest) {
    try {
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) {
            return adminUnauthorizedJson(sessionCheck);
        }

        const imageUrl = sanitizeEasterEggImageUrl(request.nextUrl.searchParams.get("imageUrl"));
        if (!imageUrl) {
            return NextResponse.json({ error: "Immagine non valida" }, { status: 400 });
        }

        const crop = normalizeEasterEggCrop({
            centerX: parseOptionalNumber(request.nextUrl.searchParams.get("centerX")),
            centerY: parseOptionalNumber(request.nextUrl.searchParams.get("centerY")),
            zoom: parseOptionalNumber(request.nextUrl.searchParams.get("zoom")),
            aspectRatio: parseAspectRatio(request.nextUrl.searchParams.get("aspectRatio"))
        });
        const processing = normalizeEasterEggProcessingSettings({
            autoEnhance: parseBoolean(request.nextUrl.searchParams.get("autoEnhance")),
            brightnessBoost: parseOptionalNumber(request.nextUrl.searchParams.get("brightnessBoost")),
            thresholdBase: parseOptionalNumber(request.nextUrl.searchParams.get("thresholdBase"))
        });

        const raster = await preparePrintableEasterEggRasterFromUrl(imageUrl, crop, processing);
        if (!raster) {
            return NextResponse.json({ error: "Anteprima non disponibile" }, { status: 404 });
        }
        const image = await renderThermalRasterToPng(raster, { centerOnPaper: true });

        return new NextResponse(new Uint8Array(image), {
            headers: {
                "Content-Type": "image/png",
                "Cache-Control": "no-store"
            }
        });
    } catch (error) {
        console.error("Portal easter egg preview API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
