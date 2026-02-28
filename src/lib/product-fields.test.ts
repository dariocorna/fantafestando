import {
    MAX_PRODUCT_SHORT_NAME_LENGTH,
    normalizeProductDescription,
    normalizeProductShortName,
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
});
