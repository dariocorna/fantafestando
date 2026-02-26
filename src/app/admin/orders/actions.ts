"use server"

import dbConnect from "@/lib/mongoose";
import { getAdminContextEventId } from "@/lib/events";
import { ensureAdminSession } from "@/lib/authz";
import Order from "@/models/Order";
import PosDevice from "@/models/PosDevice";
import "@/models/Peripheral";
import { PrinterService } from "@/lib/printer";
import { decryptSecret } from "@/lib/secrets";
import { refundSumUpTransaction, resolveSumUpTransactionIdByCheckout } from "@/lib/sumup";
import { rollbackStockAdjustments, type StockAdjustment } from "@/lib/stock-operations";
import { revalidatePath } from "next/cache";

interface OrderForStornoProjection {
    _id: string | { toString(): string }
    status: "PENDING" | "PAID" | "CANCELLED"
    paymentMethod?: "CASH" | "CARD" | "OTHER"
    totalAmount?: number
    sumupCheckoutId?: string
    sumupPaymentId?: string
    posDeviceId?: string | { toString(): string }
    cart: Array<{
        productId: string | { toString(): string }
        quantity?: number
    }>
    stornoMeta?: {
        status?: "IN_PROGRESS" | "COMPLETED" | "FAILED"
        refundStatus?: "SKIPPED" | "DONE" | "FAILED"
        refundTransactionId?: string
    }
}

function buildStockAdjustmentsFromOrder(order: OrderForStornoProjection): StockAdjustment[] {
    return order.cart
        .map((item) => ({
            productId: item.productId?.toString(),
            quantity: Math.max(0, Math.floor(Number(item.quantity ?? 0)))
        }))
        .filter((entry) => Boolean(entry.productId) && entry.quantity > 0) as StockAdjustment[]
}

async function resolveSumUpApiKeyForOrder(eventId: string, posDeviceId?: string): Promise<
    { success: true, apiKey: string }
    | { success: false, error: string }
> {
    if (!posDeviceId) {
        return { success: false, error: "Ordine carta senza punto cassa associato" }
    }

    const posDevice = await PosDevice.findOne({ _id: posDeviceId, eventId })
        .populate({ path: "paymentTerminalId", select: "type config" })
        .lean() as (
            {
                paymentTerminalId?: {
                    type?: string
                    config?: { affiliateKey?: string }
                } | null
            } | null
        )

    const terminal = posDevice?.paymentTerminalId
    if (!terminal || terminal.type !== "SUMUP") {
        return { success: false, error: "Terminale SumUp non disponibile per l'ordine da stornare" }
    }

    const apiKey = decryptSecret(terminal.config?.affiliateKey)
    if (!apiKey) {
        return { success: false, error: "Configurazione API key SumUp mancante" }
    }

    return { success: true, apiKey }
}

export async function reprintOrderById(orderId: string) {
    const sessionCheck = await ensureAdminSession()
    if (!sessionCheck.ok) {
        return { success: false, error: sessionCheck.error }
    }

    const normalizedOrderId = orderId?.trim()
    if (!normalizedOrderId) {
        return { success: false, error: "Ordine non valido" }
    }

    await PrinterService.routeOrderToPrinters(normalizedOrderId);
    revalidatePath("/admin/orders");
    return { success: true };
}

export async function reprintOrder(formData: FormData) {
    const orderId = formData.get("orderId") as string;
    if (!orderId) return { success: false, error: "Ordine non valido" };

    return await reprintOrderById(orderId);
}

export async function stornoPaidOrderById(orderId: string, reason?: string) {
    const sessionCheck = await ensureAdminSession()
    if (!sessionCheck.ok) {
        return { success: false, error: sessionCheck.error }
    }

    const normalizedOrderId = orderId?.trim()
    if (!normalizedOrderId) {
        return { success: false, error: "Ordine non valido" }
    }

    const normalizedReason = reason?.trim()
    const eventId = await getAdminContextEventId()
    if (!eventId) {
        return { success: false, error: "Nessuna festa selezionata nel contesto admin" }
    }

    try {
        await dbConnect()
        const now = new Date()
        const lockSetPayload: Record<string, unknown> = {
            "stornoMeta.status": "IN_PROGRESS",
            "stornoMeta.requestedAt": now,
            "stornoMeta.requestedBy": "admin"
        }
        if (normalizedReason) {
            lockSetPayload["stornoMeta.reason"] = normalizedReason
        }

        const lockedOrder = await Order.findOneAndUpdate(
            {
                _id: normalizedOrderId,
                eventId,
                status: "PAID",
                $or: [
                    { "stornoMeta.status": { $exists: false } },
                    { "stornoMeta.status": "FAILED" }
                ]
            },
            {
                $set: lockSetPayload
            },
            { returnDocument: "after" }
        ).lean() as OrderForStornoProjection | null

        if (!lockedOrder) {
            const existingOrder = await Order.findOne({
                _id: normalizedOrderId,
                eventId
            }).select("status stornoMeta").lean() as (
                {
                    status?: string
                    stornoMeta?: { status?: string }
                } | null
            )

            if (!existingOrder) {
                return { success: false, error: "Ordine non trovato per la festa selezionata" }
            }

            if (existingOrder.status === "CANCELLED" && existingOrder.stornoMeta?.status === "COMPLETED") {
                return { success: true, alreadyCancelled: true }
            }

            if (existingOrder.stornoMeta?.status === "IN_PROGRESS") {
                return { success: false, error: "Storno già in corso per questo ordine" }
            }

            return { success: false, error: "Solo gli ordini pagati possono essere stornati" }
        }

        let refundStatus: "SKIPPED" | "DONE" | "FAILED" = lockedOrder.paymentMethod === "CARD" ? "FAILED" : "SKIPPED"
        let refundTransactionId = lockedOrder.stornoMeta?.refundTransactionId?.trim()

        if (lockedOrder.paymentMethod === "CARD") {
            const refundAlreadyDone = lockedOrder.stornoMeta?.refundStatus === "DONE" && Boolean(refundTransactionId)

            if (!refundAlreadyDone) {
                const apiKeyResult = await resolveSumUpApiKeyForOrder(eventId, lockedOrder.posDeviceId?.toString())
                if (!apiKeyResult.success) {
                    await Order.updateOne(
                        { _id: normalizedOrderId, eventId },
                        {
                            $set: {
                                "stornoMeta.status": "FAILED",
                                "stornoMeta.refundRequired": true,
                                "stornoMeta.refundStatus": "FAILED",
                                "stornoMeta.refundError": apiKeyResult.error
                            }
                        }
                    )
                    return { success: false, error: apiKeyResult.error }
                }

                let transactionId = lockedOrder.sumupPaymentId?.trim() || refundTransactionId
                if (!transactionId && lockedOrder.sumupCheckoutId?.trim()) {
                    const resolveResult = await resolveSumUpTransactionIdByCheckout(
                        lockedOrder.sumupCheckoutId,
                        apiKeyResult.apiKey
                    )
                    if (!resolveResult.success || !resolveResult.transactionId) {
                        await Order.updateOne(
                            { _id: normalizedOrderId, eventId },
                            {
                                $set: {
                                    "stornoMeta.status": "FAILED",
                                    "stornoMeta.refundRequired": true,
                                    "stornoMeta.refundStatus": "FAILED",
                                    "stornoMeta.refundError": resolveResult.error || "Impossibile recuperare transazione SumUp"
                                }
                            }
                        )
                        return {
                            success: false,
                            error: resolveResult.error || "Impossibile recuperare transazione SumUp"
                        }
                    }
                    transactionId = resolveResult.transactionId
                }

                if (!transactionId) {
                    await Order.updateOne(
                        { _id: normalizedOrderId, eventId },
                        {
                            $set: {
                                "stornoMeta.status": "FAILED",
                                "stornoMeta.refundRequired": true,
                                "stornoMeta.refundStatus": "FAILED",
                                "stornoMeta.refundError": "Transaction id SumUp mancante"
                            }
                        }
                    )
                    return { success: false, error: "Transaction id SumUp mancante" }
                }

                const refundResult = await refundSumUpTransaction({
                    transactionId,
                    apiKey: apiKeyResult.apiKey,
                    amount: lockedOrder.totalAmount
                })

                if (!refundResult.success) {
                    await Order.updateOne(
                        { _id: normalizedOrderId, eventId },
                        {
                            $set: {
                                "stornoMeta.status": "FAILED",
                                "stornoMeta.refundRequired": true,
                                "stornoMeta.refundStatus": "FAILED",
                                "stornoMeta.refundTransactionId": transactionId,
                                "stornoMeta.refundError": refundResult.error || "Errore rimborso SumUp"
                            }
                        }
                    )
                    return { success: false, error: refundResult.error || "Errore rimborso SumUp" }
                }

                refundStatus = "DONE"
                refundTransactionId = transactionId
            } else {
                refundStatus = "DONE"
            }
        }

        const stockAdjustments = buildStockAdjustmentsFromOrder(lockedOrder)
        try {
            await rollbackStockAdjustments(eventId, stockAdjustments)
        } catch (rollbackError) {
            await Order.updateOne(
                { _id: normalizedOrderId, eventId },
                {
                    $set: {
                        "stornoMeta.status": "FAILED",
                        "stornoMeta.refundRequired": lockedOrder.paymentMethod === "CARD",
                        "stornoMeta.refundStatus": refundStatus,
                        "stornoMeta.refundTransactionId": refundTransactionId,
                        "stornoMeta.refundError": "Ripristino scorte non riuscito"
                    }
                }
            )
            console.error("Storno rollback stock error:", rollbackError)
            return { success: false, error: "Ripristino scorte non riuscito" }
        }

        await Order.updateOne(
            { _id: normalizedOrderId, eventId },
            {
                $set: {
                    status: "CANCELLED",
                    "stornoMeta.status": "COMPLETED",
                    "stornoMeta.reason": normalizedReason || undefined,
                    "stornoMeta.completedAt": new Date(),
                    "stornoMeta.refundRequired": lockedOrder.paymentMethod === "CARD",
                    "stornoMeta.refundStatus": refundStatus,
                    "stornoMeta.refundTransactionId": refundTransactionId
                },
                $unset: {
                    "stornoMeta.refundError": 1
                }
            }
        )

        revalidatePath("/admin/orders")
        revalidatePath("/admin")
        return { success: true }
    } catch (error) {
        try {
            await Order.updateOne(
                {
                    _id: normalizedOrderId,
                    eventId,
                    "stornoMeta.status": "IN_PROGRESS"
                },
                {
                    $set: {
                        "stornoMeta.status": "FAILED",
                        "stornoMeta.refundError": "Errore interno inatteso durante lo storno"
                    }
                }
            )
        } catch (stornoUpdateError) {
            console.error("Storno fallback status update error:", stornoUpdateError)
        }
        console.error("Storno Order Error:", error)
        return { success: false, error: "Errore interno durante lo storno ordine" }
    }
}

export async function stornoPaidOrder(formData: FormData) {
    const orderId = formData.get("orderId") as string
    const reason = formData.get("reason") as string | null
    return await stornoPaidOrderById(orderId, reason || undefined)
}
