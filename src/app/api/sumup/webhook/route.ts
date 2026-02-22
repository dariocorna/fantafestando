import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { PrinterService } from "@/lib/printer";

export async function POST(req: NextRequest) {
    try {
        const payload = await req.json();
        console.log("[SumUp Webhook] Ricevuto payload:", JSON.stringify(payload));

        // In a real production app, you should verify the webhook signature here
        // using the signing secret provided in the SumUp dashboard.

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
