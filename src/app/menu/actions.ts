"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"

export async function createPublicOrder(data: {
    eventId: string,
    customer: { name?: string, table?: string },
    totalAmount: number,
    cart: Array<{
        productId: string,
        snapshotName: string,
        quantity: number,
        selectedOptions: Array<{ name: string, priceVariation: number }>
    }>
}) {
    try {
        await dbConnect()

        // Create the order with PENDING status
        const order = await Order.create({
            eventId: data.eventId,
            status: "PENDING",
            customer: data.customer,
            totalAmount: data.totalAmount,
            cart: data.cart
        })

        // Per il flusso WebApp la comanda viene inoltrata subito ai reparti.
        await PrinterService.routeOrderToPrinters(order._id.toString());

        // We could generate a simpler shortCode if needed, 
        // but for now we'll use the first 4 chars of the ID as a reference
        const shortCode = order._id.toString().slice(-4).toUpperCase()

        revalidatePath("/admin/orders")
        return {
            success: true,
            orderId: order._id.toString(),
            shortCode: shortCode
        }
    } catch (error) {
        console.error("Create Public Order Error:", error)
        return { success: false, error: "Non è stato possibile inviare l'ordine. Riprova." }
    }
}
