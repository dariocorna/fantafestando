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
        console.log("[SumUp Webhook] Ricevuto payload:", JSON.stringify(payload));

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

        if (eventType === "checkout.succeeded" && checkoutId) {
            await dbConnect();

            // Trova l'ordine associato a questo checkout
            const order = await Order.findOne({ sumupCheckoutId: checkoutId });

            if (!order) {
                console.warn(`[SumUp Webhook] Ordine non trovato per checkoutId: ${checkoutId}`);
                return NextResponse.json({ error: "Order not found" }, { status: 404 });
            }

            if (order.status === "PAID") {
                return NextResponse.json({ success: true, message: "Already paid" });
            }

            const preferredMode: StockMode = (order as { stockOverrideApproved?: boolean }).stockOverrideApproved ? "override" : "strict"
            let appliedAdjustmentsToRollback: StockAdjustment[] = []

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
                    order.set("stockOverrideApproved", true)
                } else {
                    console.error("[SumUp Webhook] Stock apply failed in override mode.", stockResult.stockShortages)
                    return NextResponse.json({ error: "Stock apply failed" }, { status: 409 })
                }
            } else {
                appliedAdjustmentsToRollback = stockResult.appliedAdjustments || []
            }

            // Aggiorna lo stato dell'ordine
            const sumupPaymentId = extractSumUpTransactionId(payload)
            order.status = "PAID";
            if (sumupPaymentId) {
                order.set("sumupPaymentId", sumupPaymentId)
            }
            try {
                await order.save();
            } catch (saveError) {
                if (appliedAdjustmentsToRollback.length > 0) {
                    try {
                        await rollbackStockAdjustments(order.eventId.toString(), appliedAdjustmentsToRollback)
                    } catch (rollbackError) {
                        console.error("[SumUp Webhook] Rollback error:", rollbackError)
                    }
                }
                throw saveError
            }

            console.log(`[SumUp Webhook] Ordine ${order._id} marcato come PAGATO.`);

            // Trigger delle stampe in rete
            try {
                await PrinterService.routeOrderToPrinters(order._id.toString(), order.posDeviceId?.toString());
            } catch (printError) {
                console.error("[SumUp Webhook] Errore durante il trigger delle stampe:", printError);
            }

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ success: true, message: "Event ignored" });
    } catch (error) {
        console.error("[SumUp Webhook] Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
