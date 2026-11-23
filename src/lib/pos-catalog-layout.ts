export type PosCatalogLayout = "COMPACT_COLUMNS" | "MODERN_TABS";

export function normalizePosCatalogLayout(value: unknown): PosCatalogLayout {
    return value === "MODERN_TABS" ? "MODERN_TABS" : "COMPACT_COLUMNS";
}

export function buildCompactCatalogColumns<Category extends { _id: string }, Product>(
    categories: Category[],
    productsByCategory: Record<string, Product[]>,
    splitLongCategories: boolean,
) {
    const sections = categories.map((category) => ({
        category,
        products: productsByCategory[category._id] || [],
    }));
    const columns: Array<{ key: string; split?: true; sections: typeof sections }> = [];

    for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index];
        const count = section.products.length;
        const next = sections[index + 1];
        const key = section.category._id;

        if (splitLongCategories && count > 8) {
            const parts = Math.ceil(count / 6);
            for (let part = 0; part < parts; part += 1) {
                const products = section.products.slice(
                    Math.ceil(part * count / parts),
                    Math.ceil((part + 1) * count / parts),
                );
                columns.push({ key: `${key}:${part}`, split: true, sections: [{ ...section, products }] });
            }
        } else if (next && count <= 3 && count + next.products.length <= 8) {
            columns.push({ key, sections: [section, next] });
            index += 1;
        } else {
            columns.push({ key, sections: [section] });
        }
    }

    return columns;
}
