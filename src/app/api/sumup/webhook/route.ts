import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { PrinterService } from "@/lib/printer";

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

export async function POST(req: NextRequest) {
    try {
        const rawBody = await req.text();
        const payload = JSON.parse(rawBody);
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

        const eventType = payload.event_type;
        const checkoutId = payload.id; // checkout id is often here or in payload.checkout_id

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

            // Aggiorna lo stato dell'ordine
            order.status = "PAID";
            await order.save();

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
