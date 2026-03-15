export type EasterEggAspectRatio = "PORTRAIT_3_4" | "SQUARE_1_1" | "THERMAL_58";

export interface EasterEggCrop {
    centerX: number;
    centerY: number;
    zoom: number;
    aspectRatio: EasterEggAspectRatio;
}

export interface EasterEggProcessingSettings {
    autoEnhance: boolean;
    brightnessBoost: number;
    thresholdBase: number;
}

const ASPECT_RATIO_VALUES: Record<EasterEggAspectRatio, number> = {
    PORTRAIT_3_4: 3 / 4,
    SQUARE_1_1: 1,
    THERMAL_58: 384 / 560
};

const DEFAULT_PROCESSING: EasterEggProcessingSettings = {
    autoEnhance: true,
    brightnessBoost: 20,
    thresholdBase: 130
};

const THERMAL_PAPER_WIDTH = 576;
// Many 80mm ESC/POS printers expose a printable area narrower than the paper width.
// Keep the photo payload on an even byte boundary and center it by padding the
// final bitmap instead of relying on ESC/POS alignment commands.
const THERMAL_CONTENT_WIDTH = 512;

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

export function getEasterEggAspectRatioValue(value: EasterEggAspectRatio): number {
    return ASPECT_RATIO_VALUES[value];
}

export function getThermalPaperWidth(): number {
    return THERMAL_PAPER_WIDTH;
}

export function getThermalContentWidth(): number {
    return THERMAL_CONTENT_WIDTH;
}

export function getThermalSideMarginWidth(): number {
    return Math.max(0, Math.floor((THERMAL_PAPER_WIDTH - THERMAL_CONTENT_WIDTH) / 2));
}

export function normalizeEasterEggCrop(value: Partial<EasterEggCrop> | null | undefined): EasterEggCrop {
    const aspectRatio = value?.aspectRatio;
    return {
        centerX: clamp(Number(value?.centerX ?? 50), 0, 100),
        centerY: clamp(Number(value?.centerY ?? 50), 0, 100),
        zoom: clamp(Number(value?.zoom ?? 1.6), 1, 4),
        aspectRatio: aspectRatio === "SQUARE_1_1" || aspectRatio === "THERMAL_58" || aspectRatio === "PORTRAIT_3_4"
            ? aspectRatio
            : "PORTRAIT_3_4"
    };
}

export function normalizeEasterEggProcessingSettings(
    value: Partial<EasterEggProcessingSettings> | null | undefined
): EasterEggProcessingSettings {
    return {
        autoEnhance: typeof value?.autoEnhance === "boolean" ? value.autoEnhance : DEFAULT_PROCESSING.autoEnhance,
        brightnessBoost: clamp(Number(value?.brightnessBoost ?? DEFAULT_PROCESSING.brightnessBoost), 0, 80),
        thresholdBase: clamp(Number(value?.thresholdBase ?? DEFAULT_PROCESSING.thresholdBase), 80, 220)
    };
}
