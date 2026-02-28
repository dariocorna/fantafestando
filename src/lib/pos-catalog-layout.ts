export type PosCatalogLayout = "COMPACT_COLUMNS" | "MODERN_TABS";

export function normalizePosCatalogLayout(value: unknown): PosCatalogLayout {
    return value === "MODERN_TABS" ? "MODERN_TABS" : "COMPACT_COLUMNS";
}
