import type { TransactionFull } from "@sumup/sdk"
import { claimCashSessionPayment, refreshCashSessionPaymentClaim, releaseCashSessionPaymentClaim } from "@/lib/cash-session-payment-claim"
import { PrinterService } from "@/lib/printer"
import { transitionSumUpOrderStock } from "@/lib/sumup-order-stock"
import Order from "@/models/Order"

export type VerifiedSumUpTransaction = TransactionFull & {
    client_transaction_id?: string
    foreign_transaction_id?: string
}

export type ClaimedSumUpOrder = {
    _id: { toString(): string } | string
    status?: "PENDING" | "PAID" | "CANCELLED"
    totalAmount?: number
    eventId?: { toString(): string } | string
    cashSessionId?: { toString(): string } | string | null
    posDeviceId?: { toString(): string } | string | null
    stockEffectStatus?: "APPLIED" | "REVERTED"
    stockAdjustments?: Array<{
        entityType: "PRODUCT" | "INGREDIENT"
        entityId: { toString(): string } | string
        quantity: number
    }>
}

function normalizeMoneyAmount(amount: number | undefined) {
    if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined
    return Number(amount.toFixed(2))
}

export function getSumUpTransactionOutcome(transaction: VerifiedSumUpTransaction): "SUCCESS" | "FAILED" | "PENDING" {
    const simpleStatus = transaction.simple_status
    if (simpleStatus) {
        if (simpleStatus === "SUCCESSFUL" || simpleStatus === "PAID_OUT") return "SUCCESS"
        if (["CANCELLED", "FAILED", "REFUNDED", "CHARGEBACK", "NON_COLLECTION"].includes(simpleStatus)) {
            return "FAILED"
        }
        return "PENDING"
    }

    const status = transaction.status as string | undefined
    if (status === "SUCCESSFUL" || status === "PAID_OUT") return "SUCCESS"
    if (["CANCELLED", "FAILED", "REFUNDED", "CHARGE_BACK"].includes(status || "")) return "FAILED"
    return "PENDING"
}

export function sumUpTransactionMatchesOrder(
    transaction: VerifiedSumUpTransaction,
    merchantCode: string,
    order: Pick<ClaimedSumUpOrder, "totalAmount">,
) {
    return transaction.merchant_code?.trim() === merchantCode.trim()
        && transaction.currency?.trim() === "EUR"
        && normalizeMoneyAmount(transaction.amount) === normalizeMoneyAmount(order.totalAmount)
}

export function sumUpTransactionsMatch(left: VerifiedSumUpTransaction, right: VerifiedSumUpTransaction) {
    const leftId = left.id?.trim()
    const rightId = right.id?.trim()
    return Boolean(leftId && rightId && leftId === rightId)
        && left.merchant_code?.trim() === right.merchant_code?.trim()
        && left.currency?.trim() === right.currency?.trim()
        && normalizeMoneyAmount(left.amount) === normalizeMoneyAmount(right.amount)
}

export async function dispatchSumUpOrderPrints(order: ClaimedSumUpOrder) {
    const orderId = order._id.toString()
    try {
        await PrinterService.routeOrderToPrinters(
            orderId,
            order.posDeviceId?.toString(),
            { idempotencyScope: "SUMUP_CALLBACK" },
        )
    } catch (error) {
        // Il pagamento e' gia' autorevole: il monitor stampa mantiene visibile il guasto.
        console.error("[SumUp] Errore durante il trigger delle stampe:", error)
    }
}

export async function finalizeClaimedSumUpOrder(params: {
    order: ClaimedSumUpOrder
    transaction: VerifiedSumUpTransaction
    checkoutId: string
    claimToken: string
}): Promise<
    { success: true; status: "PAID" | "CANCELLED" }
    | { success: false; error: string; httpStatus: 409 | 503 }
> {
    const { order, transaction, checkoutId, claimToken } = params
    const orderId = order._id.toString()
    const eventId = order.eventId?.toString()
    const cashSessionId = order.cashSessionId?.toString()
    let paymentClaimToken: string | undefined

    try {
        if (!eventId || !cashSessionId) {
            return { success: false, error: "Cash session not found", httpStatus: 409 }
        }

        const paymentClaim = await claimCashSessionPayment(cashSessionId)
        if (!paymentClaim.success || paymentClaim.isTest) {
            return { success: false, error: "Cash session is unavailable for SumUp payments", httpStatus: 409 }
        }
        paymentClaimToken = paymentClaim.token

        const outcome = getSumUpTransactionOutcome(transaction)
        if (outcome === "PENDING") {
            return { success: false, error: "Transaction not confirmed as final", httpStatus: 409 }
        }

        if (outcome === "FAILED") {
            const stockResult = await transitionSumUpOrderStock({
                eventId,
                orderId,
                token: `SUMUP_CANCEL:${checkoutId}`,
                target: "REVERTED",
                adjustments: (order.stockAdjustments || []).map((entry) => ({
                    ...entry,
                    entityId: entry.entityId.toString(),
                })),
            })
            if (!stockResult.success) {
                return { success: false, error: stockResult.error, httpStatus: 409 }
            }
            const cancelled = await Order.updateOne(
                { _id: order._id, status: "PENDING", sumupWebhookClaimToken: claimToken },
                {
                    $set: { status: "CANCELLED", sumupCheckoutId: checkoutId },
                    $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 },
                },
            )
            if (!cancelled.acknowledged || cancelled.matchedCount !== 1) {
                return { success: false, error: "SumUp claim lost before cancellation", httpStatus: 409 }
            }
            return { success: true, status: "CANCELLED" }
        }

        if (order.stockEffectStatus !== "APPLIED") {
            return { success: false, error: "Reserved stock is not ready", httpStatus: 503 }
        }
        if (!await refreshCashSessionPaymentClaim(cashSessionId, paymentClaimToken)) {
            return { success: false, error: "Cash session changed during payment", httpStatus: 409 }
        }

        const paid = await Order.updateOne(
            { _id: order._id, status: "PENDING", sumupWebhookClaimToken: claimToken },
            {
                $set: {
                    status: "PAID",
                    paidAt: new Date(),
                    sumupCheckoutId: checkoutId,
                    ...(transaction.id?.trim() ? { sumupPaymentId: transaction.id.trim() } : {}),
                },
                $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 },
            },
        )
        if (!paid.acknowledged || paid.matchedCount !== 1) {
            return { success: false, error: "SumUp claim lost before payment completion", httpStatus: 409 }
        }

        await dispatchSumUpOrderPrints({ ...order, status: "PAID" })
        return { success: true, status: "PAID" }
    } finally {
        await releaseCashSessionPaymentClaim(cashSessionId || "", paymentClaimToken).catch((error) => {
            console.error("[SumUp] Cash session payment claim release error:", error)
        })
        await Order.updateOne(
            { _id: order._id, status: "PENDING", sumupWebhookClaimToken: claimToken },
            { $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 } },
        ).catch((error) => {
            console.error("[SumUp] Order claim release error:", error)
        })
    }
}
