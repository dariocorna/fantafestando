import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import dbConnect from "@/lib/mongoose"
import {
    resolveSumUpCredentialsForOrder,
    type SumUpRefundCredentialsSnapshot,
} from "@/lib/sumup-order-credentials"
import {
    getSumUpTransactionByClientTransactionId,
    getSumUpTransactionByForeignTransactionId,
} from "@/lib/sumup"
import {
    dispatchSumUpOrderPrints,
    finalizeClaimedSumUpOrder,
    getSumUpTransactionOutcome,
    sumUpTransactionMatchesOrder,
    sumUpTransactionsMatch,
    type ClaimedSumUpOrder,
    type VerifiedSumUpTransaction,
} from "@/lib/sumup-order-finalization"
import Order from "@/models/Order"

const WEBHOOK_CLAIM_TTL_MS = 5 * 60 * 1000

type WebhookOrder = ClaimedSumUpOrder & {
    sumupCheckoutId?: string
    sumupPaymentId?: string
    sumupRefundCredentials?: SumUpRefundCredentialsSnapshot
    sumupRecoveryCancelledAt?: Date
    sumupLateSuccessDetectedAt?: Date
    stornoMeta?: { refundStatus?: "SKIPPED" | "DONE" | "FAILED" }
}

function extractPayloadClientTransactionId(payload: Record<string, unknown>) {
    const nestedPayload = payload.payload
    if (!nestedPayload || typeof nestedPayload !== "object") return undefined
    const clientTransactionId = (nestedPayload as { client_transaction_id?: unknown }).client_transaction_id
    return typeof clientTransactionId === "string" && clientTransactionId.trim()
        ? clientTransactionId.trim()
        : undefined
}

async function loadWebhookOrder(clientTransactionId: string) {
    return await Order.findOne({ sumupCheckoutId: clientTransactionId })
        .select("_id status totalAmount eventId cashSessionId posDeviceId stockEffectStatus stockAdjustments sumupCheckoutId sumupPaymentId sumupRecoveryCancelledAt sumupLateSuccessDetectedAt stornoMeta.refundStatus +sumupRefundCredentials")
        .lean() as WebhookOrder | null
}

async function handleRecoveredCancellation(
    order: WebhookOrder,
    transaction: VerifiedSumUpTransaction,
    clientTransactionId: string,
) {
    const outcome = getSumUpTransactionOutcome(transaction)
    if (outcome === "SUCCESS" && order.stornoMeta?.refundStatus === "DONE") {
        return NextResponse.json({ success: true, message: "Late payment already refunded" })
    }
    if (outcome === "FAILED") {
        return NextResponse.json({ success: true, message: "Already cancelled" })
    }
    if (outcome === "PENDING") {
        await Order.updateOne(
            { _id: order._id, status: "CANCELLED", sumupRecoveryCancelledAt: { $exists: true } },
            { $set: { sumupCheckoutId: clientTransactionId } },
        )
        return NextResponse.json({ error: "Late SumUp transaction is still pending" }, { status: 409 })
    }

    const paymentId = transaction.id?.trim()
    const alreadyDetected = Boolean(order.sumupLateSuccessDetectedAt)
    const detected = await Order.updateOne(
        { _id: order._id, status: "CANCELLED", sumupRecoveryCancelledAt: { $exists: true } },
        {
            $set: {
                sumupCheckoutId: clientTransactionId,
                ...(paymentId ? { sumupPaymentId: paymentId } : {}),
                ...(alreadyDetected ? {} : { sumupLateSuccessDetectedAt: new Date() }),
            },
        },
    )
    if (!detected.acknowledged || detected.matchedCount !== 1) {
        return NextResponse.json({ error: "Late SumUp payment reconciliation conflict" }, { status: 409 })
    }
    return NextResponse.json(
        { error: "Late SumUp payment detected after local cancellation; refund required" },
        { status: 409 },
    )
}

async function reconcileUncertainCheckout(req: NextRequest, clientTransactionId: string) {
    const orderId = req.nextUrl.searchParams.get("orderId")?.trim()
    if (!orderId) return { success: false as const, response: NextResponse.json({ error: "Order not found" }, { status: 404 }) }

    const order = await Order.findOne({
        _id: orderId,
        sumupCheckoutId: `initiating:${orderId}`,
        $and: [
            {
                $or: [
                    { status: "PENDING" },
                    { status: "CANCELLED", sumupRecoveryCancelledAt: { $exists: true } },
                ],
            },
            {
                $or: [
                    { sumupWebhookClaimedAt: { $exists: false } },
                    { sumupWebhookClaimedAt: { $lt: new Date(Date.now() - WEBHOOK_CLAIM_TTL_MS) } },
                ],
            },
        ],
    })
        .select("_id status totalAmount eventId cashSessionId posDeviceId stockEffectStatus stockAdjustments sumupCheckoutId sumupPaymentId sumupRecoveryCancelledAt sumupLateSuccessDetectedAt stornoMeta.refundStatus +sumupRefundCredentials")
        .lean() as WebhookOrder | null
    if (!order?.eventId) {
        return { success: false as const, response: NextResponse.json({ error: "Order not found" }, { status: 404 }) }
    }

    const credentials = await resolveSumUpCredentialsForOrder(order)
    if (!credentials.success) {
        return { success: false as const, response: NextResponse.json({ error: credentials.error }, { status: 409 }) }
    }

    const [clientLookup, foreignLookup] = await Promise.all([
        getSumUpTransactionByClientTransactionId({
            clientTransactionId,
            merchantCode: credentials.merchantCode,
            apiKey: credentials.apiKey,
        }),
        getSumUpTransactionByForeignTransactionId({
            foreignTransactionId: orderId,
            merchantCode: credentials.merchantCode,
            apiKey: credentials.apiKey,
        }),
    ])
    if (!clientLookup.success || !foreignLookup.success) {
        return {
            success: false as const,
            response: NextResponse.json(
                { error: !clientLookup.success ? clientLookup.error : foreignLookup.error },
                { status: 502 },
            ),
        }
    }
    if (
        !sumUpTransactionsMatch(clientLookup.transaction, foreignLookup.transaction)
        || !sumUpTransactionMatchesOrder(clientLookup.transaction, credentials.merchantCode, order)
    ) {
        return {
            success: false as const,
            response: NextResponse.json({ error: "Transaction verification mismatch" }, { status: 409 }),
        }
    }

    if (order.status === "CANCELLED") {
        return {
            success: false as const,
            response: await handleRecoveredCancellation(order, clientLookup.transaction, clientTransactionId),
        }
    }

    const linked = await Order.updateOne(
        {
            _id: orderId,
            status: "PENDING",
            sumupCheckoutId: `initiating:${orderId}`,
            $or: [
                { sumupWebhookClaimedAt: { $exists: false } },
                { sumupWebhookClaimedAt: { $lt: new Date(Date.now() - WEBHOOK_CLAIM_TTL_MS) } },
            ],
        },
        { $set: { sumupCheckoutId: clientTransactionId } },
    )
    if (!linked.acknowledged || linked.matchedCount !== 1) {
        return {
            success: false as const,
            response: NextResponse.json({ error: "Payment reconciliation conflict" }, { status: 409 }),
        }
    }

    return {
        success: true as const,
        order,
        credentials,
        transaction: clientLookup.transaction,
    }
}

export async function POST(req: NextRequest) {
    try {
        const payload = JSON.parse(await req.text()) as Record<string, unknown>
        const eventType = typeof payload.event_type === "string" ? payload.event_type : ""
        const clientTransactionId = extractPayloadClientTransactionId(payload)
        console.log(`[SumUp Webhook] event=${eventType || "unknown"} clientTransaction=${clientTransactionId || "missing"}`)

        if (eventType !== "solo.transaction.updated" || !clientTransactionId) {
            return NextResponse.json({ success: true, message: "Event ignored" })
        }

        await dbConnect()
        let order = await loadWebhookOrder(clientTransactionId)

        if (order?.status === "PAID") {
            if (await dispatchSumUpOrderPrints(order) === "RECOVERY_PENDING") {
                return NextResponse.json({ error: "Print recovery pending" }, { status: 503 })
            }
            return NextResponse.json({ success: true, message: "Already paid" })
        }
        if (order?.status === "CANCELLED" && !order.sumupRecoveryCancelledAt) {
            return NextResponse.json({ success: true, message: "Already cancelled" })
        }

        let credentials: Awaited<ReturnType<typeof resolveSumUpCredentialsForOrder>>
        let transaction: VerifiedSumUpTransaction
        if (!order) {
            const reconciliation = await reconcileUncertainCheckout(req, clientTransactionId)
            if (!reconciliation.success) return reconciliation.response
            order = reconciliation.order
            credentials = reconciliation.credentials
            transaction = reconciliation.transaction
        } else {
            if (!order.eventId) {
                return NextResponse.json({ error: "Order event not found" }, { status: 409 })
            }
            credentials = await resolveSumUpCredentialsForOrder(order)
            if (!credentials.success) {
                return NextResponse.json({ error: credentials.error }, { status: 409 })
            }
            const lookup = await getSumUpTransactionByClientTransactionId({
                clientTransactionId,
                merchantCode: credentials.merchantCode,
                apiKey: credentials.apiKey,
            })
            if (!lookup.success) {
                return NextResponse.json({ error: lookup.error }, { status: 502 })
            }
            transaction = lookup.transaction
        }

        if (!credentials.success || !sumUpTransactionMatchesOrder(transaction, credentials.merchantCode, order)) {
            return NextResponse.json({ error: "Transaction verification mismatch" }, { status: 409 })
        }

        if (order.status === "CANCELLED") {
            return await handleRecoveredCancellation(order, transaction, clientTransactionId)
        }

        const outcome = getSumUpTransactionOutcome(transaction)
        if (outcome === "PENDING") {
            return NextResponse.json({ error: "Transaction not confirmed as final" }, { status: 409 })
        }

        const claimToken = crypto.randomUUID()
        const claimedOrder = await Order.findOneAndUpdate(
            {
                sumupCheckoutId: clientTransactionId,
                status: "PENDING",
                $or: [
                    { sumupWebhookClaimedAt: { $exists: false } },
                    { sumupWebhookClaimedAt: { $lt: new Date(Date.now() - WEBHOOK_CLAIM_TTL_MS) } },
                ],
            },
            { $set: { sumupWebhookClaimToken: claimToken, sumupWebhookClaimedAt: new Date() } },
            { returnDocument: "after" },
        ) as WebhookOrder | null

        if (!claimedOrder) {
            const currentOrder = await loadWebhookOrder(clientTransactionId)
            if (currentOrder?.status === "PAID") {
                if (await dispatchSumUpOrderPrints(currentOrder) === "RECOVERY_PENDING") {
                    return NextResponse.json({ error: "Print recovery pending" }, { status: 503 })
                }
                return NextResponse.json({ success: true, message: "Already paid" })
            }
            if (currentOrder?.status === "CANCELLED") {
                return NextResponse.json({ success: true, message: "Already cancelled" })
            }
            if (currentOrder?.status === "PENDING") {
                return NextResponse.json({ error: "Payment processing" }, { status: 503 })
            }
            return NextResponse.json({ error: "Order not found" }, { status: 404 })
        }

        const finalized = await finalizeClaimedSumUpOrder({
            order: claimedOrder,
            transaction,
            checkoutId: clientTransactionId,
            claimToken,
        })
        if (!finalized.success) {
            return NextResponse.json({ error: finalized.error }, { status: finalized.httpStatus })
        }
        return finalized.status === "CANCELLED"
            ? NextResponse.json({ success: true, status: "cancelled" })
            : NextResponse.json({ success: true })
    } catch (error) {
        console.error("[SumUp Webhook] Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
