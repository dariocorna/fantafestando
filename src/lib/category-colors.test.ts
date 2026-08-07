import { describe, expect, test } from "vitest";
import {
    CATEGORY_COLOR_OPTIONS,
    getCategoryTextColor,
    normalizeCategoryColor
} from "@/lib/category-colors";

function relativeLuminance(hex: string): number {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [r, g, b] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function contrastRatio(first: string, second: string): number {
    const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
    const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
    return (lighter + 0.05) / (darker + 0.05);
}

describe("category-colors", () => {
    test("offers white and readable presets against the dark label color", () => {
        expect(CATEGORY_COLOR_OPTIONS.some((option) => option.value === "#ffffff")).toBe(true);
        for (const option of CATEGORY_COLOR_OPTIONS) {
            expect(getCategoryTextColor(option.value)).toBe("#0f172a");
            expect(contrastRatio(option.value, "#0f172a")).toBeGreaterThanOrEqual(4.5);
        }
    });

    test("keeps valid custom and legacy colors", () => {
        expect(normalizeCategoryColor("#123abc")).toBe("#123abc");
        expect(normalizeCategoryColor("bg-blue-500")).toBe("#3b82f6");
    });
});
