"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import { revalidatePath } from "next/cache"

export async function createOrder(data: {
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
        const order = await Order.create({
            eventId: data.eventId,
            status: "PAID", // Default to PAID for POS checkout for now
            customer: data.customer,
            totalAmount: data.totalAmount,
            cart: data.cart
        })
        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString() }
    } catch (error) {
        console.error("Create Order Error:", error)
        return { success: false, error: "Failed to create order" }
    }
}
