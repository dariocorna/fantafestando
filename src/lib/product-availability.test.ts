import { describe, expect, it } from "vitest"
import {
    formatAvailableDaysLabel,
    getCurrentDayCode,
    isProductAvailableToday,
    normalizeAvailableDays,
    parseAvailableDaysInput,
    serializeAvailableDays
} from "./product-availability"

describe("product availability helpers", () => {
    it("normalizes day input with dedupe and canonical ordering", () => {
        expect(normalizeAvailableDays(["fri", "MON", "FRI", "invalid"])).toEqual(["MON", "FRI"])
    })

    it("parses serialized input", () => {
        expect(parseAvailableDaysInput("MON,\nwed; SUN")).toEqual(["MON", "WED", "SUN"])
    })

    it("serializes day arrays in canonical format", () => {
        expect(serializeAvailableDays(["SUN", "mon", "SUN"])).toBe("MON,SUN")
    })

    it("evaluates product availability for current day", () => {
        expect(isProductAvailableToday([], "MON")).toBe(true)
        expect(isProductAvailableToday(["WED", "FRI"], "MON")).toBe(false)
        expect(isProductAvailableToday(["WED", "MON"], "MON")).toBe(true)
    })

    it("gets day code for timezone-aware date and formats labels", () => {
        expect(getCurrentDayCode("Europe/Rome", new Date("2026-02-22T23:30:00Z"))).toBe("MON")
        expect(getCurrentDayCode("UTC", new Date("2026-02-22T23:30:00Z"))).toBe("SUN")
        expect(formatAvailableDaysLabel(["MON", "WED"])).toBe("LUN · MER")
        expect(formatAvailableDaysLabel([])).toBe("Sempre")
    })
})
