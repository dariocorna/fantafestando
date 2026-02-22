"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import Event from "@/models/Event"
import { createSumUpCheckout } from "@/lib/sumup"

export async function createOrder(data: {
    eventId: string,
    customer: { name?: string, table?: string },
    totalAmount: number,
    cart: Array<{
        productId: string,
        snapshotName: string,
        quantity: number,
        selectedOptions: Array<{ name: string, priceVariation: number }>
    }>,
    paymentMethod: "CASH" | "CARD" | "OTHER",
    sumupCheckoutId?: string,
    posDeviceId?: string
}) {
    try {
        await dbConnect()
        const order = await Order.create({
            eventId: data.eventId,
            status: data.paymentMethod === "CARD" ? "PENDING" : "PAID",
            customer: data.customer,
            totalAmount: data.totalAmount,
            cart: data.cart,
            paymentMethod: data.paymentMethod,
            sumupCheckoutId: data.sumupCheckoutId,
            posDeviceId: data.posDeviceId
        })

        // Trigger network printing ONLY if PAID immediately
        if (order.status === "PAID") {
            await PrinterService.routeOrderToPrinters(order._id.toString(), data.posDeviceId);
        }

        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString() }
    } catch (error) {
        console.error("Create Order Error:", error)
        return { success: false, error: "Failed to create order" }
    }
}

export async function triggerSumUpPayment(amount: number, eventId: string) {
    try {
        await dbConnect();
        const event = await Event.findById(eventId).lean() as any;
        if (!event || !event.settings?.sumupMerchantCode || !event.settings?.sumupApiKey) {
            return { success: false, error: "Configurazione SumUp mancante per questa festa" };
        }

        console.log(`[SumUp] Inizializzazione pagamento di ${amount}€ per ${event.name}...`);

        const result = await createSumUpCheckout(
            amount,
            "EUR",
            event.settings.sumupMerchantCode,
            event.settings.sumupApiKey
        );

        if (!result.success) {
            return { success: false, error: result.error };
        }

        return { success: true, checkoutId: result.id };
    } catch (error) {
        console.error("SumUp Context Error:", error);
        return { success: false, error: "Errore durante l'inizializzazione del pagamento" };
    }
}
