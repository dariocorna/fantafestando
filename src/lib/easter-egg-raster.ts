import {
    getEasterEggAspectRatioValue,
    getThermalContentWidth,
    getThermalPaperWidth,
    normalizeEasterEggProcessingSettings,
    type EasterEggCrop,
    type EasterEggProcessingSettings
} from "./easter-egg-config";

export interface ThermalRasterPayload {
    width: number;
    height: number;
    data: Uint8Array;
}

const AUTO_CONTRAST_LOWER_PERCENTILE = 2;
const AUTO_CONTRAST_UPPER_PERCENTILE = 98;
const THERMAL_WINDOW_SIZE = 25;
const THERMAL_THRESHOLD_SCALE = 0.45;
const THERMAL_MIDTONE_DITHER_BAND = 26;
const MAX_THERMAL_RASTER_HEIGHT = 4096;
const THERMAL_SPREAD_COMPENSATION_MATRIX = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
];

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

function percentileFromHistogram(histogram: Uint32Array, percentile: number, total: number): number {
    if (total <= 0) return 0;
    const target = Math.max(0, Math.min(total - 1, Math.floor((percentile / 100) * total)));
    let running = 0;
    for (let value = 0; value < histogram.length; value += 1) {
        running += histogram[value] ?? 0;
        if (running > target) {
            return value;
        }
    }
    return histogram.length - 1;
}

function normalizeGrayPixels(grayPixels: Uint8ClampedArray, enabled: boolean): Uint8ClampedArray {
    if (!enabled || grayPixels.length === 0) {
        return Uint8ClampedArray.from(grayPixels);
    }

    const histogram = new Uint32Array(256);
    for (let index = 0; index < grayPixels.length; index += 1) {
        histogram[grayPixels[index] ?? 0] += 1;
    }

    const lower = percentileFromHistogram(histogram, AUTO_CONTRAST_LOWER_PERCENTILE, grayPixels.length);
    const upper = percentileFromHistogram(histogram, AUTO_CONTRAST_UPPER_PERCENTILE, grayPixels.length);
    if (upper <= lower) {
        return Uint8ClampedArray.from(grayPixels);
    }

    const normalized = new Uint8ClampedArray(grayPixels.length);
    const scale = 255 / (upper - lower);

    for (let index = 0; index < grayPixels.length; index += 1) {
        const raw = grayPixels[index] ?? 0;
        normalized[index] = clamp(Math.round((raw - lower) * scale), 0, 255);
    }

    return normalized;
}

function blurGrayPixels(grayPixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
    if (grayPixels.length === 0) {
        return new Uint8ClampedArray();
    }

    const blurred = new Uint8ClampedArray(grayPixels.length);
    const kernel = [
        [1, 2, 1],
        [2, 4, 2],
        [1, 2, 1]
    ];

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let weightedSum = 0;
            let totalWeight = 0;

            for (let ky = -1; ky <= 1; ky += 1) {
                const sampleY = clamp(y + ky, 0, height - 1);
                for (let kx = -1; kx <= 1; kx += 1) {
                    const sampleX = clamp(x + kx, 0, width - 1);
                    const weight = kernel[ky + 1][kx + 1];
                    weightedSum += (grayPixels[(sampleY * width) + sampleX] ?? 0) * weight;
                    totalWeight += weight;
                }
            }

            blurred[(y * width) + x] = clamp(Math.round(weightedSum / Math.max(1, totalWeight)), 0, 255);
        }
    }

    return blurred;
}

function buildIntegralImage(grayPixels: Uint8ClampedArray, width: number, height: number): Uint32Array {
    const stride = width + 1;
    const integral = new Uint32Array((height + 1) * stride);

    for (let y = 1; y <= height; y += 1) {
        let rowSum = 0;
        for (let x = 1; x <= width; x += 1) {
            rowSum += grayPixels[((y - 1) * width) + (x - 1)] ?? 0;
            integral[(y * stride) + x] = integral[((y - 1) * stride) + x] + rowSum;
        }
    }

    return integral;
}

function getAreaMean(integral: Uint32Array, width: number, left: number, top: number, right: number, bottom: number): number {
    const stride = width + 1;
    const sum =
        integral[(bottom * stride) + right]
        - integral[(top * stride) + right]
        - integral[(bottom * stride) + left]
        + integral[(top * stride) + left];
    const area = Math.max(1, (right - left) * (bottom - top));
    return sum / area;
}

function applyThermalSpreadCompensation(binaryPixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
    const compensated = Uint8ClampedArray.from(binaryPixels);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width) + x;
            if ((binaryPixels[index] ?? 255) !== 0) continue;

            let blackNeighbors = 0;
            for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
                for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
                    if (nx === x && ny === y) continue;
                    if ((binaryPixels[(ny * width) + nx] ?? 255) === 0) {
                        blackNeighbors += 1;
                    }
                }
            }

            const matrixValue = THERMAL_SPREAD_COMPENSATION_MATRIX[y % 4]?.[x % 4] ?? 0;
            if (blackNeighbors >= 8 && matrixValue === 0) {
                compensated[index] = 255;
            }
        }
    }

    return compensated;
}

function packBinaryPixels(binaryPixels: Uint8ClampedArray, width: number, height: number): ThermalRasterPayload {
    const paddedWidth = Math.ceil(width / 8) * 8;
    const widthBytes = paddedWidth / 8;
    const data = new Uint8Array(widthBytes * height);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if ((binaryPixels[(y * width) + x] ?? 255) === 0) {
                data[(y * widthBytes) + Math.floor(x / 8)] |= 0x80 >> (x % 8);
            }
        }
    }

    return {
        width: paddedWidth,
        height,
        data
    };
}

export function getThermalTargetHeight(targetWidth = getThermalContentWidth()): number {
    const thermalAspectRatio = getEasterEggAspectRatioValue("THERMAL_58");
    return Math.max(1, Math.round(targetWidth / thermalAspectRatio));
}

export function computeSourceCropRect(
    sourceWidth: number,
    sourceHeight: number,
    cropInput: Partial<EasterEggCrop>
) {
    const crop = {
        centerX: clamp(Number(cropInput.centerX ?? 50), 0, 100),
        centerY: clamp(Number(cropInput.centerY ?? 50), 0, 100),
        zoom: clamp(Number(cropInput.zoom ?? 1.6), 1, 4),
        aspectRatio: cropInput.aspectRatio ?? "THERMAL_58"
    } satisfies EasterEggCrop;
    const aspectRatio = getEasterEggAspectRatioValue(crop.aspectRatio);
    const sourceRatio = sourceWidth / sourceHeight;

    let cropWidth: number;
    let cropHeight: number;
    if (sourceRatio > aspectRatio) {
        cropHeight = sourceHeight / crop.zoom;
        cropWidth = cropHeight * aspectRatio;
    } else {
        cropWidth = sourceWidth / crop.zoom;
        cropHeight = cropWidth / aspectRatio;
    }

    cropWidth = Math.max(1, Math.min(sourceWidth, Math.round(cropWidth)));
    cropHeight = Math.max(1, Math.min(sourceHeight, Math.round(cropHeight)));

    const centerX = Math.round((crop.centerX / 100) * sourceWidth);
    const centerY = Math.round((crop.centerY / 100) * sourceHeight);
    const maxLeft = Math.max(0, sourceWidth - cropWidth);
    const maxTop = Math.max(0, sourceHeight - cropHeight);

    return {
        left: clamp(Math.round(centerX - (cropWidth / 2)), 0, maxLeft),
        top: clamp(Math.round(centerY - (cropHeight / 2)), 0, maxTop),
        width: cropWidth,
        height: cropHeight
    };
}

export function buildGrayPixelsFromRgba(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
    const grayPixels = new Uint8ClampedArray(width * height);
    for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        const red = rgba[offset] ?? 255;
        const green = rgba[offset + 1] ?? 255;
        const blue = rgba[offset + 2] ?? 255;
        grayPixels[index] = clamp(
            Math.round((0.299 * red) + (0.587 * green) + (0.114 * blue)),
            0,
            255
        );
    }
    return grayPixels;
}

export function buildThermalRasterFromRgba(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    processingInput?: Partial<EasterEggProcessingSettings> | null
): ThermalRasterPayload {
    const processing = normalizeEasterEggProcessingSettings(processingInput);
    const normalizedGrayPixels = normalizeGrayPixels(
        buildGrayPixelsFromRgba(rgba, width, height),
        processing.autoEnhance
    );
    const smoothedGrayPixels = blurGrayPixels(normalizedGrayPixels, width, height);
    const integral = buildIntegralImage(smoothedGrayPixels, width, height);
    const binaryPixels = new Uint8ClampedArray(width * height);
    const halfWindow = Math.floor(THERMAL_WINDOW_SIZE / 2);
    const thresholdBias = (processing.thresholdBase - 128) * THERMAL_THRESHOLD_SCALE;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const left = Math.max(0, x - halfWindow);
            const top = Math.max(0, y - halfWindow);
            const right = Math.min(width, x + halfWindow + 1);
            const bottom = Math.min(height, y + halfWindow + 1);
            const localMean = getAreaMean(integral, width, left, top, right, bottom);
            const lifted = clamp((smoothedGrayPixels[(y * width) + x] ?? 255) + processing.brightnessBoost, 0, 255);
            const adaptiveDelta = lifted - (localMean + thresholdBias);

            if (adaptiveDelta <= -THERMAL_MIDTONE_DITHER_BAND) {
                binaryPixels[(y * width) + x] = 0;
                continue;
            }
            if (adaptiveDelta >= THERMAL_MIDTONE_DITHER_BAND) {
                binaryPixels[(y * width) + x] = 255;
                continue;
            }

            const ditherTone = clamp(
                Math.round(((adaptiveDelta + THERMAL_MIDTONE_DITHER_BAND) / (THERMAL_MIDTONE_DITHER_BAND * 2)) * 255),
                0,
                255
            );
            const matrixValue = THERMAL_SPREAD_COMPENSATION_MATRIX[y % 4]?.[x % 4] ?? 0;
            const ditherThreshold = Math.round(((matrixValue + 0.5) / 16) * 255);
            binaryPixels[(y * width) + x] = ditherTone > ditherThreshold ? 255 : 0;
        }
    }

    return packBinaryPixels(
        applyThermalSpreadCompensation(binaryPixels, width, height),
        width,
        height
    );
}

export function unpackThermalRasterToPixels(raster: ThermalRasterPayload): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(raster.width * raster.height);
    const widthBytes = Math.ceil(raster.width / 8);

    for (let y = 0; y < raster.height; y += 1) {
        for (let x = 0; x < raster.width; x += 1) {
            const byte = raster.data[(y * widthBytes) + Math.floor(x / 8)] ?? 0;
            const isBlack = (byte & (0x80 >> (x % 8))) !== 0;
            pixels[(y * raster.width) + x] = isBlack ? 0 : 255;
        }
    }

    return pixels;
}

export function validateThermalRasterPayload(width: number, height: number, dataLength: number): string | null {
    if (!Number.isInteger(width) || width <= 0) {
        return "Larghezza raster non valida";
    }
    if (!Number.isInteger(height) || height <= 0) {
        return "Altezza raster non valida";
    }
    if (height > MAX_THERMAL_RASTER_HEIGHT) {
        return "Altezza raster fuori specifica";
    }
    if (width > getThermalPaperWidth()) {
        return "Larghezza raster fuori specifica";
    }

    const paddedWidth = Math.ceil(width / 8) * 8;
    const expectedLength = (paddedWidth / 8) * height;
    if (dataLength !== expectedLength) {
        return "Dimensione binario raster non coerente";
    }

    return null;
}
