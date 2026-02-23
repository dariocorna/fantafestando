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
    type StockMode,
    type StockShortage
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
    interface StockAdjustment {
        productId: string
        quantity: number
    }

    interface WebhookStockOperationResult {
        success: boolean
        shortages?: StockShortage[]
        appliedAdjustments?: StockAdjustment[]
    }

    async function loadProductStocks(productIds: string[]): Promise<Map<string, ProductStockInfo>> {
        const docs = await Product.find({
            eventId,
            _id: { $in: productIds }
        }).select("_id name stockQuantity isSoldOut").lean() as Array<{
            _id: string | { toString(): string }
            name: string
            stockQuantity?: number | null
            isSoldOut?: boolean
        }>

        return new Map(
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
    }

    function splitMissingShortages(shortages: StockShortage[]) {
        const missing = shortages.filter((entry) => entry.productName === "Prodotto non trovato")
        const stock = shortages.filter((entry) => entry.productName !== "Prodotto non trovato")
        return { missing, stock }
    }

    async function syncSoldOutFlags(productIds: string[]) {
        const uniqueProductIds = [...new Set(productIds)]
        if (uniqueProductIds.length === 0) return

        const docs = await Product.find({
            eventId,
            _id: { $in: uniqueProductIds }
        }).select("_id stockQuantity").lean() as Array<{
            _id: string | { toString(): string }
            stockQuantity?: number | null
        }>

        for (const doc of docs) {
            const normalizedStock = normalizeStockQuantity(doc.stockQuantity ?? null)
            await Product.updateOne(
                { eventId, _id: doc._id.toString() },
                {
                    $set: {
                        stockQuantity: normalizedStock,
                        isSoldOut: normalizedStock !== null ? normalizedStock <= 0 : false
                    }
                }
            )
        }
    }

    function aggregateStockAdjustments(adjustments: StockAdjustment[]): StockAdjustment[] {
        const totals = new Map<string, number>()
        for (const adjustment of adjustments) {
            const productId = adjustment.productId?.trim()
            const quantity = Number(adjustment.quantity)
            if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue
            totals.set(productId, (totals.get(productId) || 0) + quantity)
        }
        return [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity }))
    }

    async function rollbackStockAdjustments(adjustments: StockAdjustment[]) {
        const aggregatedAdjustments = aggregateStockAdjustments(adjustments)
        if (aggregatedAdjustments.length === 0) return

        for (const adjustment of aggregatedAdjustments) {
            await Product.updateOne(
                { eventId, _id: adjustment.productId },
                { $inc: { stockQuantity: adjustment.quantity } }
            )
        }

        await syncSoldOutFlags(aggregatedAdjustments.map((entry) => entry.productId))
    }

    async function decrementTrackedStocksStrict(
        demands: Map<string, number>,
        productMap: Map<string, ProductStockInfo>
    ): Promise<WebhookStockOperationResult> {
        const applied: StockAdjustment[] = []

        for (const [productId, requestedQuantity] of demands.entries()) {
            const product = productMap.get(productId)
            if (!product || !isStockTracked(product.stockQuantity)) continue

            const updated = await Product.findOneAndUpdate(
                {
                    eventId,
                    _id: productId,
                    stockQuantity: { $gte: requestedQuantity }
                },
                { $inc: { stockQuantity: -requestedQuantity } },
                { new: true }
            ).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

            if (!updated) {
                await rollbackStockAdjustments(applied)

                const refreshedStocks = await loadProductStocks([...demands.keys()])
                const refreshedShortages = collectStockShortages(demands, refreshedStocks)
                return {
                    success: false,
                    shortages: refreshedShortages,
                    appliedAdjustments: []
                }
            }

            applied.push({ productId, quantity: requestedQuantity })
        }

        await syncSoldOutFlags(applied.map((entry) => entry.productId))
        return { success: true, appliedAdjustments: applied }
    }

    async function decrementTrackedStocksOverride(
        demands: Map<string, number>,
        productMap: Map<string, ProductStockInfo>
    ): Promise<WebhookStockOperationResult> {
        const touched: string[] = []
        const applied: StockAdjustment[] = []

        for (const [productId, requestedQuantity] of demands.entries()) {
            const stockInfo = productMap.get(productId)
            if (!stockInfo || !isStockTracked(stockInfo.stockQuantity)) continue

            const latestDoc = await Product.findOne({
                eventId,
                _id: productId
            }).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

            if (!latestDoc) {
                await rollbackStockAdjustments(applied)
                return {
                    success: false,
                    shortages: [{
                        productId,
                        productName: stockInfo.name,
                        requestedQuantity,
                        availableQuantity: 0
                    }],
                    appliedAdjustments: []
                }
            }

            const currentStock = normalizeStockQuantity(latestDoc.stockQuantity ?? null)
            if (!isStockTracked(currentStock)) continue

            const result = applyStockDecrement(currentStock, requestedQuantity, "override")
            await Product.updateOne(
                { eventId, _id: productId },
                {
                    $set: {
                        stockQuantity: result.nextStockQuantity,
                        isSoldOut: (result.nextStockQuantity ?? 0) <= 0
                    }
                }
            )

            if (result.appliedQuantity > 0) {
                applied.push({ productId, quantity: result.appliedQuantity })
            }
            touched.push(productId)
        }

        await syncSoldOutFlags(touched)
        return { success: true, appliedAdjustments: applied }
    }

    const demands = aggregateCartQuantities(
        cart.map((item) => ({
            productId: item.productId.toString(),
            quantity: item.quantity,
            snapshotName: item.snapshotName
        }))
    )
    if (demands.size === 0) {
        return { success: true as const, appliedAdjustments: [] }
    }

    const productIds = [...demands.keys()]
    const productMap = await loadProductStocks(productIds)

    const shortages = collectStockShortages(demands, productMap)
    const { missing, stock } = splitMissingShortages(shortages)

    if (missing.length > 0) {
        return {
            success: false as const,
            shortages,
            appliedAdjustments: []
        }
    }

    if (mode === "strict" && stock.length > 0) {
        return {
            success: false as const,
            shortages: stock,
            appliedAdjustments: []
        }
    }

    if (mode === "strict") {
        return decrementTrackedStocksStrict(demands, productMap)
    }

    return decrementTrackedStocksOverride(demands, productMap)
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

            const preferredMode: StockMode = (order as { stockOverrideApproved?: boolean }).stockOverrideApproved ? "override" : "strict"
            let appliedAdjustmentsToRollback: Array<{ productId: string, quantity: number }> = []
            const strictStockResult = await applyStockOnWebhook(
                order.eventId.toString(),
                order.cart,
                preferredMode
            )
            if (!strictStockResult.success) {
                if (preferredMode === "strict") {
                    console.warn("[SumUp Webhook] Stock shortage in strict mode, applying override fallback.", strictStockResult.shortages);
                    const overrideResult = await applyStockOnWebhook(order.eventId.toString(), order.cart, "override")
                    if (!overrideResult.success) {
                        console.error("[SumUp Webhook] Override stock apply failed.", overrideResult.shortages)
                        return NextResponse.json({ error: "Stock apply failed" }, { status: 409 })
                    }
                    appliedAdjustmentsToRollback = overrideResult.appliedAdjustments || []
                    order.set("stockOverrideApproved", true)
                } else {
                    console.error("[SumUp Webhook] Stock apply failed in override mode.", strictStockResult.shortages)
                    return NextResponse.json({ error: "Stock apply failed" }, { status: 409 })
                }
            } else {
                appliedAdjustmentsToRollback = strictStockResult.appliedAdjustments || []
            }

            // Aggiorna lo stato dell'ordine
            order.status = "PAID";
            try {
                await order.save();
            } catch (saveError) {
                if (appliedAdjustmentsToRollback.length > 0) {
                    const totals = new Map<string, number>()
                    for (const entry of appliedAdjustmentsToRollback) {
                        const productId = entry.productId?.trim()
                        const quantity = Number(entry.quantity)
                        if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue
                        totals.set(productId, (totals.get(productId) || 0) + quantity)
                    }

                    const aggregatedAdjustments = [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity }))
                    for (const entry of aggregatedAdjustments) {
                        await Product.updateOne(
                            { eventId: order.eventId, _id: entry.productId },
                            { $inc: { stockQuantity: entry.quantity } }
                        )
                    }
                    const touchedIds = aggregatedAdjustments.map((entry) => entry.productId)
                    if (touchedIds.length > 0) {
                        const docs = await Product.find({
                            eventId: order.eventId,
                            _id: { $in: touchedIds }
                        }).select("_id stockQuantity").lean() as Array<{
                            _id: string | { toString(): string }
                            stockQuantity?: number | null
                        }>

                        for (const doc of docs) {
                            const normalizedStock = normalizeStockQuantity(doc.stockQuantity ?? null)
                            await Product.updateOne(
                                { eventId: order.eventId, _id: doc._id.toString() },
                                {
                                    $set: {
                                        stockQuantity: normalizedStock,
                                        isSoldOut: normalizedStock !== null ? normalizedStock <= 0 : false
                                    }
                                }
                            )
                        }
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
