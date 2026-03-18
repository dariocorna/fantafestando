import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
    preparePrintableLogoPngBufferFromUrl,
    resolvePrintableLogoPath,
    resolvePrintableLogoPathFromUrl,
    sanitizeMenuHeaderLogoUrl,
    sanitizePrintableHeaderLogoUrl,
    sanitizeReceiptHeaderLogoUrl
} from "./print-branding";

const testFiles: string[] = [];

afterEach(async () => {
    await Promise.all(testFiles.splice(0).map(async (filePath) => {
        await fs.unlink(filePath).catch(() => undefined);
    }));
});

describe("print-branding", () => {
    it("sanitizes only local png menu header paths", () => {
        expect(sanitizeMenuHeaderLogoUrl("/uploads/menu-headers/header.png")).toBe("/uploads/menu-headers/header.png");
        expect(sanitizeMenuHeaderLogoUrl("/uploads/menu-headers/header.jpg")).toBe("/uploads/menu-headers/header.jpg");
        expect(sanitizeMenuHeaderLogoUrl("https://example.com/logo.png")).toBeUndefined();
        expect(sanitizeMenuHeaderLogoUrl("/uploads/other/logo.png")).toBeUndefined();
    });

    it("sanitizes managed receipt header paths including legacy jpg uploads", () => {
        expect(sanitizeReceiptHeaderLogoUrl("/uploads/receipt-headers/header.png")).toBe("/uploads/receipt-headers/header.png");
        expect(sanitizeReceiptHeaderLogoUrl("/uploads/receipt-headers/header.jpg")).toBe("/uploads/receipt-headers/header.jpg");
        expect(sanitizeReceiptHeaderLogoUrl("/uploads/menu-headers/header.png")).toBeUndefined();
    });

    it("sanitizes printable paths for menu and receipt headers", () => {
        expect(sanitizePrintableHeaderLogoUrl("/uploads/menu-headers/header.png")).toBe("/uploads/menu-headers/header.png");
        expect(sanitizePrintableHeaderLogoUrl("/uploads/receipt-headers/header.png")).toBe("/uploads/receipt-headers/header.png");
        expect(sanitizePrintableHeaderLogoUrl("/uploads/menu-headers/header.jpg")).toBe("/uploads/menu-headers/header.jpg");
    });

    it("resolves a printable absolute path for existing local file", async () => {
        const relativeUrl = `/uploads/menu-headers/test-${Date.now()}.png`;
        const absolutePath = path.join(process.cwd(), "public", relativeUrl.slice(1));
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, "png-data");
        testFiles.push(absolutePath);

        const resolved = resolvePrintableLogoPathFromUrl(relativeUrl);
        expect(resolved).toBe(absolutePath);
    });

    it("blocks traversal and non-existing paths", () => {
        expect(resolvePrintableLogoPathFromUrl("/uploads/menu-headers/../../etc/passwd.png")).toBeUndefined();
        expect(resolvePrintableLogoPathFromUrl("/uploads/menu-headers/not-found.png")).toBeUndefined();
        expect(resolvePrintableLogoPath({ menuHeaderLogoUrl: "/uploads/menu-headers/not-found.png" })).toBeUndefined();
    });

    it("returns undefined when custom logo url is invalid or missing", () => {
        const fallbackFromMissing = resolvePrintableLogoPathFromUrl(undefined);
        const fallbackFromInvalid = resolvePrintableLogoPathFromUrl("https://example.com/logo.png");
        expect(fallbackFromMissing).toBeUndefined();
        expect(fallbackFromInvalid).toBeUndefined();
    });

    it("pads printable logo png buffers to the full paper width for manual centering", async () => {
        const relativeUrl = `/uploads/receipt-headers/test-${Date.now()}.png`;
        const absolutePath = path.join(process.cwd(), "public", relativeUrl.slice(1));
        const pngBuffer = await sharp({
            create: {
                width: 10,
                height: 4,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        }).png().toBuffer();

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, pngBuffer);
        testFiles.push(absolutePath);

        const normalizedBuffer = await preparePrintableLogoPngBufferFromUrl(relativeUrl);
        const metadata = await sharp(normalizedBuffer).metadata();

        expect(normalizedBuffer).toBeDefined();
        expect(metadata.width).toBe(576);
        expect(metadata.height).toBe(4);
    });

    it("downscales oversized receipt headers before padding them to paper width", async () => {
        const relativeUrl = `/uploads/receipt-headers/test-${Date.now()}.png`;
        const absolutePath = path.join(process.cwd(), "public", relativeUrl.slice(1));
        const pngBuffer = await sharp({
            create: {
                width: 920,
                height: 276,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        }).png().toBuffer();

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, pngBuffer);
        testFiles.push(absolutePath);

        const normalizedBuffer = await preparePrintableLogoPngBufferFromUrl(relativeUrl);
        const metadata = await sharp(normalizedBuffer).metadata();

        expect(normalizedBuffer).toBeDefined();
        expect(metadata.width).toBe(576);
        expect(metadata.height).toBe(154);
    });
});
