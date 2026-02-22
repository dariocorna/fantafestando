"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import { getNextPublicOrderNumber, getOrderCodeFromOrder } from "@/lib/order-code"

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
        const pickupNumber = await getNextPublicOrderNumber(data.eventId)

        // Create the order with PENDING status
        const order = await Order.create({
            eventId: data.eventId,
            pickupNumber,
            status: "PENDING",
            customer: data.customer,
            totalAmount: data.totalAmount,
            cart: data.cart
        })

        // Per il flusso WebApp la comanda viene inoltrata subito ai reparti.
        // Se la stampa fallisce, l'ordine resta comunque valido e viene creato.
        try {
            await PrinterService.routeOrderToPrinters(order._id.toString());
        } catch (printError) {
            console.error("Public order created but printer routing failed:", printError);
        }

        const shortCode = getOrderCodeFromOrder({ pickupNumber: order.pickupNumber, _id: order._id })

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
