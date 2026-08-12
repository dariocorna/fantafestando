import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
    normalizeMenuHeaderLogoUpload,
    normalizeReceiptHeaderLogoUpload
} from "@/lib/header-logo";
import {
    getManagedUploadConfig,
    resolveManagedUploadPath,
    resolveManagedUploadUrl,
    type ManagedUploadKind
} from "@/lib/managed-upload";

const MENU_HEADER_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const RECEIPT_HEADER_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const EASTER_EGG_MAX_BYTES = 12 * 1024 * 1024;

const UPLOAD_IMAGE_ALLOWED_TYPES = new Map<string, string>([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
]);

async function removeManagedUpload(value: unknown, kind: ManagedUploadKind) {
    const upload = resolveManagedUploadUrl(value, [kind]);
    if (!upload) return;
    try {
        await unlink(upload.filePath);
    } catch {
        // Ignore remove errors (file may already be absent).
    }
}

export async function persistMenuHeaderLogo(file: File): Promise<{ url: string } | { error: string }> {
    if (file.size <= 0) {
        return { error: "File logo vuoto." };
    }
    if (file.size > MENU_HEADER_LOGO_MAX_BYTES) {
        return { error: "Logo troppo grande: massimo 2MB." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const normalizedUpload = await normalizeMenuHeaderLogoUpload(buffer, file.type);
    if (!normalizedUpload.success) {
        return { error: normalizedUpload.error };
    }

    try {
        const config = getManagedUploadConfig("menuHeaders");
        await mkdir(config.directoryPath, { recursive: true });
        const upload = resolveManagedUploadPath(
            "menuHeaders",
            `menu-header-${Date.now()}-${randomUUID()}.png`
        );
        if (!upload) return { error: "Impossibile salvare il logo sul server. Controlla i permessi o riprova." };
        await writeFile(upload.filePath, normalizedUpload.pngBuffer);
        return { url: upload.url };
    } catch {
        return { error: "Impossibile salvare il logo sul server. Controlla i permessi o riprova." };
    }
}

export async function persistReceiptHeaderLogo(file: File): Promise<{ url: string } | { error: string }> {
    if (file.size <= 0) {
        return { error: "File header scontrino vuoto." };
    }
    if (file.size > RECEIPT_HEADER_LOGO_MAX_BYTES) {
        return { error: "Header scontrino troppo grande: massimo 2MB." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const normalizedUpload = await normalizeReceiptHeaderLogoUpload(buffer, file.type);
    if (!normalizedUpload.success) {
        return { error: normalizedUpload.error };
    }

    try {
        const config = getManagedUploadConfig("receiptHeaders");
        await mkdir(config.directoryPath, { recursive: true });
        const upload = resolveManagedUploadPath(
            "receiptHeaders",
            `receipt-header-${Date.now()}-${randomUUID()}.png`
        );
        if (!upload) return { error: "Impossibile salvare l'header scontrino sul server. Controlla i permessi o riprova." };
        await writeFile(upload.filePath, normalizedUpload.pngBuffer);
        return { url: upload.url };
    } catch {
        return { error: "Impossibile salvare l'header scontrino sul server. Controlla i permessi o riprova." };
    }
}

export function deleteMenuHeaderLogoIfManaged(url: unknown) {
    return removeManagedUpload(url, "menuHeaders");
}

export function deleteReceiptHeaderLogoIfManaged(url: unknown) {
    return removeManagedUpload(url, "receiptHeaders");
}

export async function persistEasterEggImage(file: File): Promise<{ url: string } | { error: string }> {
    const extension = UPLOAD_IMAGE_ALLOWED_TYPES.get(file.type);
    if (!extension) {
        return { error: "Formato immagine non supportato: usa JPEG o PNG." };
    }
    if (file.size <= 0) {
        return { error: "File immagine vuoto." };
    }
    if (file.size > EASTER_EGG_MAX_BYTES) {
        return { error: "Immagine troppo grande: massimo 12MB." };
    }

    try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const image = sharp(buffer, { failOn: "error" }).rotate();
        const metadata = await image.metadata();
        const width = Number(metadata.width || 0);
        const height = Number(metadata.height || 0);
        if (width < 600 || height < 600) {
            return { error: "Immagine troppo piccola: carica una foto ad alta risoluzione." };
        }

        const config = getManagedUploadConfig("easterEggs");
        await mkdir(config.directoryPath, { recursive: true });
        const upload = resolveManagedUploadPath(
            "easterEggs",
            `portal-easter-egg-${Date.now()}-${randomUUID()}.${extension}`
        );
        if (!upload) return { error: "Impossibile leggere o salvare l'immagine caricata." };
        await writeFile(upload.filePath, buffer);
        return { url: upload.url };
    } catch {
        return { error: "Impossibile leggere o salvare l'immagine caricata." };
    }
}

export function deleteEasterEggImageIfManaged(url: unknown) {
    return removeManagedUpload(url, "easterEggs");
}
