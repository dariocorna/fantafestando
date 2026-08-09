import { describe, expect, it } from "vitest"
import { filterDashboardOrdersByTimeRange, resolveDashboardTimeRange } from "./dashboard-time-range"

describe("dashboard time range helpers", () => {
    it("builds a custom range in Europe/Rome and filters by paidAt", () => {
        const range = resolveDashboardTimeRange({
            mode: "custom",
            from: "2026-08-09T10:00",
            to: "2026-08-09T12:00",
            timezone: "Europe/Rome"
        })

        expect(range.isValid).toBe(true)
        expect(range.startMs).toBe(new Date("2026-08-09T08:00:00.000Z").getTime())
        expect(range.endMs).toBe(new Date("2026-08-09T10:00:00.000Z").getTime())

        const filtered = filterDashboardOrdersByTimeRange([
            { id: "included", createdAt: "2026-08-08T20:00:00.000Z", paidAt: "2026-08-09T08:30:00.000Z" },
            { id: "legacy", createdAt: "2026-08-09T09:00:00.000Z" },
            { id: "before", paidAt: "2026-08-09T07:59:00.000Z" },
            { id: "after", paidAt: "2026-08-09T10:00:00.000Z" }
        ], range)

        expect(filtered.map((order) => order.id)).toEqual(["included", "legacy"])
    })

    it("returns a clear error for inverted custom ranges", () => {
        const range = resolveDashboardTimeRange({
            mode: "custom",
            from: "2026-08-09T12:00",
            to: "2026-08-09T10:00",
            timezone: "Europe/Rome"
        })

        expect(range.isValid).toBe(false)
        expect(range.error).toBe("La data finale deve essere successiva a quella iniziale.")
    })

    it("rejects local times that do not exist during the DST jump", () => {
        const range = resolveDashboardTimeRange({
            mode: "custom",
            from: "2026-03-29T02:30",
            to: "2026-03-29T03:30",
            timezone: "Europe/Rome"
        })

        expect(range.isValid).toBe(false)
        expect(range.error).toBe("Data iniziale non valida: L'orario selezionato non esiste nel fuso orario configurato. Scegli un'ora diversa.")
    })

    it("rejects ambiguous local times during the DST fallback hour", () => {
        const range = resolveDashboardTimeRange({
            mode: "custom",
            from: "2026-10-25T02:30",
            to: "2026-10-25T03:30",
            timezone: "Europe/Rome"
        })

        expect(range.isValid).toBe(false)
        expect(range.error).toBe("Data iniziale non valida: L'orario selezionato è ambiguo nel fuso orario configurato. Scegli un'ora diversa.")
    })

    it("keeps evening preset bounds correct across the DST fallback day", () => {
        const range = resolveDashboardTimeRange({
            mode: "evening",
            timezone: "Europe/Rome",
            now: "2026-10-25T12:00:00.000Z"
        })

        expect(range.isValid).toBe(true)
        expect(range.startInput).toBe("2026-10-25T00:00")
        expect(range.endInput).toBe("2026-10-26T00:00")
        expect(range.startMs).toBe(new Date("2026-10-24T22:00:00.000Z").getTime())
        expect(range.endMs).toBe(new Date("2026-10-25T23:00:00.000Z").getTime())

        const reapplied = resolveDashboardTimeRange({
            mode: "custom",
            from: range.startInput,
            to: range.endInput,
            timezone: range.timezone
        })
        expect(reapplied.startMs).toBe(range.startMs)
        expect(reapplied.endMs).toBe(range.endMs)
    })

    it("marks realtime ranges as auto-refreshable", () => {
        const range = resolveDashboardTimeRange({
            mode: "realtime",
            timezone: "Europe/Rome",
            now: "2026-08-09T11:30:00.000Z"
        })

        expect(range.isValid).toBe(true)
        expect(range.isRealtime).toBe(true)
        expect(range.label).toContain("Tempo reale")
        expect(range.endInput).toBe("2026-08-09T13:31")

        const reapplied = resolveDashboardTimeRange({
            mode: "custom",
            from: range.startInput,
            to: range.endInput,
            timezone: range.timezone
        })
        expect(reapplied.startMs).toBe(range.startMs)
        expect(reapplied.endMs).toBeGreaterThanOrEqual(range.endMs!)
    })
})
