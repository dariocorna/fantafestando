"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"

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
    paymentMethod: "CASH" | "CARD" | "OTHER"
}) {
    try {
        await dbConnect()
        const order = await Order.create({
            eventId: data.eventId,
            status: "PAID",
            customer: data.customer,
            totalAmount: data.totalAmount,
            cart: data.cart,
            paymentMethod: data.paymentMethod
        })

        // Trigger network printing
        await PrinterService.routeOrderToPrinters(order._id.toString());

        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString() }
    } catch (error) {
        console.error("Create Order Error:", error)
        return { success: false, error: "Failed to create order" }
    }
}

export async function triggerSumUpPayment(amount: number) {
    // In a real scenario, we would use the Terminal API or create a checkout
    // that the terminal is polling. For now, we simulate the Cloud API call.
    try {
        // Example: await sumupClient.checkouts.create(...)
        // But for Terminals, it's often a different endpoint /readers/checkout

        console.log(`[SumUp] Inizializzazione pagamento di ${amount}€ sul terminale...`);

        // Simulating network latency
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Implementation note: we would return a checkoutId or status
        return { success: true, status: "PENDING_ON_TERMINAL" };
    } catch (error) {
        console.error("SumUp Terminal Error:", error);
        return { success: false, error: "Errore comunicazione terminale" };
    }
}
