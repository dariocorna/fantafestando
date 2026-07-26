import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import {
    getThermalContentWidth,
    getThermalPaperWidth,
    normalizeEasterEggCrop,
    type EasterEggCrop,
    type EasterEggProcessingSettings
} from "./easter-egg-config";
import {
    buildThermalRasterFromRgba,
    computeSourceCropRect,
    unpackThermalRasterToPixels,
    type ThermalRasterPayload
} from "./easter-egg-raster";

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const EASTER_EGG_DIR = path.join(PUBLIC_ROOT, "uploads", "easter-eggs");
const EASTER_EGG_URL_PREFIX = "/uploads/easter-eggs/";
export interface ThermalRasterImage extends ThermalRasterPayload {
    data: Buffer;
}

interface RenderThermalRasterToPngOptions {
    centerOnPaper?: boolean;
}

function getAutoOrientedDimensions(metadata: Metadata): { width: number; height: number } {
    const autoOrientedWidth = Number(metadata.autoOrient?.width || 0);
    const autoOrientedHeight = Number(metadata.autoOrient?.height || 0);
    if (autoOrientedWidth > 0 && autoOrientedHeight > 0) {
        return {
            width: autoOrientedWidth,
            height: autoOrientedHeight
        };
    }

    return {
        width: Number(metadata.width || 0),
        height: Number(metadata.height || 0)
    };
}

function normalizeUrl(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    let decoded = trimmed;
    try {
        decoded = decodeURIComponent(trimmed);
    } catch {
        decoded = trimmed;
    }

    if (!decoded.startsWith(EASTER_EGG_URL_PREFIX)) return undefined;
    const lower = decoded.toLowerCase();
    if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg")) return undefined;
    if (decoded.includes("\0")) return undefined;
    return decoded;
}

export function sanitizeEasterEggImageUrl(value: unknown): string | undefined {
    return normalizeUrl(value);
}

export async function resolveEasterEggImagePathFromUrl(value: unknown): Promise<string | undefined> {
    const normalized = normalizeUrl(value);
    if (!normalized) return undefined;

    const relativePath = normalized.slice(1);
    const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);
    const dirWithSep = `${EASTER_EGG_DIR}${path.sep}`;
    if (absolutePath !== EASTER_EGG_DIR && !absolutePath.startsWith(dirWithSep)) {
        return undefined;
    }

    try {
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) return undefined;
        return absolutePath;
    } catch {
        return undefined;
    }
}

async function centerPadPngToPaperWidth(input: Buffer): Promise<Buffer> {
    const paperWidth = getThermalPaperWidth();
    const metadata = await sharp(input).metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (width <= 0 || height <= 0) return input;
    if (width >= paperWidth) return input;

    const left = Math.floor((paperWidth - width) / 2);
    const right = paperWidth - width - left;

    return sharp(input)
        .extend({
            top: 0,
            bottom: 0,
            left,
            right,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toBuffer();
}

async function prepareResizedRgbaFromUrl(
    imageUrl: string,
    cropInput: Partial<EasterEggCrop> | null | undefined
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number } | undefined> {
    const absolutePath = await resolveEasterEggImagePathFromUrl(imageUrl);
    if (!absolutePath) return undefined;

    const crop = normalizeEasterEggCrop(cropInput);

    try {
        const contentWidth = getThermalContentWidth();
        const image = sharp(absolutePath, { failOn: "error" }).rotate();
        const metadata = await image.metadata();
        const { width, height } = getAutoOrientedDimensions(metadata);
        if (width <= 0 || height <= 0) return undefined;

        const cropRect = computeSourceCropRect(width, height, crop);
        const { data, info } = await image
            .extract(cropRect)
            .resize({
                width: contentWidth,
                withoutEnlargement: false
            })
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        return {
            rgba: new Uint8ClampedArray(data),
            width: info.width,
            height: info.height
        };
    } catch {
        return undefined;
    }
}

export async function renderThermalRasterToPng(
    raster: ThermalRasterImage,
    options?: RenderThermalRasterToPngOptions
): Promise<Buffer> {
    if (raster.width <= 0 || raster.height <= 0 || raster.data.length === 0) {
        return await sharp({
            create: {
                width: 1,
                height: 1,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
            }
        }).png().toBuffer();
    }

    const pixels = Buffer.from(unpackThermalRasterToPixels(raster));

    const image = await sharp(pixels, {
        raw: {
            width: raster.width,
            height: raster.height,
            channels: 1
        }
    }).png().toBuffer();

    if (options?.centerOnPaper) {
        return await centerPadPngToPaperWidth(image);
    }

    return image;
}

export async function renderThermalRasterToStripePngBuffers(
    raster: ThermalRasterImage,
    stripeHeight: number,
    options?: RenderThermalRasterToPngOptions
): Promise<Buffer[]> {
    const safeStripeHeight = Math.max(1, Math.floor(stripeHeight));
    if (raster.width <= 0 || raster.height <= 0 || raster.data.length === 0) {
        return [];
    }

    const pixels = unpackThermalRasterToPixels(raster);
    const buffers: Buffer[] = [];

    for (let top = 0; top < raster.height; top += safeStripeHeight) {
        const height = Math.min(safeStripeHeight, raster.height - top);
        const stripePixels = Buffer.alloc(raster.width * height);

        for (let row = 0; row < height; row += 1) {
            const sourceStart = (top + row) * raster.width;
            const sourceEnd = sourceStart + raster.width;
            const targetStart = row * raster.width;
            stripePixels.set(pixels.subarray(sourceStart, sourceEnd), targetStart);
        }

        let png: Buffer = await sharp(stripePixels, {
            raw: {
                width: raster.width,
                height,
                channels: 1
            }
        }).png().toBuffer();

        if (options?.centerOnPaper) {
            png = await centerPadPngToPaperWidth(png);
        }

        buffers.push(png);
    }

    return buffers;
}

export async function preparePrintableEasterEggPngBufferFromUrl(
    imageUrl: string,
    cropInput: Partial<EasterEggCrop> | null | undefined,
    processingInput?: Partial<EasterEggProcessingSettings> | null
): Promise<Buffer | undefined> {
    const raster = await preparePrintableEasterEggRasterFromUrl(imageUrl, cropInput, processingInput);
    if (!raster) return undefined;
    return await renderThermalRasterToPng(raster, { centerOnPaper: true });
}

export async function preparePrintableEasterEggRasterFromUrl(
    imageUrl: string,
    cropInput: Partial<EasterEggCrop> | null | undefined,
    processingInput?: Partial<EasterEggProcessingSettings> | null
): Promise<ThermalRasterImage | undefined> {
    const prepared = await prepareResizedRgbaFromUrl(imageUrl, cropInput);
    if (!prepared) return undefined;

    const raster = buildThermalRasterFromRgba(
        prepared.rgba,
        prepared.width,
        prepared.height,
        processingInput
    );

    return {
        width: raster.width,
        height: raster.height,
        data: Buffer.from(raster.data)
    };
}
