"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import Product from "@/models/Product"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import { getNextPublicOrderNumber, getOrderCodeFromOrder } from "@/lib/order-code"
import { getCurrentDayCode, isProductAvailableToday } from "@/lib/product-availability"

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
        if (!data.eventId || data.cart.length === 0) {
            return { success: false, error: "Carrello non valido" }
        }

        const hasInvalidItem = data.cart.some((item) =>
            !item.productId || !item.snapshotName || !Number.isFinite(item.quantity) || item.quantity < 1
        )
        if (hasInvalidItem) {
            return { success: false, error: "Carrello non valido" }
        }

        await dbConnect()
        const productIds = [...new Set(data.cart.map((item) => item.productId))]
        const products = await Product.find({
            eventId: data.eventId,
            _id: { $in: productIds }
        }).select("_id availableDays").lean() as Array<{ _id: unknown, availableDays?: string[] }>

        if (products.length !== productIds.length) {
            return { success: false, error: "Alcuni prodotti non sono più disponibili. Aggiorna il carrello." }
        }

        const currentDayCode = getCurrentDayCode("Europe/Rome")
        const productById = new Map(products.map((product) => [String(product._id), product]))
        const hasUnavailableProducts = data.cart.some((item) => {
            const product = productById.get(item.productId)
            if (!product) return true
            return !isProductAvailableToday(product.availableDays || [], currentDayCode)
        })

        if (hasUnavailableProducts) {
            return {
                success: false,
                error: "Alcuni prodotti non sono più disponibili oggi. Torna al menu e aggiorna il carrello."
            }
        }

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
