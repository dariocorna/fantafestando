import sharp, { type Sharp } from "sharp";

export const MENU_HEADER_LOGO_TARGET_RATIO = 10 / 4;
export const MENU_HEADER_LOGO_RATIO_TOLERANCE = 0.12;
export const MENU_HEADER_LOGO_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const RECEIPT_HEADER_LOGO_TARGET_RATIO = 10 / 3;
export const RECEIPT_HEADER_LOGO_MAX_PRINT_CONTENT_WIDTH = 512;

const HEADER_LOGO_ALLOWED_TYPES = new Map<string, string>([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
]);

type HeaderLogoSuccess = {
    success: true;
    pngBuffer: Buffer;
    width: number;
    height: number;
};

type HeaderLogoFailure = {
    success: false;
    error: string;
};

export type HeaderLogoProcessingResult = HeaderLogoSuccess | HeaderLogoFailure;

function isSupportedMimeType(mimeType: string) {
    return HEADER_LOGO_ALLOWED_TYPES.has(mimeType);
}

async function decodeAndNormalizeImage(buffer: Buffer): Promise<{
    image: Sharp;
    width: number;
    height: number;
} | null> {
    try {
        const image = sharp(buffer, { failOn: "error" })
            .rotate()
            .flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } });
        const metadata = await image.metadata();
        const width = Number(metadata.width || 0);
        const height = Number(metadata.height || 0);

        if (width <= 0 || height <= 0) {
            return null;
        }

        return { image, width, height };
    } catch {
        return null;
    }
}

export async function normalizeMenuHeaderLogoUpload(
    buffer: Buffer,
    mimeType: string
): Promise<HeaderLogoProcessingResult> {
    if (!isSupportedMimeType(mimeType)) {
        return { success: false, error: "Formato logo non supportato: usa PNG o JPEG." };
    }

    const normalizedSource = await decodeAndNormalizeImage(buffer);
    if (!normalizedSource) {
        return { success: false, error: "Immagine logo non valida o corrotta." };
    }

    const ratio = normalizedSource.width / normalizedSource.height;
    if (Math.abs(ratio - MENU_HEADER_LOGO_TARGET_RATIO) > MENU_HEADER_LOGO_RATIO_TOLERANCE) {
        return { success: false, error: "Rapporto logo non valido: richiesto 10:4 (tolleranza ±12%)." };
    }

    const pngBuffer = await normalizedSource.image
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();

    if (pngBuffer.length > MENU_HEADER_LOGO_MAX_OUTPUT_BYTES) {
        return {
            success: false,
            error: "Logo troppo pesante dopo la normalizzazione: usa un'immagine più semplice o più piccola."
        };
    }

    return {
        success: true,
        pngBuffer,
        width: normalizedSource.width,
        height: normalizedSource.height
    };
}

export async function normalizeReceiptHeaderLogoUpload(
    buffer: Buffer,
    mimeType: string
): Promise<HeaderLogoProcessingResult> {
    if (!isSupportedMimeType(mimeType)) {
        return { success: false, error: "Formato header scontrino non supportato: usa PNG o JPEG." };
    }

    const normalizedSource = await decodeAndNormalizeImage(buffer);
    if (!normalizedSource) {
        return { success: false, error: "Immagine header scontrino non valida o corrotta." };
    }

    let targetWidth = normalizedSource.width;
    let targetHeight = normalizedSource.height;
    const sourceRatio = normalizedSource.width / normalizedSource.height;

    if (sourceRatio > RECEIPT_HEADER_LOGO_TARGET_RATIO) {
        targetHeight = Math.max(1, Math.round(normalizedSource.width / RECEIPT_HEADER_LOGO_TARGET_RATIO));
    } else if (sourceRatio < RECEIPT_HEADER_LOGO_TARGET_RATIO) {
        targetWidth = Math.max(1, Math.round(normalizedSource.height * RECEIPT_HEADER_LOGO_TARGET_RATIO));
    }

    let image = normalizedSource.image.resize(targetWidth, targetHeight, {
        fit: "contain",
        position: "center",
        background: { r: 255, g: 255, b: 255, alpha: 1 }
    });

    const normalizedUploadWidth = targetWidth;
    const normalizedUploadHeight = targetHeight;
    let finalWidth = normalizedUploadWidth;
    let finalHeight = normalizedUploadHeight;

    if (targetWidth > RECEIPT_HEADER_LOGO_MAX_PRINT_CONTENT_WIDTH) {
        finalWidth = RECEIPT_HEADER_LOGO_MAX_PRINT_CONTENT_WIDTH;
        finalHeight = Math.max(
            1,
            Math.round(normalizedUploadHeight * (finalWidth / normalizedUploadWidth))
        );
        image = image.resize(finalWidth, finalHeight, {
            fit: "inside",
            withoutEnlargement: true,
            position: "center"
        });
    }

    const pngBuffer = await image
        .greyscale()
        .threshold(180)
        .png()
        .toBuffer();

    return {
        success: true,
        pngBuffer,
        width: finalWidth,
        height: finalHeight
    };
}
