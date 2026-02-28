import { describe, expect, test } from "vitest";
import { normalizePosCatalogLayout } from "@/lib/pos-catalog-layout";

describe("normalizePosCatalogLayout", () => {
    test("returns MODERN_TABS for modern layout", () => {
        expect(normalizePosCatalogLayout("MODERN_TABS")).toBe("MODERN_TABS");
    });

    test("returns COMPACT_COLUMNS for compact layout", () => {
        expect(normalizePosCatalogLayout("COMPACT_COLUMNS")).toBe("COMPACT_COLUMNS");
    });

    test("falls back to COMPACT_COLUMNS for invalid values", () => {
        expect(normalizePosCatalogLayout("UNKNOWN")).toBe("COMPACT_COLUMNS");
        expect(normalizePosCatalogLayout(null)).toBe("COMPACT_COLUMNS");
        expect(normalizePosCatalogLayout(undefined)).toBe("COMPACT_COLUMNS");
    });
});
