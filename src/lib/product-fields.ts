export const MAX_PRODUCT_SHORT_NAME_LENGTH = 24;

function normalizeOptionalText(rawValue: unknown): string | undefined {
    if (typeof rawValue !== "string") return undefined;
    const trimmedValue = rawValue.trim();
    return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export function normalizeProductDescription(rawDescription: unknown): string | undefined {
    return normalizeOptionalText(rawDescription);
}

export function normalizeProductShortName(rawShortName: unknown): string | undefined {
    return normalizeOptionalText(rawShortName);
}

export function validateProductShortName(shortName: string | undefined): string | null {
    if (!shortName) return null;
    if (shortName.length > MAX_PRODUCT_SHORT_NAME_LENGTH) {
        return `Il nome breve può contenere al massimo ${MAX_PRODUCT_SHORT_NAME_LENGTH} caratteri`;
    }
    return null;
}

export function normalizeProductSearchText(value: unknown): string {
    const serialized = typeof value === "string" ? value : JSON.stringify(value ?? "");
    return serialized
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("it")
        .replace(/,/g, ".")
        .replace(/\s+/g, " ")
        .trim();
}

export function matchesProductSearch(values: unknown[], query: string): boolean {
    const terms = normalizeProductSearchText(query).split(" ").filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = normalizeProductSearchText(values);
    return terms.every((term) => haystack.includes(term));
}
