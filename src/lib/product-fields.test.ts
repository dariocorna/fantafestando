import { describe, expect, test } from "vitest";
import {
    MAX_PRODUCT_SHORT_NAME_LENGTH,
    normalizeProductDescription,
    normalizeProductShortName,
    matchesProductSearch,
    normalizeProductSearchText,
    validateProductShortName
} from "@/lib/product-fields";

describe("product-fields", () => {
    test("normalizeProductShortName trims and converts empty values to undefined", () => {
        expect(normalizeProductShortName("  Birra  ")).toBe("Birra");
        expect(normalizeProductShortName("   ")).toBeUndefined();
        expect(normalizeProductShortName(null)).toBeUndefined();
    });

    test("normalizeProductDescription trims and converts empty values to undefined", () => {
        expect(normalizeProductDescription("  Descrizione test  ")).toBe("Descrizione test");
        expect(normalizeProductDescription("")).toBeUndefined();
        expect(normalizeProductDescription(undefined)).toBeUndefined();
    });

    test("validateProductShortName enforces max length", () => {
        expect(validateProductShortName("Nome Breve")).toBeNull();
        expect(validateProductShortName("x".repeat(MAX_PRODUCT_SHORT_NAME_LENGTH + 1))).toContain("massimo");
    });

    test("normalizes accents, casing and decimal separators", () => {
        expect(normalizeProductSearchText("  Caffè, 1,50  ")).toBe("caffe. 1.50");
    });

    test("matches every search term across nested product fields", () => {
        const values = [
            "Caffè corretto",
            "Bar",
            { variants: [{ optionName: "Grande", priceVariation: 1.5 }] },
            ["POS", "MENU"]
        ];

        expect(matchesProductSearch(values, "CAFFE grande 1,5 pos")).toBe(true);
        expect(matchesProductSearch(values, "caffe piccolo")).toBe(false);
        expect(matchesProductSearch(values, "   ")).toBe(true);
    });
});
