import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { PrinterService } from "@/lib/printer";
import { type StockMode } from "@/lib/inventory";
import {
    applyStockForPaidOrder,
    rollbackStockAdjustments,
    type StockAdjustment,
} from "@/lib/stock-operations";
import {
    claimCashSessionPayment,
    refreshCashSessionPaymentClaim,
    releaseCashSessionPaymentClaim,
} from "@/lib/cash-session-payment-claim";

const WEBHOOK_CLAIM_TTL_MS = 5 * 60 * 1000;

function safeEquals(a: string, b: string) {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string) {
    const normalizedSignature = signatureHeader.trim();
    const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBase64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    const expectedCandidates = [
        expectedHex,
        `sha256=${expectedHex}`,
        expectedBase64,
        `sha256=${expectedBase64}`
    ];
    return expectedCandidates.some(candidate => safeEquals(candidate, normalizedSignature));
}

function extractSumUpTransactionId(payload: Record<string, unknown>): string | undefined {
    const direct = typeof payload.transaction_id === "string" ? payload.transaction_id : undefined
    if (direct?.trim()) return direct.trim()

    const transaction = payload.transaction
    if (transaction && typeof transaction === "object") {
        const nested = (transaction as { id?: unknown }).id
        if (typeof nested === "string" && nested.trim()) return nested.trim()
    }

    const data = payload.data
    if (data && typeof data === "object") {
        const nested = (data as { transaction_id?: unknown }).transaction_id
        if (typeof nested === "string" && nested.trim()) return nested.trim()
    }

    return undefined
}

export async function POST(req: NextRequest) {
    try {
        const rawBody = await req.text();
        const payload = JSON.parse(rawBody) as Record<string, unknown>;

        const webhookSecret = process.env.SUMUP_WEBHOOK_SECRET;
        const signatureHeader = req.headers.get("x-sumup-signature")
            || req.headers.get("sumup-signature")
            || req.headers.get("x-signature");

        if (!webhookSecret) {
            if (process.env.NODE_ENV === "production") {
                console.error("[SumUp Webhook] Missing SUMUP_WEBHOOK_SECRET in production.");
                return NextResponse.json({ error: "Webhook misconfigured" }, { status: 500 });
            }
            console.warn("[SumUp Webhook] Signature verification skipped (missing SUMUP_WEBHOOK_SECRET).");
        } else {
            if (!signatureHeader) {
                return NextResponse.json({ error: "Missing signature" }, { status: 401 });
            }
            const isValid = verifyWebhookSignature(rawBody, signatureHeader, webhookSecret);
            if (!isValid) {
                return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
            }
        }

        const eventType = typeof payload.event_type === "string" ? payload.event_type : ""
        const checkoutId = typeof payload.id === "string" ? payload.id : ""
        console.log(`[SumUp Webhook] event=${eventType || "unknown"} checkout=${checkoutId || "missing"}`);

        if (eventType === "checkout.succeeded" && checkoutId) {
            await dbConnect();

            const claimToken = crypto.randomUUID();
            const order = await Order.findOneAndUpdate(
                {
                    sumupCheckoutId: checkoutId,
                    status: "PENDING",
                    $or: [
                        { sumupWebhookClaimedAt: { $exists: false } },
                        { sumupWebhookClaimedAt: { $lt: new Date(Date.now() - WEBHOOK_CLAIM_TTL_MS) } }
                    ]
                },
                {
                    $set: {
                        sumupWebhookClaimToken: claimToken,
                        sumupWebhookClaimedAt: new Date()
                    }
                },
                { returnDocument: "after" }
            );

            if (!order) {
                const existingOrder = await Order.findOne({ sumupCheckoutId: checkoutId })
                    .select("status")
                    .lean() as ({ status?: string } | null);
                if (existingOrder?.status === "PAID") {
                    return NextResponse.json({ success: true, message: "Already paid" });
                }
                if (existingOrder?.status === "PENDING") {
                    return NextResponse.json({ success: true, message: "Payment processing" });
                }
                console.warn(`[SumUp Webhook] Ordine non trovato per checkoutId: ${checkoutId}`);
                return NextResponse.json({ error: "Order not found" }, { status: 404 });
            }

            const preferredMode: StockMode = (order as { stockOverrideApproved?: boolean }).stockOverrideApproved ? "override" : "strict"
            let appliedAdjustmentsToRollback: StockAdjustment[] = []
            let stockOverrideApproved = preferredMode === "override"
            let paymentCompleted = false
            let paymentClaimToken: string | undefined
            const cashSessionId = order.cashSessionId?.toString()

            try {
                if (!cashSessionId) {
                    return NextResponse.json({ error: "Cash session not found" }, { status: 409 })
                }

                const paymentClaim = await claimCashSessionPayment(cashSessionId)
                if (!paymentClaim.success) {
                    return NextResponse.json({ error: "Cash session is unavailable for SumUp payments" }, { status: 409 })
                }
                paymentClaimToken = paymentClaim.token
                if (paymentClaim.isTest) {
                    return NextResponse.json({ error: "Cash session is unavailable for SumUp payments" }, { status: 409 })
                }

                const cartPayload = order.cart.map((item: {
                    productId: string | { toString(): string }
                    quantity: number
                    snapshotName: string
                    selectedOptions?: Array<{ name: string, priceVariation: number }>
                    includedComponents?: Array<{ productId: string | { toString(): string }, snapshotName: string, quantity: number }>
                }) => ({
                    productId: item.productId.toString(),
                    snapshotName: item.snapshotName,
                    quantity: item.quantity,
                    selectedOptions: item.selectedOptions || [],
                    includedComponents: Array.isArray(item.includedComponents)
                        ? item.includedComponents.map((component) => ({
                            productId: component.productId.toString(),
                            snapshotName: component.snapshotName,
                            quantity: component.quantity
                        }))
                        : []
                }))

                const stockResult = await applyStockForPaidOrder(
                    order.eventId.toString(),
                    cartPayload,
                    preferredMode,
                    Array.isArray(order.ingredientPlan)
                        ? order.ingredientPlan.map((entry: {
                            ingredientId?: string | { toString(): string }
                            quantity?: number
                        }) => ({
                            ingredientId: entry.ingredientId?.toString(),
                            quantity: Number(entry.quantity ?? 0)
                        }))
                        : []
                )

                if (!stockResult.success) {
                    if (preferredMode === "strict") {
                        console.warn("[SumUp Webhook] Stock shortage in strict mode, applying override fallback.", stockResult.stockShortages);
                        const overrideResult = await applyStockForPaidOrder(
                            order.eventId.toString(),
                            cartPayload,
                            "override",
                            Array.isArray(order.ingredientPlan)
                                ? order.ingredientPlan.map((entry: {
                                    ingredientId?: string | { toString(): string }
                                    quantity?: number
                                }) => ({
                                    ingredientId: entry.ingredientId?.toString(),
                                    quantity: Number(entry.quantity ?? 0)
                                }))
                                : []
                        )
                        if (!overrideResult.success) {
                            console.error("[SumUp Webhook] Override stock apply failed.", overrideResult.stockShortages)
                            return NextResponse.json({ error: "Stock apply failed" }, { status: 409 })
                        }
                        appliedAdjustmentsToRollback = overrideResult.appliedAdjustments || []
                        stockOverrideApproved = true
                    } else {
                        console.error("[SumUp Webhook] Stock apply failed in override mode.", stockResult.stockShortages)
                        return NextResponse.json({ error: "Stock apply failed" }, { status: 409 })
                    }
                } else {
                    appliedAdjustmentsToRollback = stockResult.appliedAdjustments || []
                }

                if (!await refreshCashSessionPaymentClaim(cashSessionId, paymentClaimToken)) {
                    throw new Error("Cash session payment claim lost before payment completion")
                }

                const sumupPaymentId = extractSumUpTransactionId(payload)
                const paidAt = new Date()
                const completedOrder = await Order.updateOne(
                    {
                        _id: order._id,
                        status: "PENDING",
                        sumupWebhookClaimToken: claimToken
                    },
                    {
                        $set: {
                            status: "PAID",
                            paidAt,
                            stockOverrideApproved,
                            stockAdjustments: appliedAdjustmentsToRollback,
                            stockEffectStatus: "APPLIED",
                            ...(sumupPaymentId ? { sumupPaymentId } : {})
                        },
                        $unset: {
                            sumupWebhookClaimToken: 1,
                            sumupWebhookClaimedAt: 1
                        }
                    }
                );
                if (!completedOrder.acknowledged || completedOrder.matchedCount !== 1) {
                    throw new Error("Webhook claim lost before payment completion");
                }
                paymentCompleted = true

                console.log(`[SumUp Webhook] Ordine ${order._id} marcato come PAGATO.`);

                try {
                    await PrinterService.routeOrderToPrinters(order._id.toString(), order.posDeviceId?.toString());
                } catch (printError) {
                    console.error("[SumUp Webhook] Errore durante il trigger delle stampe:", printError);
                }

                return NextResponse.json({ success: true });
            } catch (error) {
                if (appliedAdjustmentsToRollback.length > 0) {
                    await rollbackStockAdjustments(order.eventId.toString(), appliedAdjustmentsToRollback)
                }
                throw error
            } finally {
                try {
                    await releaseCashSessionPaymentClaim(cashSessionId || "", paymentClaimToken)
                } catch (releaseError) {
                    console.error("[SumUp Webhook] Cash session payment claim release error:", releaseError);
                }
                if (!paymentCompleted) {
                    await Order.updateOne(
                        { _id: order._id, sumupWebhookClaimToken: claimToken },
                        { $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 } }
                    ).catch((releaseError) => {
                        console.error("[SumUp Webhook] Claim release error:", releaseError);
                    });
                }
            }
        }

        return NextResponse.json({ success: true, message: "Event ignored" });
    } catch (error) {
        console.error("[SumUp Webhook] Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
