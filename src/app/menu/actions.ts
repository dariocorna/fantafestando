"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import Product from "@/models/Product"
import Event from "@/models/Event"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import { getNextPublicOrderNumber, getOrderCodeFromOrder } from "@/lib/order-code"
import { getCurrentDayCode, isProductAvailableToday } from "@/lib/product-availability"
import { createEasterEggUploadToken } from "@/lib/easter-egg-order"
import {
    aggregateCartQuantities,
    collectStockShortages,
    normalizeStockQuantity,
    type ProductStockInfo,
    type StockShortage
} from "@/lib/inventory"

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
    const formatShortagesError = (shortages: StockShortage[]) => {
        if (shortages.length === 0) {
            return "Alcuni prodotti non sono più disponibili nelle quantità richieste. Aggiorna il carrello."
        }

        const names = shortages
            .map((entry) => entry.productName)
            .filter((name) => Boolean(name && name.trim()))
            .slice(0, 3)

        if (names.length === 0) {
            return "Alcuni prodotti non sono più disponibili nelle quantità richieste. Aggiorna il carrello."
        }

        const suffix = shortages.length > names.length ? ", ..." : ""
        return `Scorte insufficienti per: ${names.join(", ")}${suffix}. Aggiorna il carrello.`
    }

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
        const event = await Event.findById(data.eventId)
            .select("settings.portalEasterEggEnabled")
            .lean() as ({ settings?: { portalEasterEggEnabled?: boolean } } | null)
        if (!event) {
            return { success: false, error: "Evento non valido" }
        }

        const productIds = [...new Set(data.cart.map((item) => item.productId))]
        const products = await Product.find({
            eventId: data.eventId,
            _id: { $in: productIds }
        }).select("_id name availableDays stockQuantity isSoldOut").lean() as Array<{
            _id: unknown
            name: string
            availableDays?: string[]
            stockQuantity?: number | null
            isSoldOut?: boolean
        }>

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

        const demands = aggregateCartQuantities(
            data.cart.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                snapshotName: item.snapshotName
            }))
        )
        const productStockMap = new Map<string, ProductStockInfo>(
            products.map((product) => [
                String(product._id),
                {
                    id: String(product._id),
                    name: product.name,
                    stockQuantity: normalizeStockQuantity(product.stockQuantity ?? null),
                    isSoldOut: Boolean(product.isSoldOut)
                }
            ])
        )
        const stockShortages = collectStockShortages(demands, productStockMap)
        if (stockShortages.length > 0) {
            return {
                success: false,
                error: formatShortagesError(stockShortages),
                stockShortages
            }
        }

        const pickupNumber = await getNextPublicOrderNumber(data.eventId)
        const easterEggUpload = event.settings?.portalEasterEggEnabled
            ? createEasterEggUploadToken()
            : null

        // Create the order with PENDING status
        const order = await Order.create({
            eventId: data.eventId,
            pickupNumber,
            status: "PENDING",
            customer: data.customer,
            totalAmount: data.totalAmount,
            cart: data.cart,
            easterEggAttachment: easterEggUpload
                ? {
                    uploadTokenHash: easterEggUpload.hash
                }
                : undefined
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
            shortCode: shortCode,
            easterEggUpload: easterEggUpload
                ? {
                    orderId: order._id.toString(),
                    token: easterEggUpload.token
                }
                : undefined
        }
    } catch (error) {
        console.error("Create Public Order Error:", error)
        return { success: false, error: "Non è stato possibile inviare l'ordine. Riprova." }
    }
}
