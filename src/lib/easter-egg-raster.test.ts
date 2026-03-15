import { describe, expect, test } from "vitest";
import { getThermalContentWidth, getThermalPaperWidth } from "@/lib/easter-egg-config";
import {
    buildThermalRasterFromRgba,
    unpackThermalRasterToPixels,
    validateThermalRasterPayload
} from "@/lib/easter-egg-raster";

function createGradientRgba(width: number, height: number) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = ((y * width) + x) * 4;
            const shade = Math.round(((x / Math.max(1, width - 1)) * 180) + ((y / Math.max(1, height - 1)) * 60));
            rgba[offset] = shade;
            rgba[offset + 1] = shade;
            rgba[offset + 2] = shade;
            rgba[offset + 3] = 255;
        }
    }
    return rgba;
}

function createUniformRgba(width: number, height: number, shade: number) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        rgba[offset] = shade;
        rgba[offset + 1] = shade;
        rgba[offset + 2] = shade;
        rgba[offset + 3] = 255;
    }
    return rgba;
}

describe("easter-egg-raster", () => {
    test("builds a packed raster and can unpack it back to monochrome pixels", () => {
        const raster = buildThermalRasterFromRgba(createGradientRgba(64, 96), 64, 96, {
            autoEnhance: true,
            brightnessBoost: 20,
            thresholdBase: 128
        });

        expect(raster.width).toBe(64);
        expect(raster.height).toBe(96);
        expect(raster.data).toHaveLength((64 / 8) * 96);

        const pixels = unpackThermalRasterToPixels(raster);
        expect(pixels).toHaveLength(64 * 96);
        const blackPixels = Array.from(pixels).filter((value) => value === 0).length;
        const whitePixels = Array.from(pixels).filter((value) => value === 255).length;
        expect(blackPixels).toBeGreaterThan(0);
        expect(whitePixels).toBeGreaterThan(0);
    });

    test("validates raster payload dimensions against packed 1bpp size", () => {
        const rasterWidth = getThermalContentWidth();
        expect(validateThermalRasterPayload(rasterWidth, 700, (rasterWidth / 8) * 700)).toBeNull();
        expect(validateThermalRasterPayload(481, 700, ((Math.ceil(481 / 8) * 700) - 1))).toBe("Dimensione binario raster non coerente");
        expect(validateThermalRasterPayload(getThermalPaperWidth() + 64, 10, 800)).toBe("Larghezza raster fuori specifica");
        expect(validateThermalRasterPayload(rasterWidth, 5000, (rasterWidth / 8) * 5000)).toBe("Altezza raster fuori specifica");
    });

    test("keeps some tonal texture on flat midtones instead of collapsing to pure white or black", () => {
        const raster = buildThermalRasterFromRgba(createUniformRgba(64, 64, 128), 64, 64, {
            autoEnhance: false,
            brightnessBoost: 0,
            thresholdBase: 128
        });

        const pixels = unpackThermalRasterToPixels(raster);
        const blackPixels = Array.from(pixels).filter((value) => value === 0).length;
        const blackRatio = blackPixels / pixels.length;

        expect(blackRatio).toBeGreaterThan(0.2);
        expect(blackRatio).toBeLessThan(0.8);
    });
});
