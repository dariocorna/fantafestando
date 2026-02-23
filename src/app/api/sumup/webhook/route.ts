import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Product from "@/models/Product";
import { PrinterService } from "@/lib/printer";
import {
    aggregateCartQuantities,
    applyStockDecrement,
    collectStockShortages,
    isStockTracked,
    normalizeStockQuantity,
    type ProductStockInfo,
    type StockMode
} from "@/lib/inventory";

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

async function applyStockOnWebhook(
    eventId: string,
    cart: Array<{ productId: string | { toString(): string }, quantity: number, snapshotName: string }>,
    mode: StockMode
) {
    const demands = aggregateCartQuantities(
        cart.map((item) => ({
            productId: item.productId.toString(),
            quantity: item.quantity,
            snapshotName: item.snapshotName
        }))
    )
    if (demands.size === 0) {
        return { success: true as const }
    }

    const productIds = [...demands.keys()]
    const docs = await Product.find({
        eventId,
        _id: { $in: productIds }
    }).select("_id name stockQuantity isSoldOut").lean() as Array<{
        _id: string | { toString(): string }
        name: string
        stockQuantity?: number | null
        isSoldOut?: boolean
    }>

    const productMap = new Map<string, ProductStockInfo>(
        docs.map((doc) => [
            doc._id.toString(),
            {
                id: doc._id.toString(),
                name: doc.name,
                stockQuantity: normalizeStockQuantity(doc.stockQuantity ?? null),
                isSoldOut: Boolean(doc.isSoldOut)
            }
        ])
    )

    const shortages = collectStockShortages(demands, productMap)
    if (mode === "strict" && shortages.length > 0) {
        return {
            success: false as const,
            shortages
        }
    }

    for (const [productId, requestedQuantity] of demands.entries()) {
        const stockInfo = productMap.get(productId)
        if (!stockInfo || !isStockTracked(stockInfo.stockQuantity)) continue

        const latestDoc = await Product.findOne({
            eventId,
            _id: productId
        }).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

        if (!latestDoc) continue

        const currentStock = normalizeStockQuantity(latestDoc.stockQuantity ?? null)
        if (!isStockTracked(currentStock)) continue

        const result = applyStockDecrement(currentStock, requestedQuantity, mode)
        await Product.updateOne(
            { eventId, _id: productId },
            {
                $set: {
                    stockQuantity: result.nextStockQuantity,
                    isSoldOut: (result.nextStockQuantity ?? 0) <= 0
                }
            }
        )
    }

    return { success: true as const }
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

            const strictStockResult = await applyStockOnWebhook(
                order.eventId.toString(),
                order.cart,
                (order as { stockOverrideApproved?: boolean }).stockOverrideApproved ? "override" : "strict"
            )
            if (!strictStockResult.success) {
                console.warn("[SumUp Webhook] Stock shortage on strict mode, applying override fallback.", strictStockResult.shortages);
                await applyStockOnWebhook(order.eventId.toString(), order.cart, "override")
                order.set("stockOverrideApproved", true)
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
