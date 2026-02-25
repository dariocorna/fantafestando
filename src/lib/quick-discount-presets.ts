export type QuickDiscountType = "PERCENT" | "FIXED"

export interface QuickDiscountPreset {
    label: string
    type: QuickDiscountType
    value: number
}

export const MAX_QUICK_DISCOUNT_PRESETS = 8

interface QuickDiscountSettingsLike {
    quickDiscountPresets?: unknown
    quickStaffDiscountEnabled?: boolean
    quickStaffDiscountLabel?: string
    quickStaffDiscountType?: string
    quickStaffDiscountValue?: number
}

function normalizePresetType(rawValue: unknown): QuickDiscountType | null {
    const normalized = typeof rawValue === "string" ? rawValue.trim().toUpperCase() : ""
    if (normalized === "PERCENT" || normalized === "FIXED") return normalized
    return null
}

function normalizePresetValue(rawValue: unknown, type: QuickDiscountType): number | null {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return null
    const normalized = Number(parsed.toFixed(2))
    if (type === "PERCENT") {
        if (normalized <= 0 || normalized > 100) return null
        return normalized
    }
    if (normalized <= 0) return null
    return normalized
}

export function sanitizeQuickDiscountPresets(input: unknown, maxPresets = MAX_QUICK_DISCOUNT_PRESETS): QuickDiscountPreset[] {
    if (!Array.isArray(input)) return []

    const normalized: QuickDiscountPreset[] = []
    for (const rawPreset of input) {
        if (!rawPreset || typeof rawPreset !== "object") continue

        const preset = rawPreset as { label?: unknown, type?: unknown, value?: unknown }
        const label = typeof preset.label === "string" ? preset.label.trim() : ""
        const type = normalizePresetType(preset.type)
        if (!label || !type) continue

        const value = normalizePresetValue(preset.value, type)
        if (value === null) continue

        normalized.push({ label, type, value })
        if (normalized.length >= maxPresets) break
    }

    return normalized
}

export function validateQuickDiscountPresets(input: unknown, maxPresets = MAX_QUICK_DISCOUNT_PRESETS): { success: true, presets: QuickDiscountPreset[] } | { success: false, error: string } {
    if (!Array.isArray(input)) {
        return { success: false, error: "Formato preset sconti non valido" }
    }

    if (input.length > maxPresets) {
        return { success: false, error: `Puoi configurare al massimo ${maxPresets} preset sconto rapido` }
    }

    const normalized: QuickDiscountPreset[] = []
    for (let index = 0; index < input.length; index += 1) {
        const rawPreset = input[index]
        if (!rawPreset || typeof rawPreset !== "object") {
            return { success: false, error: `Preset #${index + 1}: formato non valido` }
        }

        const preset = rawPreset as { label?: unknown, type?: unknown, value?: unknown }
        const label = typeof preset.label === "string" ? preset.label.trim() : ""
        if (!label) {
            return { success: false, error: `Preset #${index + 1}: etichetta obbligatoria` }
        }

        const type = normalizePresetType(preset.type)
        if (!type) {
            return { success: false, error: `Preset #${index + 1}: tipo non valido` }
        }

        const value = normalizePresetValue(preset.value, type)
        if (value === null) {
            if (type === "PERCENT") {
                return { success: false, error: `Preset #${index + 1}: valore percentuale non valido (0 < valore <= 100)` }
            }
            return { success: false, error: `Preset #${index + 1}: valore fisso non valido (deve essere > 0)` }
        }

        normalized.push({ label, type, value })
    }

    return { success: true, presets: normalized }
}

export function resolveQuickDiscountPresetsFromSettings(settings?: QuickDiscountSettingsLike | null): QuickDiscountPreset[] {
    const normalizedPresets = sanitizeQuickDiscountPresets(settings?.quickDiscountPresets)
    if (normalizedPresets.length > 0) return normalizedPresets

    const legacyEnabled = Boolean(settings?.quickStaffDiscountEnabled)
    if (!legacyEnabled) return []

    const type = normalizePresetType(settings?.quickStaffDiscountType) || "PERCENT"
    const value = normalizePresetValue(settings?.quickStaffDiscountValue, type)
    if (value === null) return []

    const label = (settings?.quickStaffDiscountLabel || "Staff").trim() || "Staff"
    return [{ label, type, value }]
}

export function toLegacyQuickDiscountSettings(presets: QuickDiscountPreset[]): {
    quickStaffDiscountEnabled: boolean
    quickStaffDiscountLabel: string
    quickStaffDiscountType: QuickDiscountType
    quickStaffDiscountValue: number
} {
    if (!Array.isArray(presets) || presets.length === 0) {
        return {
            quickStaffDiscountEnabled: false,
            quickStaffDiscountLabel: "Staff",
            quickStaffDiscountType: "PERCENT",
            quickStaffDiscountValue: 50
        }
    }

    const firstPreset = presets[0]
    return {
        quickStaffDiscountEnabled: true,
        quickStaffDiscountLabel: firstPreset.label,
        quickStaffDiscountType: firstPreset.type,
        quickStaffDiscountValue: firstPreset.value
    }
}
