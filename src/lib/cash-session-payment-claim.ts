import { randomUUID } from "node:crypto"
import CashSession from "@/models/CashSession"
import Order from "@/models/Order"
import { CASH_SESSION_TRANSITION_LEASE_MS } from "@/lib/cash-session-transition"

export async function hasPendingSumUpCheckouts(sessionId: string) {
    return Boolean(await Order.exists({
        cashSessionId: sessionId,
        status: "PENDING",
        sumupCheckoutId: { $exists: true, $ne: "" }
    }))
}

export async function claimCashSessionPayment(sessionId: string) {
    const token = randomUUID()
    const now = new Date()
    const session = await CashSession.findOneAndUpdate(
        {
            _id: sessionId,
            status: "OPEN",
            transition: { $exists: false },
            $or: [
                { paymentClaim: { $exists: false } },
                { paymentClaim: null },
                { "paymentClaim.claimedAt": { $lte: new Date(now.getTime() - CASH_SESSION_TRANSITION_LEASE_MS) } }
            ]
        },
        { $set: { paymentClaim: { token, claimedAt: now } } },
        { returnDocument: "after" }
    ).select("isTest").lean() as ({ isTest?: boolean } | null)
    return session ? { success: true as const, token, isTest: Boolean(session.isTest) } : { success: false as const }
}

export async function refreshCashSessionPaymentClaim(sessionId: string, token: string) {
    const result = await CashSession.updateOne(
        { _id: sessionId, status: "OPEN", transition: { $exists: false }, "paymentClaim.token": token },
        { $set: { "paymentClaim.claimedAt": new Date() } }
    )
    return (result.matchedCount ?? result.modifiedCount) === 1
}

export async function releaseCashSessionPaymentClaim(sessionId: string, token?: string) {
    if (!token) return
    await CashSession.updateOne({ _id: sessionId, "paymentClaim.token": token }, { $unset: { paymentClaim: 1 } })
}
