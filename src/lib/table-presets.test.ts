import { describe, expect, it } from "vitest"
import {
    countDistinctPredefinedTables,
    formatPredefinedTablesForTextarea,
    isTableValueValid,
    normalizeTableValue,
    parsePredefinedTablesInput
} from "./table-presets"

describe("table-presets helpers", () => {
    it("normalizes table value trimming extra spaces", () => {
        expect(normalizeTableValue("  VIP   ESTERNO  ")).toBe("VIP ESTERNO")
        expect(normalizeTableValue("")).toBe("")
    })

    it("validates non-empty table values", () => {
        expect(isTableValueValid("A01")).toBe(true)
        expect(isTableValueValid("   ")).toBe(false)
        expect(isTableValueValid(undefined)).toBe(false)
    })

    it("parses textarea input with split, trim and case-insensitive dedupe", () => {
        expect(parsePredefinedTablesInput("A01\n B02 , vip \nVIP\n")).toEqual(["A01", "B02", "vip"])
    })

    it("counts distinct table values using case-insensitive dedupe", () => {
        expect(countDistinctPredefinedTables("A01\n B02 , vip \nVIP\n")).toBe(3)
    })

    it("formats predefined tables into normalized textarea content", () => {
        expect(
            formatPredefinedTablesForTextarea([
                ...Array.from({ length: 151 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`)
            ])
        ).toContain("T151")
        expect(formatPredefinedTablesForTextarea([" A01 ", "B02", "a01", ""])).toBe("A01\nB02")
        expect(formatPredefinedTablesForTextarea(null)).toBe("")
    })
})
