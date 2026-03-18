import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getThermalPaperWidth } from "./easter-egg-config";

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const MENU_HEADER_DIR = path.join(PUBLIC_ROOT, "uploads", "menu-headers");
const RECEIPT_HEADER_DIR = path.join(PUBLIC_ROOT, "uploads", "receipt-headers");
const MENU_HEADER_URL_PREFIX = "/uploads/menu-headers/";
const RECEIPT_HEADER_URL_PREFIX = "/uploads/receipt-headers/";
const ALLOWED_PRINTABLE_LOGO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

function normalizeLogoUrl(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    let decoded = trimmed;
    try {
        decoded = decodeURIComponent(trimmed);
    } catch {
        decoded = trimmed;
    }

    const inAllowedDir = decoded.startsWith(MENU_HEADER_URL_PREFIX) || decoded.startsWith(RECEIPT_HEADER_URL_PREFIX);
    if (!inAllowedDir) return undefined;
    const extension = path.extname(decoded).toLowerCase();
    if (!ALLOWED_PRINTABLE_LOGO_EXTENSIONS.has(extension)) return undefined;
    if (decoded.includes("\0")) return undefined;

    return decoded;
}

export function sanitizeMenuHeaderLogoUrl(value: unknown): string | undefined {
    const normalized = normalizeLogoUrl(value);
    return normalized?.startsWith(MENU_HEADER_URL_PREFIX) ? normalized : undefined;
}

export function sanitizeReceiptHeaderLogoUrl(value: unknown): string | undefined {
    const normalized = normalizeLogoUrl(value);
    return normalized?.startsWith(RECEIPT_HEADER_URL_PREFIX) ? normalized : undefined;
}

export function sanitizePrintableHeaderLogoUrl(value: unknown): string | undefined {
    return normalizeLogoUrl(value);
}

function resolvePublicFileFromUrl(url: string): string | undefined {
    const relativePath = url.startsWith("/") ? url.slice(1) : url;
    const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);
    const rootWithSep = `${PUBLIC_ROOT}${path.sep}`;
    if (!absolutePath.startsWith(rootWithSep)) return undefined;

    try {
        if (!fs.existsSync(absolutePath)) return undefined;
        const stats = fs.statSync(absolutePath);
        if (!stats.isFile()) return undefined;
        return absolutePath;
    } catch {
        return undefined;
    }
}

export function resolvePrintableLogoPathFromUrl(value: unknown): string | undefined {
    const normalized = normalizeLogoUrl(value);
    if (!normalized) return undefined;

    const relativePath = normalized.slice(1);
    const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);

    const menuDirWithSep = `${MENU_HEADER_DIR}${path.sep}`;
    const receiptDirWithSep = `${RECEIPT_HEADER_DIR}${path.sep}`;
    const inAllowedDirectory =
        absolutePath === MENU_HEADER_DIR
        || absolutePath.startsWith(menuDirWithSep)
        || absolutePath === RECEIPT_HEADER_DIR
        || absolutePath.startsWith(receiptDirWithSep);
    if (!inAllowedDirectory) {
        return undefined;
    }

    return resolvePublicFileFromUrl(normalized);
}

export function resolvePrintableLogoPath(settings?: { menuHeaderLogoUrl?: string } | null): string | undefined {
    return resolvePrintableLogoPathFromUrl(settings?.menuHeaderLogoUrl);
}

export async function preparePrintableLogoPngBufferFromUrl(value: unknown): Promise<Buffer | undefined> {
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

        const targetWidth = Math.max(Math.ceil(width / 8) * 8, getThermalPaperWidth());
        const extraWidth = targetWidth - width;
        const leftPadding = Math.floor(extraWidth / 2);
        const rightPadding = extraWidth - leftPadding;

        const normalized = image.extend({
            top: 0,
            bottom: 0,
            left: leftPadding,
            right: rightPadding,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        });

        return await normalized.png().toBuffer();
    } catch {
        return undefined;
    }
}
