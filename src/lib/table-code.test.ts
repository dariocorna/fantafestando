import { describe, expect, it } from "vitest"
import {
    buildTableCode,
    isValidTableCode,
    normalizeTableCode,
    parseTableCode,
    sanitizeTableDigits,
    sanitizeTableLetter
} from "./table-code"

describe("table-code helpers", () => {
    it("normalizes letter and digits to A-F + 2 digits", () => {
        expect(normalizeTableCode(" b07 ")).toBe("B07")
        expect(normalizeTableCode("A123")).toBe("A12")
        expect(normalizeTableCode("1a2")).toBe("A12")
    })

    it("extracts only allowed letter and numeric digits", () => {
        expect(sanitizeTableLetter("xC9")).toBe("C")
        expect(sanitizeTableLetter("Z9")).toBe("")
        expect(sanitizeTableDigits("ab129")).toBe("12")
    })

    it("builds and parses table code parts", () => {
        expect(buildTableCode("f", "09")).toBe("F09")
        expect(parseTableCode("f09")).toEqual({ letter: "F", digits: "09", code: "F09" })
        expect(parseTableCode("12")).toEqual({ letter: "", digits: "12", code: "12" })
    })

    it("validates strict table code pattern", () => {
        expect(isValidTableCode("A12")).toBe(true)
        expect(isValidTableCode("F00")).toBe(true)
        expect(isValidTableCode("12")).toBe(false)
        expect(isValidTableCode("A1")).toBe(false)
        expect(isValidTableCode("G12")).toBe(false)
    })
})
