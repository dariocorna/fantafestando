import fs from "node:fs";
import sharp from "sharp";
import { getThermalPaperWidth } from "./easter-egg-config";
import {
    resolveManagedUploadUrl,
    type ManagedUploadLocation
} from "./managed-upload";

const RECEIPT_HEADER_MAX_PRINT_CONTENT_WIDTH = 512;
const ALLOWED_PRINTABLE_LOGO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

function resolvePrintableLogo(value: unknown): ManagedUploadLocation | undefined {
    const upload = resolveManagedUploadUrl(value, ["menuHeaders", "receiptHeaders"]);
    if (!upload) return undefined;
    const extension = `.${upload.fileName.split(".").pop() || ""}`.toLowerCase();
    if (!ALLOWED_PRINTABLE_LOGO_EXTENSIONS.has(extension)) return undefined;
    return upload;
}

export function sanitizeMenuHeaderLogoUrl(value: unknown): string | undefined {
    const upload = resolvePrintableLogo(value);
    return upload?.kind === "menuHeaders" ? upload.url : undefined;
}

export function sanitizeReceiptHeaderLogoUrl(value: unknown): string | undefined {
    const upload = resolvePrintableLogo(value);
    return upload?.kind === "receiptHeaders" ? upload.url : undefined;
}

export function sanitizePrintableHeaderLogoUrl(value: unknown): string | undefined {
    return resolvePrintableLogo(value)?.url;
}

export function resolvePrintableLogoPathFromUrl(value: unknown): string | undefined {
    const upload = resolvePrintableLogo(value);
    if (!upload) return undefined;

    try {
        if (!fs.existsSync(upload.filePath)) return undefined;
        const stats = fs.statSync(upload.filePath);
        return stats.isFile() ? upload.filePath : undefined;
    } catch {
        return undefined;
    }
}

export function resolvePrintableLogoPath(settings?: { menuHeaderLogoUrl?: string } | null): string | undefined {
    return resolvePrintableLogoPathFromUrl(settings?.menuHeaderLogoUrl);
}

export async function preparePrintableLogoPngBufferFromUrl(value: unknown): Promise<Buffer | undefined> {
    const upload = resolvePrintableLogo(value);
    if (!upload) return undefined;
    const absolutePath = resolvePrintableLogoPathFromUrl(value);
    if (!absolutePath) return undefined;

    try {
        const image = sharp(absolutePath, { failOn: "error" })
            .rotate()
            .flatten({ background: { r: 255, g: 255, b: 255 } });
        const metadata = await image.metadata();
        const width = Number(metadata.width || 0);
        const height = Number(metadata.height || 0);
        if (width <= 0 || height <= 0) return undefined;

        const maxContentWidth = upload.kind === "receiptHeaders"
            ? RECEIPT_HEADER_MAX_PRINT_CONTENT_WIDTH
            : getThermalPaperWidth();
        const resizedWidth = width > maxContentWidth ? maxContentWidth : width;
        const resizedHeight = width > maxContentWidth
            ? Math.max(1, Math.round(height * (maxContentWidth / width)))
            : height;
        const printableImage = width > maxContentWidth
            ? image.resize(maxContentWidth, resizedHeight, {
                fit: "fill",
                withoutEnlargement: true
            })
            : image;

        const targetWidth = Math.max(Math.ceil(resizedWidth / 8) * 8, getThermalPaperWidth());
        const extraWidth = targetWidth - resizedWidth;
        const leftPadding = Math.floor(extraWidth / 2);
        const rightPadding = extraWidth - leftPadding;

        const normalized = printableImage.extend({
            top: 0,
            bottom: 0,
            left: leftPadding,
            right: rightPadding,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }).greyscale().threshold(180);

        return await normalized.png().toBuffer();
    } catch {
        return undefined;
    }
}
