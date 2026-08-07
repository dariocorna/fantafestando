import { describe, expect, test } from "vitest"
import { buildCashSessionTransitionClaim, CASH_SESSION_TRANSITION_LEASE_MS } from "@/lib/cash-session-transition"

describe("cash session transition claims", () => {
    const now = new Date("2026-08-07T00:00:00.000Z")

    test("rejects adoption of a fresh active claim", () => {
        const result = buildCashSessionTransitionClaim({
            token: "owner",
            type: "CLOSE",
            status: "IN_PROGRESS",
            claimedAt: new Date(now.getTime() - 1_000)
        }, "CLOSE", now)

        expect(result).toEqual({ success: false, error: "Transizione già in corso: riprova tra poco" })
    })

    test("resumes a failed or expired claim with the original token", () => {
        const failed = buildCashSessionTransitionClaim({ token: "failed", type: "CLOSE", status: "FAILED", claimedAt: now }, "CLOSE", now)
        const expired = buildCashSessionTransitionClaim({
            token: "expired",
            type: "CLOSE",
            status: "IN_PROGRESS",
            claimedAt: new Date(now.getTime() - CASH_SESSION_TRANSITION_LEASE_MS)
        }, "CLOSE", now)

        expect(failed).toMatchObject({ success: true, token: "failed" })
        expect(expired).toMatchObject({ success: true, token: "expired" })
    })
})
