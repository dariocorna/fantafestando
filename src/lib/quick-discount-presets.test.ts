import { describe, expect, it } from "vitest"
import {
    resolveQuickDiscountPresetsFromSettings,
    sanitizeQuickDiscountPresets,
    toLegacyQuickDiscountSettings,
    validateQuickDiscountPresets
} from "./quick-discount-presets"

describe("quick discount presets helpers", () => {
    it("sanitizes and filters invalid presets", () => {
        const result = sanitizeQuickDiscountPresets([
            { label: " Staff ", type: "PERCENT", value: 50 },
            { label: "", type: "PERCENT", value: 20 },
            { label: "Promo", type: "FIXED", value: -1 },
            { label: "Euro", type: "FIXED", value: 2.5 }
        ])

        expect(result).toEqual([
            { label: "Staff", type: "PERCENT", value: 50 },
            { label: "Euro", type: "FIXED", value: 2.5 }
        ])
    })

    it("validates presets in strict mode", () => {
        const result = validateQuickDiscountPresets([
            { label: "Staff", type: "PERCENT", value: 50 },
            { label: "Promo", type: "FIXED", value: 1.5 }
        ])

        expect(result).toEqual({
            success: true,
            presets: [
                { label: "Staff", type: "PERCENT", value: 50 },
                { label: "Promo", type: "FIXED", value: 1.5 }
            ]
        })
    })

    it("returns validation error on invalid value", () => {
        const result = validateQuickDiscountPresets([
            { label: "Staff", type: "PERCENT", value: 150 }
        ])

        expect(result).toEqual({
            success: false,
            error: "Preset #1: valore percentuale non valido (0 < valore <= 100)"
        })
    })

    it("falls back to legacy setting if new array is missing", () => {
        const result = resolveQuickDiscountPresetsFromSettings({
            quickStaffDiscountEnabled: true,
            quickStaffDiscountLabel: "Legacy",
            quickStaffDiscountType: "FIXED",
            quickStaffDiscountValue: 3
        })

        expect(result).toEqual([
            { label: "Legacy", type: "FIXED", value: 3 }
        ])
    })

    it("maps presets to legacy compatibility fields", () => {
        const result = toLegacyQuickDiscountSettings([
            { label: "Staff", type: "PERCENT", value: 50 },
            { label: "Promo", type: "FIXED", value: 2 }
        ])

        expect(result).toEqual({
            quickStaffDiscountEnabled: true,
            quickStaffDiscountLabel: "Staff",
            quickStaffDiscountType: "PERCENT",
            quickStaffDiscountValue: 50
        })
    })
})
