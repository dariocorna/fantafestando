import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { formatOrderDateTime } from "./order-date-time"

describe("formatOrderDateTime", () => {
    const originalTimezone = process.env.TZ

    beforeAll(() => {
        process.env.TZ = "Europe/Rome"
    })

    afterAll(() => {
        if (originalTimezone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimezone
    })

    test.each([
        ["2026-01-15T19:30:00.000Z", "15/01/2026", "20:30"],
        ["2026-07-15T18:30:00.000Z", "15/07/2026", "20:30"]
    ])("formats %s in the local timezone", (value, expectedDate, expectedTime) => {
        const formatted = formatOrderDateTime(value)
        expect(formatted).toContain(expectedDate)
        expect(formatted).toContain(expectedTime)
    })

    test("handles missing and invalid values", () => {
        expect(formatOrderDateTime()).toBe("-")
        expect(formatOrderDateTime("invalid")).toBe("-")
    })
})
