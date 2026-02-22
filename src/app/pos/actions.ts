"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import PosDevice from "@/models/PosDevice"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import { createSumUpCheckout } from "@/lib/sumup"
import { decryptSecret } from "@/lib/secrets"

interface PosPaymentCapabilities {
    hasCashBox: boolean
    hasPaymentTerminal: boolean
}

async function getPosPaymentCapabilities(eventId: string, posDeviceId?: string): Promise<
    { success: true, capabilities: PosPaymentCapabilities } | { success: false, error: string }
> {
    if (!eventId) {
        return { success: false, error: "Evento non valido" }
    }

    if (!posDeviceId) {
        return { success: false, error: "Seleziona una cassa prima di completare il pagamento" }
    }

    await dbConnect()
    const posDevice = await PosDevice.findOne({ _id: posDeviceId, eventId })
        .populate({ path: "paymentTerminalId", select: "_id" })
        .populate({ path: "cashBoxId", select: "_id" })
        .lean() as ({ paymentTerminalId?: unknown, cashBoxId?: unknown } | null)

    if (!posDevice) {
        return { success: false, error: "La cassa selezionata non è valida per l'evento corrente" }
    }

    return {
        success: true,
        capabilities: {
            hasCashBox: Boolean(posDevice.cashBoxId),
            hasPaymentTerminal: Boolean(posDevice.paymentTerminalId)
        }
    }
}

function validatePaymentMethodAvailability(
    paymentMethod: "CASH" | "CARD" | "OTHER",
    capabilities: PosPaymentCapabilities
): string | null {
    if (paymentMethod === "CASH" && !capabilities.hasCashBox) {
        return "La cassa selezionata non ha una cassetta contanti associata"
    }

    if (paymentMethod === "CARD" && !capabilities.hasPaymentTerminal) {
        return "La cassa selezionata non ha un terminale elettronico associato"
    }

    return null
}

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
        const capabilitiesResult = await getPosPaymentCapabilities(data.eventId, data.posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        const paymentValidationError = validatePaymentMethodAvailability(data.paymentMethod, capabilitiesResult.capabilities)
        if (paymentValidationError) {
            return { success: false, error: paymentValidationError }
        }

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
            await PrinterService.routeOrderToPrinters(order._id.toString(), data.posDeviceId)
        }

        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString() }
    } catch (error) {
        console.error("Create Order Error:", error)
        return { success: false, error: "Failed to create order" }
    }
}

export async function triggerSumUpPayment(amount: number, eventId: string, posDeviceId?: string) {
    try {
        const capabilitiesResult = await getPosPaymentCapabilities(eventId, posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        if (!capabilitiesResult.capabilities.hasPaymentTerminal) {
            return { success: false, error: "La cassa selezionata non supporta i pagamenti elettronici" }
        }

        await dbConnect()
        const posDevice = await PosDevice.findOne({ _id: posDeviceId, eventId })
            .populate({ path: "paymentTerminalId", select: "name type config" })
            .lean() as (
                {
                    name?: string
                    paymentTerminalId?: {
                        name?: string
                        type?: string
                        config?: { merchantId?: string, affiliateKey?: string }
                    } | null
                } | null
            )

        const terminal = posDevice?.paymentTerminalId
        const merchantId = terminal?.config?.merchantId?.trim()
        const decryptedApiKey = decryptSecret(terminal?.config?.affiliateKey)

        if (!terminal || terminal.type !== "SUMUP") {
            return { success: false, error: "Terminale elettronico non valido o non configurato come SumUp" }
        }

        if (!merchantId || !decryptedApiKey) {
            return { success: false, error: "Configurazione SumUp mancante nella periferica associata alla cassa" }
        }

        console.log(`[SumUp] Inizializzazione pagamento di ${amount}€ su ${terminal.name || posDevice?.name || "POS"}...`)

        const result = await createSumUpCheckout(
            amount,
            "EUR",
            merchantId,
            decryptedApiKey
        )

        if (!result.success) {
            return { success: false, error: result.error }
        }

        return { success: true, checkoutId: result.id }
    } catch (error) {
        console.error("SumUp Context Error:", error)
        return { success: false, error: "Errore durante l'inizializzazione del pagamento" }
    }
}

export async function loadPendingOrderByCode(data: {
    eventId: string
    code: string
}) {
    try {
        const normalizedCode = data.code.trim().toUpperCase()
        if (!data.eventId) {
            return { success: false, error: "Evento non valido" }
        }

        if (!normalizedCode || normalizedCode.length < 4) {
            return { success: false, error: "Inserisci un codice ordine valido" }
        }

        await dbConnect()
        const pendingOrders = await Order.find({ eventId: data.eventId, status: "PENDING" })
            .sort({ createdAt: -1 })
            .limit(500)
            .lean()

        const foundOrder = pendingOrders.find(order => order._id.toString().slice(-4).toUpperCase() === normalizedCode)
        if (!foundOrder) {
            return { success: false, error: `Nessun ordine in attesa trovato per il codice ${normalizedCode}` }
        }

        return {
            success: true,
            order: {
                id: foundOrder._id.toString(),
                code: normalizedCode,
                totalAmount: foundOrder.totalAmount,
                customer: {
                    name: foundOrder.customer?.name,
                    table: foundOrder.customer?.table
                },
                items: foundOrder.cart.map((item: { snapshotName: string, quantity: number }) => ({
                    snapshotName: item.snapshotName,
                    quantity: item.quantity
                }))
            }
        }
    } catch (error) {
        console.error("Load Pending Order Error:", error)
        return { success: false, error: "Errore durante il caricamento ordine" }
    }
}

export async function completePendingOrderPayment(data: {
    eventId: string
    orderId: string
    paymentMethod: "CASH" | "CARD"
    posDeviceId?: string
}) {
    try {
        if (!data.eventId || !data.orderId) {
            return { success: false, error: "Dati ordine incompleti" }
        }

        const capabilitiesResult = await getPosPaymentCapabilities(data.eventId, data.posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        const paymentValidationError = validatePaymentMethodAvailability(data.paymentMethod, capabilitiesResult.capabilities)
        if (paymentValidationError) {
            return { success: false, error: paymentValidationError }
        }

        await dbConnect()
        const order = await Order.findOne({ _id: data.orderId, eventId: data.eventId, status: "PENDING" })
        if (!order) {
            return { success: false, error: "Ordine non trovato o già chiuso" }
        }

        order.status = "PAID"
        order.paymentMethod = data.paymentMethod
        order.set("posDeviceId", data.posDeviceId || undefined)
        await order.save()

        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString() }
    } catch (error) {
        console.error("Complete Pending Order Error:", error)
        return { success: false, error: "Errore durante la chiusura dell'ordine" }
    }
}
