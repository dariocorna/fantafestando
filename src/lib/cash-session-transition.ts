import { randomUUID } from "node:crypto"

export const CASH_SESSION_TRANSITION_LEASE_MS = 5 * 60 * 1000

type TransitionType = "TO_TEST" | "TO_NORMAL" | "CLOSE" | "DELETE"

type ExistingTransition = {
    token?: string
    type?: TransitionType
    status?: "IN_PROGRESS" | "FAILED"
    claimedAt?: Date | string
} | null | undefined

/**
 * Matches sessions whose transition can be taken over: the same set
 * buildCashSessionTransitionClaim treats as not active.
 */
export function recoverableTransition(now = new Date()) {
    return {
        $or: [
            { "transition.status": { $ne: "IN_PROGRESS" } },
            { "transition.claimedAt": null },
            { "transition.claimedAt": { $lte: new Date(now.getTime() - CASH_SESSION_TRANSITION_LEASE_MS) } }
        ]
    }
}

/** CAS guard: only the owner of this exact claim may finalize or fail the transition. */
export function cashSessionTransitionGuard(
    sessionId: unknown,
    transition: { token: string; type: TransitionType; claimedAt: Date }
) {
    return {
        _id: sessionId,
        "transition.token": transition.token,
        "transition.type": transition.type,
        "transition.claimedAt": transition.claimedAt
    }
}

export function buildCashSessionTransitionClaim(
    existing: ExistingTransition,
    type: TransitionType,
    now = new Date()
) {
    if (!existing?.token) {
        const token = randomUUID()
        return {
            success: true as const,
            token,
            guard: {
                $or: [
                    { transition: null },
                    { "transition.token": { $exists: false } }
                ]
            },
            transition: { token, type, status: "IN_PROGRESS" as const, claimedAt: now }
        }
    }

    if (existing.type !== type) {
        return { success: false as const, error: "Un'altra transizione è già in corso sulla sessione" }
    }

    const claimedAt = existing.claimedAt ? new Date(existing.claimedAt) : null
    const active = existing.status === "IN_PROGRESS"
        && claimedAt !== null
        && now.getTime() - claimedAt.getTime() < CASH_SESSION_TRANSITION_LEASE_MS
    if (active) return { success: false as const, error: "Transizione già in corso: riprova tra poco" }

    const token = existing.token
    return {
        success: true as const,
        token,
        guard: {
            "transition.token": token,
            "transition.type": type,
            "transition.status": existing.status,
            ...(claimedAt ? { "transition.claimedAt": claimedAt } : { "transition.claimedAt": { $exists: false } })
        },
        transition: { token, type, status: "IN_PROGRESS" as const, claimedAt: now }
    }
}
