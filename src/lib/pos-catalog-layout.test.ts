import { describe, expect, test } from "vitest";
import { buildCompactCatalogColumns, normalizePosCatalogLayout } from "@/lib/pos-catalog-layout";

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

describe("buildCompactCatalogColumns", () => {
    test.each([9, 12, 13, 25])("balances %i products across consecutive columns", (count) => {
        const products = Array.from({ length: count }, (_, id) => id);
        const columns = buildCompactCatalogColumns(
            [{ _id: "short" }, { _id: "large" }, { _id: "empty" }],
            { short: [100, 101], large: products },
            true,
        );
        const parts = columns.filter((column) => column.split);
        const lengths = parts.map(({ sections }) => sections[0].products.length);
        expect(Math.max(...lengths)).toBeLessThanOrEqual(6);
        expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1);
        expect(columns.flatMap(({ sections }) => sections.flatMap((section) => section.products)))
            .toEqual([100, 101, ...products]);
        expect(columns.at(-1)?.sections[0].products).toEqual([]);
        expect(new Set(columns.map(({ key }) => key)).size).toBe(columns.length);
    });

    test("preserves short category pairing and unsplit stock lists", () => {
        const categories = [{ _id: "a" }, { _id: "b" }, { _id: "c" }];
        const products = { a: [1], b: [2, 3], c: Array.from({ length: 9 }, (_, index) => index) };
        const columns = buildCompactCatalogColumns(categories, products, false);
        expect(columns.map(({ sections }) => sections.map(({ products }) => products.length))).toEqual([[1, 2], [9]]);
    });
});
