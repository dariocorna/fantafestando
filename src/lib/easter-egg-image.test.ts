import { afterEach, describe, expect, test } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
    getThermalContentWidth,
    getThermalPaperWidth,
    normalizeEasterEggCrop,
    normalizeEasterEggProcessingSettings
} from "@/lib/easter-egg-config";
import {
    preparePrintableEasterEggRasterFromUrl,
    preparePrintableEasterEggPngBufferFromUrl,
    renderThermalRasterToPng,
    renderThermalRasterToStripePngBuffers,
    resolveEasterEggImagePathFromUrl
} from "@/lib/easter-egg-image";

const uploadDir = path.join(process.cwd(), "public", "uploads", "easter-eggs");
const testFilePath = path.join(uploadDir, "vitest-easter-egg.jpg");
const testImageUrl = "/uploads/easter-eggs/vitest-easter-egg.jpg";
const orientedTestFilePath = path.join(uploadDir, "vitest-easter-egg-oriented.jpg");
const orientedTestImageUrl = "/uploads/easter-eggs/vitest-easter-egg-oriented.jpg";

afterEach(async () => {
    await rm(testFilePath, { force: true });
    await rm(orientedTestFilePath, { force: true });
});

describe("easter egg image helpers", () => {
    test("normalizes crop values within valid bounds", () => {
        expect(normalizeEasterEggCrop({
            centerX: -40,
            centerY: 240,
            zoom: 12,
            aspectRatio: "nope" as never
        })).toEqual({
            centerX: 0,
            centerY: 100,
            zoom: 4,
            aspectRatio: "PORTRAIT_3_4"
        });
    });

    test("rejects paths outside managed upload directory", async () => {
        await expect(resolveEasterEggImagePathFromUrl("/uploads/menu-headers/logo.png")).resolves.toBeUndefined();
        await expect(resolveEasterEggImagePathFromUrl("../../etc/passwd")).resolves.toBeUndefined();
    });

    test("normalizes processing values within valid bounds", () => {
        expect(normalizeEasterEggProcessingSettings({
            autoEnhance: false,
            brightnessBoost: 120,
            thresholdBase: 20
        })).toEqual({
            autoEnhance: false,
            brightnessBoost: 80,
            thresholdBase: 80
        });
    });

    test("converts a jpeg into padded printable thermal png", async () => {
        await mkdir(uploadDir, { recursive: true });
        const jpegBuffer = await sharp({
            create: {
                width: 1600,
                height: 1200,
                channels: 3,
                background: { r: 255, g: 220, b: 220 }
            }
        })
            .composite([
                {
                    input: await sharp({
                        create: {
                            width: 520,
                            height: 520,
                            channels: 3,
                            background: { r: 15, g: 15, b: 15 }
                        }
                    }).png().toBuffer(),
                    left: 540,
                    top: 220
                }
            ])
            .jpeg()
            .toBuffer();

        await writeFile(testFilePath, jpegBuffer);

        const printable = await preparePrintableEasterEggPngBufferFromUrl(testImageUrl, {
            centerX: 50,
            centerY: 40,
            zoom: 2.1,
            aspectRatio: "PORTRAIT_3_4"
        });

        expect(printable).toBeDefined();
        const metadata = await sharp(printable!).metadata();
        expect(metadata.format).toBe("png");
        expect(metadata.width).toBe(getThermalPaperWidth());
        expect((metadata.width || 0) % 8).toBe(0);
        expect((metadata.height || 0)).toBeGreaterThan(300);
    });

    test("converts a jpeg into centered thermal raster sized for the full paper width", async () => {
        await mkdir(uploadDir, { recursive: true });
        const jpegBuffer = await sharp({
            create: {
                width: 1400,
                height: 1800,
                channels: 3,
                background: { r: 245, g: 245, b: 245 }
            }
        })
            .composite([
                {
                    input: await sharp({
                        create: {
                            width: 460,
                            height: 900,
                            channels: 3,
                            background: { r: 20, g: 20, b: 20 }
                        }
                    }).png().toBuffer(),
                    left: 470,
                    top: 420
                }
            ])
            .jpeg()
            .toBuffer();

        await writeFile(testFilePath, jpegBuffer);

        const raster = await preparePrintableEasterEggRasterFromUrl(testImageUrl, {
            centerX: 50,
            centerY: 50,
            zoom: 1.4,
            aspectRatio: "PORTRAIT_3_4"
        });

        expect(raster).toBeDefined();
        expect(raster?.width).toBe(getThermalContentWidth());
        expect((raster?.width || 0) % 8).toBe(0);
        expect(raster?.height || 0).toBeGreaterThan(300);
        expect(raster?.data.length).toBe(((raster?.width || 0) / 8) * (raster?.height || 0));
    });

    test("renders the final raster bitmap back to a png preview with the same paper width", async () => {
        await mkdir(uploadDir, { recursive: true });
        const jpegBuffer = await sharp({
            create: {
                width: 1400,
                height: 1800,
                channels: 3,
                background: { r: 245, g: 245, b: 245 }
            }
        })
            .composite([
                {
                    input: await sharp({
                        create: {
                            width: 500,
                            height: 900,
                            channels: 3,
                            background: { r: 20, g: 20, b: 20 }
                        }
                    }).png().toBuffer(),
                    left: 450,
                    top: 380
                }
            ])
            .jpeg()
            .toBuffer();

        await writeFile(testFilePath, jpegBuffer);

        const raster = await preparePrintableEasterEggRasterFromUrl(testImageUrl, {
            centerX: 50,
            centerY: 50,
            zoom: 1.3,
            aspectRatio: "PORTRAIT_3_4"
        });

        expect(raster).toBeDefined();
        const preview = await renderThermalRasterToPng(raster!, { centerOnPaper: true });
        const metadata = await sharp(preview).metadata();
        expect(metadata.format).toBe("png");
        expect(metadata.width).toBe(getThermalPaperWidth());
        expect(metadata.height).toBe(raster?.height);
    });

    test("pads printable stripe png buffers to the full paper width when requested", async () => {
        await mkdir(uploadDir, { recursive: true });
        const jpegBuffer = await sharp({
            create: {
                width: 1000,
                height: 1600,
                channels: 3,
                background: { r: 240, g: 240, b: 240 }
            }
        })
            .composite([
                {
                    input: await sharp({
                        create: {
                            width: 360,
                            height: 980,
                            channels: 3,
                            background: { r: 10, g: 10, b: 10 }
                        }
                    }).png().toBuffer(),
                    left: 320,
                    top: 320
                }
            ])
            .jpeg()
            .toBuffer();

        await writeFile(testFilePath, jpegBuffer);

        const raster = await preparePrintableEasterEggRasterFromUrl(testImageUrl, {
            centerX: 50,
            centerY: 50,
            zoom: 1.3,
            aspectRatio: "PORTRAIT_3_4"
        });

        expect(raster).toBeDefined();
        const [stripe] = await renderThermalRasterToStripePngBuffers(raster!, 4000, { centerOnPaper: true });
        const metadata = await sharp(stripe).metadata();
        expect(metadata.width).toBe(getThermalPaperWidth());
        expect(metadata.height).toBe(raster?.height);
    });

    test("prepares a raster correctly for jpeg images with EXIF rotation from phone cameras", async () => {
        await mkdir(uploadDir, { recursive: true });
        const jpegBuffer = await sharp({
            create: {
                width: 924,
                height: 2000,
                channels: 3,
                background: { r: 240, g: 240, b: 240 }
            }
        })
            .composite([
                {
                    input: await sharp({
                        create: {
                            width: 300,
                            height: 900,
                            channels: 3,
                            background: { r: 20, g: 20, b: 20 }
                        }
                    }).png().toBuffer(),
                    left: 312,
                    top: 600
                }
            ])
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer();

        await writeFile(orientedTestFilePath, jpegBuffer);

        const raster = await preparePrintableEasterEggRasterFromUrl(orientedTestImageUrl, {
            centerX: 60,
            centerY: 50,
            zoom: 1,
            aspectRatio: "THERMAL_58"
        }, {
            autoEnhance: true,
            brightnessBoost: 80,
            thresholdBase: 174
        });

        expect(raster).toBeDefined();
        expect((raster?.width || 0) % 8).toBe(0);
        expect(raster?.height || 0).toBeGreaterThan(300);
    });
});
