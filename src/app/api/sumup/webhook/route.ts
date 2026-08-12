import crypto from "node:crypto"
import type { TransactionFull } from "@sumup/sdk"
import { NextRequest, NextResponse } from "next/server"
import dbConnect from "@/lib/mongoose"
import { claimCashSessionPayment, refreshCashSessionPaymentClaim, releaseCashSessionPaymentClaim } from "@/lib/cash-session-payment-claim"
import { decryptSecret } from "@/lib/secrets"
import {
    getSumUpTransactionByClientTransactionId,
    getSumUpTransactionByForeignTransactionId,
} from "@/lib/sumup"
import { transitionSumUpOrderStock } from "@/lib/sumup-order-stock"
import { PrinterService } from "@/lib/printer"
import Order from "@/models/Order"
import PosDevice from "@/models/PosDevice"

const WEBHOOK_CLAIM_TTL_MS = 5 * 60 * 1000

type WebhookOrder = {
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

type VerifiedTransaction = TransactionFull

function extractPayloadClientTransactionId(payload: Record<string, unknown>) {
    const nestedPayload = payload.payload
    if (!nestedPayload || typeof nestedPayload !== "object") return undefined
    const clientTransactionId = (nestedPayload as { client_transaction_id?: unknown }).client_transaction_id
    return typeof clientTransactionId === "string" && clientTransactionId.trim()
        ? clientTransactionId.trim()
        : undefined
}

function normalizeMoneyAmount(amount: number | undefined) {
    if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined
    return Number(amount.toFixed(2))
}

function transactionOutcome(transaction: VerifiedTransaction): "SUCCESS" | "FAILED" | "PENDING" {
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

async function resolveSumUpTerminalCredentials(
    eventId: string,
    posDeviceId?: { toString(): string } | string | null,
) {
    if (!posDeviceId) {
        return { success: false as const, error: "Ordine SumUp senza punto cassa associato" }
    }

    const posDevice = await PosDevice.findOne({ _id: posDeviceId.toString(), eventId })
        .populate({ path: "paymentTerminalId", select: "type config" })
        .lean() as (
            {
                paymentTerminalId?: {
                    type?: string
                    config?: { merchantCode?: string; apiKey?: string }
                } | null
            } | null
        )
    const terminal = posDevice?.paymentTerminalId
    const merchantCode = terminal?.config?.merchantCode?.trim()
    const apiKey = decryptSecret(terminal?.config?.apiKey)

    if (!terminal || terminal.type !== "SUMUP" || !merchantCode || !apiKey) {
        return { success: false as const, error: "Configurazione SumUp mancante nella periferica associata" }
    }

    return { success: true as const, merchantCode, apiKey }
}

function transactionMatchesOrder(
    transaction: VerifiedTransaction,
    credentials: { merchantCode: string },
    order: WebhookOrder,
) {
    return transaction.merchant_code?.trim() === credentials.merchantCode
        && transaction.currency?.trim() === "EUR"
        && normalizeMoneyAmount(transaction.amount) === normalizeMoneyAmount(order.totalAmount)
}

function transactionsMatch(left: VerifiedTransaction, right: VerifiedTransaction) {
    const leftId = left.id?.trim()
    const rightId = right.id?.trim()
    return Boolean(leftId && rightId && leftId === rightId)
        && left.merchant_code?.trim() === right.merchant_code?.trim()
        && left.currency?.trim() === right.currency?.trim()
        && normalizeMoneyAmount(left.amount) === normalizeMoneyAmount(right.amount)
}

async function dispatchPrintsIfMissing(order: WebhookOrder) {
    const orderId = order._id.toString()
    try {
        await PrinterService.routeOrderToPrinters(
            orderId,
            order.posDeviceId?.toString(),
            { idempotencyScope: "SUMUP_CALLBACK" },
        )
    } catch (error) {
        // Payment is already authoritative. Print failures remain visible in the print monitor/admin reprint flow.
        console.error("[SumUp Webhook] Errore durante il trigger delle stampe:", error)
    }
}

async function loadWebhookOrder(clientTransactionId: string) {
    return await Order.findOne({ sumupCheckoutId: clientTransactionId })
        .select("_id status totalAmount eventId cashSessionId posDeviceId stockEffectStatus stockAdjustments")
        .lean() as WebhookOrder | null
}

async function reconcileUncertainCheckout(req: NextRequest, clientTransactionId: string) {
    const orderId = req.nextUrl.searchParams.get("orderId")?.trim()
    if (!orderId) return { success: false as const, response: NextResponse.json({ error: "Order not found" }, { status: 404 }) }

    const order = await Order.findOne({
        _id: orderId,
        status: "PENDING",
        sumupCheckoutId: `initiating:${orderId}`,
    })
        .select("_id status totalAmount eventId cashSessionId posDeviceId stockEffectStatus stockAdjustments")
        .lean() as WebhookOrder | null
    if (!order?.eventId) {
        return { success: false as const, response: NextResponse.json({ error: "Order not found" }, { status: 404 }) }
    }

    const credentials = await resolveSumUpTerminalCredentials(order.eventId.toString(), order.posDeviceId)
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
        !transactionsMatch(clientLookup.transaction, foreignLookup.transaction)
        || !transactionMatchesOrder(clientLookup.transaction, credentials, order)
    ) {
        return {
            success: false as const,
            response: NextResponse.json({ error: "Transaction verification mismatch" }, { status: 409 }),
        }
    }

    const linked = await Order.updateOne(
        { _id: orderId, status: "PENDING", sumupCheckoutId: `initiating:${orderId}` },
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
            await dispatchPrintsIfMissing(order)
            return NextResponse.json({ success: true, message: "Already paid" })
        }
        if (order?.status === "CANCELLED") {
            return NextResponse.json({ success: true, message: "Already cancelled" })
        }

        let credentials: Awaited<ReturnType<typeof resolveSumUpTerminalCredentials>>
        let transaction: VerifiedTransaction
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
            credentials = await resolveSumUpTerminalCredentials(order.eventId.toString(), order.posDeviceId)
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

        if (!credentials.success || !transactionMatchesOrder(transaction, credentials, order)) {
            return NextResponse.json({ error: "Transaction verification mismatch" }, { status: 409 })
        }

        const outcome = transactionOutcome(transaction)
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
                await dispatchPrintsIfMissing(currentOrder)
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

        let paymentClaimToken: string | undefined
        const cashSessionId = claimedOrder.cashSessionId?.toString()
        try {
            if (!claimedOrder.eventId || !cashSessionId) {
                return NextResponse.json({ error: "Cash session not found" }, { status: 409 })
            }

            const paymentClaim = await claimCashSessionPayment(cashSessionId)
            if (!paymentClaim.success || paymentClaim.isTest) {
                return NextResponse.json({ error: "Cash session is unavailable for SumUp payments" }, { status: 409 })
            }
            paymentClaimToken = paymentClaim.token

            if (outcome === "FAILED") {
                const stockResult = await transitionSumUpOrderStock({
                    eventId: claimedOrder.eventId.toString(),
                    orderId: claimedOrder._id.toString(),
                    token: `SUMUP_CANCEL:${clientTransactionId}`,
                    target: "REVERTED",
                    adjustments: (claimedOrder.stockAdjustments || []).map((entry) => ({
                        ...entry,
                        entityId: entry.entityId.toString(),
                    })),
                })
                if (!stockResult.success) {
                    return NextResponse.json({ error: stockResult.error }, { status: 409 })
                }
                const cancelled = await Order.updateOne(
                    { _id: claimedOrder._id, status: "PENDING", sumupWebhookClaimToken: claimToken },
                    {
                        $set: { status: "CANCELLED" },
                        $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 },
                    },
                )
                if (!cancelled.acknowledged || cancelled.matchedCount !== 1) {
                    return NextResponse.json({ error: "Webhook claim lost before cancellation" }, { status: 409 })
                }
                return NextResponse.json({ success: true, status: "cancelled" })
            }

            if (claimedOrder.stockEffectStatus !== "APPLIED") {
                return NextResponse.json({ error: "Reserved stock is not ready" }, { status: 503 })
            }
            if (!await refreshCashSessionPaymentClaim(cashSessionId, paymentClaimToken)) {
                return NextResponse.json({ error: "Cash session changed during payment" }, { status: 409 })
            }

            const paid = await Order.updateOne(
                { _id: claimedOrder._id, status: "PENDING", sumupWebhookClaimToken: claimToken },
                {
                    $set: {
                        status: "PAID",
                        paidAt: new Date(),
                        ...(transaction.id?.trim() ? { sumupPaymentId: transaction.id.trim() } : {}),
                    },
                    $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 },
                },
            )
            if (!paid.acknowledged || paid.matchedCount !== 1) {
                return NextResponse.json({ error: "Webhook claim lost before payment completion" }, { status: 409 })
            }

            const paidOrder = { ...claimedOrder, status: "PAID" as const }
            await dispatchPrintsIfMissing(paidOrder)
            return NextResponse.json({ success: true })
        } finally {
            await releaseCashSessionPaymentClaim(cashSessionId || "", paymentClaimToken).catch((error) => {
                console.error("[SumUp Webhook] Cash session payment claim release error:", error)
            })
            await Order.updateOne(
                { _id: claimedOrder._id, status: "PENDING", sumupWebhookClaimToken: claimToken },
                { $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 } },
            ).catch((error) => {
                console.error("[SumUp Webhook] Claim release error:", error)
            })
        }
    } catch (error) {
        console.error("[SumUp Webhook] Error:", error)
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
}
