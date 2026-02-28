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
