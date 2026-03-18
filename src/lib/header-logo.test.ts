import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
    MENU_HEADER_LOGO_TARGET_RATIO,
    normalizeMenuHeaderLogoUpload,
    normalizeReceiptHeaderLogoUpload,
    RECEIPT_HEADER_LOGO_TARGET_RATIO
} from "./header-logo";

async function createPng(width: number, height: number) {
    return await sharp({
        create: {
            width,
            height,
            channels: 4,
            background: { r: 20, g: 30, b: 40, alpha: 1 }
        }
    }).png().toBuffer();
}

async function createJpeg(width: number, height: number) {
    return await sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 240, g: 245, b: 250 }
        }
    }).jpeg().toBuffer();
}

describe("header-logo", () => {
    it("normalizes a valid menu logo png and keeps it printable as png", async () => {
        const source = await createPng(1000, 400);

        const result = await normalizeMenuHeaderLogoUpload(source, "image/png");
        expect(result.success).toBe(true);

        if (!result.success) {
            return;
        }

        const metadata = await sharp(result.pngBuffer).metadata();
        expect(metadata.format).toBe("png");
        expect(metadata.width).toBe(1000);
        expect(metadata.height).toBe(400);
        expect((metadata.width || 0) / (metadata.height || 1)).toBeCloseTo(MENU_HEADER_LOGO_TARGET_RATIO, 3);
    });

    it("accepts a valid menu logo jpeg and converts it to png", async () => {
        const source = await createJpeg(500, 200);

        const result = await normalizeMenuHeaderLogoUpload(source, "image/jpeg");
        expect(result.success).toBe(true);

        if (!result.success) {
            return;
        }

        const metadata = await sharp(result.pngBuffer).metadata();
        expect(metadata.format).toBe("png");
        expect(metadata.width).toBe(500);
        expect(metadata.height).toBe(200);
    });

    it("rejects menu logos with an invalid aspect ratio", async () => {
        const source = await createPng(600, 600);

        const result = await normalizeMenuHeaderLogoUpload(source, "image/png");
        expect(result).toEqual({
            success: false,
            error: "Rapporto logo non valido: richiesto 10:4 (tolleranza ±12%)."
        });
    });

    it("adapts a receipt header to the 10:3 printable ratio and outputs png", async () => {
        const source = await createJpeg(300, 300);

        const result = await normalizeReceiptHeaderLogoUpload(source, "image/jpeg");
        expect(result.success).toBe(true);

        if (!result.success) {
            return;
        }

        const metadata = await sharp(result.pngBuffer).metadata();
        expect(metadata.format).toBe("png");
        expect((metadata.width || 0) / (metadata.height || 1)).toBeCloseTo(RECEIPT_HEADER_LOGO_TARGET_RATIO, 3);
    });

    it("rejects corrupted receipt header payloads", async () => {
        const result = await normalizeReceiptHeaderLogoUpload(Buffer.from("not-an-image"), "image/png");
        expect(result).toEqual({
            success: false,
            error: "Immagine header scontrino non valida o corrotta."
        });
    });
});
