import { randomUUID } from "node:crypto"

export const CASH_SESSION_TRANSITION_LEASE_MS = 5 * 60 * 1000

type TransitionType = "TO_TEST" | "TO_NORMAL" | "CLOSE" | "DELETE"

type ExistingTransition = {
    token?: string
    type?: TransitionType
    status?: "IN_PROGRESS" | "FAILED"
    claimedAt?: Date | string
} | null | undefined

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
                    { transition: { $exists: false } },
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
