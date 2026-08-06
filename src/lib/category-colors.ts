type ColorOption = {
    value: string;
    label: string;
};

export const CATEGORY_COLOR_OPTIONS: ColorOption[] = [
    { value: "#93c5fd", label: "Blu" },
    { value: "#fca5a5", label: "Rosso" },
    { value: "#fdba74", label: "Arancione" },
    { value: "#fde047", label: "Giallo" },
    { value: "#86efac", label: "Verde" },
    { value: "#5eead4", label: "Turchese" },
    { value: "#67e8f9", label: "Ciano" },
    { value: "#c4b5fd", label: "Viola" },
    { value: "#f9a8d4", label: "Rosa" },
    { value: "#cbd5e1", label: "Ardesia" },
    { value: "#ffffff", label: "Bianco" }
];

export const DEFAULT_CATEGORY_COLOR = CATEGORY_COLOR_OPTIONS[0].value;

const LEGACY_TAILWIND_COLOR_MAP: Record<string, string> = {
    "bg-blue-500": "#3b82f6",
    "bg-red-500": "#ef4444",
    "bg-orange-500": "#f97316",
    "bg-yellow-500": "#eab308",
    "bg-green-500": "#22c55e",
    "bg-teal-500": "#14b8a6",
    "bg-cyan-500": "#06b6d4",
    "bg-purple-500": "#8b5cf6",
    "bg-pink-500": "#ec4899",
    "bg-slate-500": "#64748b"
};

const ALLOWED_COLORS = new Set(CATEGORY_COLOR_OPTIONS.map((option) => option.value));

function normalizeHexColor(value: string): string {
    const normalized = value.toLowerCase();
    if (/^#[\da-f]{6}$/.test(normalized)) {
        return normalized;
    }
    if (/^#[\da-f]{3}$/.test(normalized)) {
        const r = normalized[1];
        const g = normalized[2];
        const b = normalized[3];
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    return DEFAULT_CATEGORY_COLOR;
}

function hexToRgb(value: string): { r: number; g: number; b: number } {
    const normalized = normalizeHexColor(value);
    const numericValue = normalized.replace("#", "");

    return {
        r: Number.parseInt(numericValue.slice(0, 2), 16),
        g: Number.parseInt(numericValue.slice(2, 4), 16),
        b: Number.parseInt(numericValue.slice(4, 6), 16)
    };
}

export function normalizeCategoryColor(value?: string | null): string {
    if (!value) return DEFAULT_CATEGORY_COLOR;

    const normalized = value.trim().toLowerCase();
    if (!normalized) return DEFAULT_CATEGORY_COLOR;

    if (ALLOWED_COLORS.has(normalized)) {
        return normalized;
    }

    if (LEGACY_TAILWIND_COLOR_MAP[normalized]) {
        return LEGACY_TAILWIND_COLOR_MAP[normalized];
    }

    if (/^#[\da-f]{3}$/.test(normalized) || /^#[\da-f]{6}$/.test(normalized)) {
        return normalizeHexColor(normalized);
    }

    return DEFAULT_CATEGORY_COLOR;
}

export function categoryColorWithAlpha(value: string | undefined, alpha: number): string {
    const rgb = hexToRgb(normalizeCategoryColor(value));
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function getCategoryTextColor(value?: string): string {
    const rgb = hexToRgb(normalizeCategoryColor(value));
    const brightness = ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
    return brightness > 160 ? "#0f172a" : "#ffffff";
}

export function getCategoryTheme(value?: string) {
    const base = normalizeCategoryColor(value);
    return {
        base,
        onBase: getCategoryTextColor(base),
        softBg: categoryColorWithAlpha(base, 0.14),
        border: categoryColorWithAlpha(base, 0.36),
        shadow: categoryColorWithAlpha(base, 0.28)
    };
}
