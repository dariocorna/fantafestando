"use server"

import dbConnect from "@/lib/mongoose";
import { getAdminContextEventId } from "@/lib/events";
import { ensureAdminSession } from "@/lib/authz";
import { validateOrderResetConfirmationToken } from "@/lib/order-reset";
import Order from "@/models/Order";
import OrderCounter from "@/models/OrderCounter";
import PrintJob from "@/models/PrintJob";
import CashSession from "@/models/CashSession";
import PosDevice from "@/models/PosDevice";
import "@/models/Peripheral";
import { PrinterService } from "@/lib/printer";
import { recoverStaleManualPrintRetryClaims } from "@/lib/print-queue";
import { decryptSecret } from "@/lib/secrets";
import { refundSumUpTransaction, resolveSumUpTransactionIdByCheckout } from "@/lib/sumup";
import { getSumUpRefundState } from "@/lib/sumup-refund";
import { type StockAdjustment } from "@/lib/stock-operations";
import { transitionClaimedOrderStock } from "@/lib/cash-session-stock";
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
    ingredientPlan?: Array<{
        ingredientId?: string | { toString(): string }
        quantity?: number
    }>
    stockAdjustments?: StockAdjustment[]
    stockEffectStatus?: "APPLIED" | "REVERTED"
    stornoMeta?: {
        status?: "IN_PROGRESS" | "COMPLETED" | "FAILED"
        requestedAt?: Date
        refundStatus?: "SKIPPED" | "DONE" | "FAILED"
        refundTransactionId?: string
    }
}

const STORNO_LEASE_MS = 5 * 60 * 1000

function buildStockAdjustmentsFromOrder(order: OrderForStornoProjection): StockAdjustment[] {
    const productAdjustments = order.cart
        .map((item) => ({
            entityType: "PRODUCT" as const,
            entityId: item.productId?.toString(),
            quantity: Math.max(0, Math.floor(Number(item.quantity ?? 0)))
        }))
        .filter((entry) => Boolean(entry.entityId) && entry.quantity > 0) as StockAdjustment[]

    const ingredientAdjustments = (order.ingredientPlan || [])
        .map((entry) => ({
            entityType: "INGREDIENT" as const,
            entityId: entry.ingredientId?.toString(),
            quantity: Math.max(0, Math.floor(Number(entry.quantity ?? 0)))
        }))
        .filter((entry) => Boolean(entry.entityId) && entry.quantity > 0) as StockAdjustment[]

    return [...productAdjustments, ...ingredientAdjustments]
}

async function resolveSumUpCredentialsForOrder(eventId: string, posDeviceId?: string): Promise<
    { success: true, apiKey: string, merchantCode: string }
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
                    config?: { apiKey?: string, merchantCode?: string }
                } | null
            } | null
        )

    const terminal = posDevice?.paymentTerminalId
    if (!terminal || terminal.type !== "SUMUP") {
        return { success: false, error: "Terminale SumUp non disponibile per l'ordine da stornare" }
    }

    const apiKey = decryptSecret(terminal.config?.apiKey)
    if (!apiKey) {
        return { success: false, error: "Configurazione API key SumUp mancante" }
    }

    const merchantCode = terminal.config?.merchantCode?.trim()
    if (!merchantCode) {
        return { success: false, error: "Configurazione merchant code SumUp mancante" }
    }

    return { success: true, apiKey, merchantCode }
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

    try {
        const eventId = await getAdminContextEventId()
        if (!eventId) {
            return { success: false, error: "Nessuna festa selezionata nel contesto admin" }
        }

        await dbConnect()
        const order = await Order.findOne({
            _id: normalizedOrderId,
            eventId,
            status: "PAID"
        }).select("posDeviceId").lean() as ({
            posDeviceId?: string | { toString(): string }
        } | null)
        if (!order) {
            return { success: false, error: "Ordine pagato non trovato nella festa selezionata" }
        }

        await recoverStaleManualPrintRetryClaims(eventId, normalizedOrderId)
        const existingPrintJobs = await PrintJob.find({
            eventId,
            orderId: normalizedOrderId,
            source: "ORDER",
            status: { $in: ["FAILED", "HELD", "QUEUED"] }
        })
            .sort({ createdAt: 1 })
            .select("_id status")
            .lean() as Array<{ _id: string | { toString(): string }; status?: "FAILED" | "HELD" | "QUEUED" }>

        if (existingPrintJobs.some((job) => job.status === "HELD" || job.status === "QUEUED")) {
            return {
                success: false,
                error: "Ci sono già stampe in coda o in attesa per questo ordine. Attendi il completamento prima di ristampare."
            }
        }

        const failedJobs = existingPrintJobs.filter((job) => !job.status || job.status === "FAILED")

        if (failedJobs.length > 0) {
            const retryResults = []
            for (const job of failedJobs) {
                retryResults.push(await PrinterService.retryPrintJobById(eventId, job._id.toString()))
            }

            revalidatePath("/admin/orders")
            const failedCount = retryResults.filter((result) => !result.success).length
            if (failedCount > 0) {
                return {
                    success: false,
                    error: `Reinvio non completato: ${failedCount} ${failedCount === 1 ? "copia non inviata" : "copie non inviate"}. Riprova.`
                }
            }

            return { success: true }
        }

        const printResults = await PrinterService.routeOrderToPrinters(
            normalizedOrderId,
            order.posDeviceId?.toString()
        )
        if (!printResults?.length) {
            return { success: false, error: "Nessuna stampa generata per l'ordine" }
        }
        if (printResults.some((printed) => !printed)) {
            return {
                success: false,
                error: "Ristampa non completata. Riprova: verranno reinviate solo le copie fallite."
            }
        }

        revalidatePath("/admin/orders")
        return { success: true }
    } catch (error) {
        console.error("Order reprint error:", error)
        return { success: false, error: "Errore interno durante la ristampa dell'ordine" }
    }
}

export async function reprintOrder(formData: FormData) {
    const orderId = formData.get("orderId") as string;
    if (!orderId) return { success: false, error: "Ordine non valido" };

    return await reprintOrderById(orderId);
}

export async function resetEventOrdersAction(formData: FormData): Promise<
    { success: true; summary: { deletedOrders: number, deletedOrderCounters: number, deletedPrintJobs: number, deletedCashSessions: number } }
    | { success: false; error: string }
> {
    const sessionCheck = await ensureAdminSession()
    if (!sessionCheck.ok) {
        return { success: false, error: sessionCheck.error }
    }

    const rawConfirmationToken = formData.get("confirmationToken")
    const tokenValidation = validateOrderResetConfirmationToken(
        typeof rawConfirmationToken === "string" ? rawConfirmationToken : null
    )
    if (!tokenValidation.ok) {
        return { success: false, error: tokenValidation.error }
    }

    const eventId = await getAdminContextEventId()
    if (!eventId) {
        return { success: false, error: "Nessuna festa selezionata nel contesto admin" }
    }

    try {
        await dbConnect()

        const orderIds = (await Order.find({ eventId }).select("_id").lean() as Array<{ _id: { toString(): string } | string }>)
            .map((order) => order._id.toString())

        const printJobClauses: Array<Record<string, unknown>> = [
            { source: { $in: ["ORDER", "CASH_SESSION"] } }
        ]
        if (orderIds.length > 0) {
            printJobClauses.push({ orderId: { $in: orderIds } })
        }

        const [
            deletedOrdersResult,
            deletedOrderCountersResult,
            deletedPrintJobsResult,
            deletedCashSessionsResult
        ] = await Promise.all([
            Order.deleteMany({ eventId }),
            OrderCounter.deleteMany({ eventId }),
            PrintJob.deleteMany({ eventId, $or: printJobClauses }),
            CashSession.deleteMany({ eventId })
        ])

        revalidatePath("/admin/orders")
        revalidatePath("/admin")

        return {
            success: true,
            summary: {
                deletedOrders: deletedOrdersResult.deletedCount || 0,
                deletedOrderCounters: deletedOrderCountersResult.deletedCount || 0,
                deletedPrintJobs: deletedPrintJobsResult.deletedCount || 0,
                deletedCashSessions: deletedCashSessionsResult.deletedCount || 0
            }
        }
    } catch (error) {
        console.error("Reset ordini festa error:", error)
        return { success: false, error: "Errore interno durante il reset ordini della festa" }
    }
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

    let leaseRequestedAt: Date | undefined
    let leaseClaimed = false
    try {
        await dbConnect()
        const now = new Date()
        leaseRequestedAt = now
        const staleBefore = new Date(now.getTime() - STORNO_LEASE_MS)
        const lockSetPayload: Record<string, unknown> = {
            "stornoMeta.status": "IN_PROGRESS",
            "stornoMeta.requestedAt": now,
            "stornoMeta.requestedBy": "admin"
        }
        if (normalizedReason) {
            lockSetPayload["stornoMeta.reason"] = normalizedReason
        }

        let lockedOrder = await Order.findOneAndUpdate(
            {
                _id: normalizedOrderId,
                eventId,
                status: "PAID",
                $or: [
                    { "stornoMeta.status": { $exists: false } },
                    { "stornoMeta.status": "FAILED" },
                    {
                        "stornoMeta.status": "IN_PROGRESS",
                        "stornoMeta.requestedAt": { $lte: staleBefore }
                    },
                    {
                        "stornoMeta.status": "IN_PROGRESS",
                        "stornoMeta.requestedAt": { $exists: false }
                    }
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
        leaseClaimed = true

        const leaseFilter = {
            _id: normalizedOrderId,
            eventId,
            status: "PAID",
            "stornoMeta.status": "IN_PROGRESS",
            "stornoMeta.requestedAt": now
        }

        const stockClaimedOrder = await Order.findOneAndUpdate(
            {
                ...leaseFilter,
                $or: [
                    { stockEffectClaim: null },
                    { "stockEffectClaim.token": "STORNO", "stockEffectClaim.target": "REVERTED" }
                ]
            },
            { $set: { stockEffectClaim: { token: "STORNO", target: "REVERTED" } } },
            { returnDocument: "after" }
        ).lean() as OrderForStornoProjection | null
        if (!stockClaimedOrder) {
            await Order.updateOne(
                leaseFilter,
                { $set: { "stornoMeta.status": "FAILED", "stornoMeta.refundError": "Modifica scorte già in corso" } }
            )
            return { success: false, error: "Modifica scorte già in corso per questo ordine: riprova tra poco" }
        }
        lockedOrder = stockClaimedOrder

        const refundRequired = Boolean(
            lockedOrder.sumupCheckoutId?.trim()
            || lockedOrder.sumupPaymentId?.trim()
        )
        let refundStatus: "SKIPPED" | "DONE" | "FAILED" = refundRequired ? "FAILED" : "SKIPPED"
        let refundTransactionId = lockedOrder.stornoMeta?.refundTransactionId?.trim()

        if (refundRequired) {
            const refundAlreadyDone = lockedOrder.stornoMeta?.refundStatus === "DONE" && Boolean(refundTransactionId)

            if (!refundAlreadyDone) {
                const apiKeyResult = await resolveSumUpCredentialsForOrder(eventId, lockedOrder.posDeviceId?.toString())
                if (!apiKeyResult.success) {
                    await Order.updateOne(
                        leaseFilter,
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

                const priorRefundTransactionId = refundTransactionId
                let transactionId = refundTransactionId || lockedOrder.sumupPaymentId?.trim()
                if (!transactionId && lockedOrder.sumupCheckoutId?.trim()) {
                    const resolveResult = await resolveSumUpTransactionIdByCheckout(
                        lockedOrder.sumupCheckoutId,
                        apiKeyResult.apiKey
                    )
                    if (!resolveResult.success || !resolveResult.transactionId) {
                        await Order.updateOne(
                            leaseFilter,
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
                        leaseFilter,
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

                if (priorRefundTransactionId) {
                    const priorRefundState = await getSumUpRefundState({
                        transactionId,
                        merchantCode: apiKeyResult.merchantCode,
                        apiKey: apiKeyResult.apiKey
                    })
                    if (!priorRefundState.success) {
                        await Order.updateOne(
                            leaseFilter,
                            {
                                $set: {
                                    "stornoMeta.status": "FAILED",
                                    "stornoMeta.refundRequired": true,
                                    "stornoMeta.refundStatus": "FAILED",
                                    "stornoMeta.refundTransactionId": transactionId,
                                    "stornoMeta.refundError": priorRefundState.error
                                }
                            }
                        )
                        return { success: false, error: priorRefundState.error }
                    }
                    if (priorRefundState.fullyRefunded) {
                        refundStatus = "DONE"
                        refundTransactionId = transactionId
                    }
                }

                if (refundStatus !== "DONE") {
                    const attemptRecorded = await Order.updateOne(
                        leaseFilter,
                        {
                            $set: {
                                "stornoMeta.refundRequired": true,
                                "stornoMeta.refundStatus": "FAILED",
                                "stornoMeta.refundTransactionId": transactionId,
                                "stornoMeta.refundError": "Rimborso SumUp in verifica"
                            }
                        }
                    )
                    if ((attemptRecorded.matchedCount ?? attemptRecorded.modifiedCount) !== 1) {
                        return { success: false, error: "Storno rilevato da un'altra operazione: riprova" }
                    }

                    let refundResult: { success: boolean; error?: string }
                    try {
                        refundResult = await refundSumUpTransaction({
                            transactionId,
                            apiKey: apiKeyResult.apiKey
                        })
                    } catch {
                        refundResult = { success: false, error: "Errore rimborso SumUp" }
                    }

                    if (!refundResult.success) {
                        const refundState = await getSumUpRefundState({
                            transactionId,
                            merchantCode: apiKeyResult.merchantCode,
                            apiKey: apiKeyResult.apiKey
                        })
                        if (!refundState.success || !refundState.fullyRefunded) {
                            const refundError = refundState.success
                                ? refundResult.error || "Errore rimborso SumUp"
                                : refundState.error
                            await Order.updateOne(
                                leaseFilter,
                                {
                                    $set: {
                                        "stornoMeta.status": "FAILED",
                                        "stornoMeta.refundRequired": true,
                                        "stornoMeta.refundStatus": "FAILED",
                                        "stornoMeta.refundTransactionId": transactionId,
                                        "stornoMeta.refundError": refundError
                                    }
                                }
                            )
                            return { success: false, error: refundError }
                        }
                    }

                    refundStatus = "DONE"
                    refundTransactionId = transactionId
                }

                const refundRecorded = await Order.updateOne(
                    leaseFilter,
                    {
                        $set: {
                            "stornoMeta.refundRequired": true,
                            "stornoMeta.refundStatus": "DONE",
                            "stornoMeta.refundTransactionId": transactionId
                        },
                        $unset: { "stornoMeta.refundError": 1 }
                    }
                )
                if ((refundRecorded.matchedCount ?? refundRecorded.modifiedCount) !== 1) {
                    return { success: false, error: "Storno rilevato da un'altra operazione: riprova" }
                }
            } else {
                refundStatus = "DONE"
            }
        }

        const stockAdjustments = lockedOrder.stockEffectStatus === "REVERTED"
            ? []
            : (Array.isArray(lockedOrder.stockAdjustments) ? lockedOrder.stockAdjustments : buildStockAdjustmentsFromOrder(lockedOrder))
        try {
            const stockResult = await transitionClaimedOrderStock({
                eventId,
                orderId: normalizedOrderId,
                token: "STORNO",
                target: "REVERTED",
                adjustments: stockAdjustments,
                releaseClaim: false
            })
            if (!stockResult.success) throw new Error(stockResult.error)
        } catch (rollbackError) {
            await Order.updateOne(
                leaseFilter,
                {
                    $set: {
                        "stornoMeta.status": "FAILED",
                        "stornoMeta.refundRequired": refundRequired,
                        "stornoMeta.refundStatus": refundStatus,
                        "stornoMeta.refundTransactionId": refundTransactionId,
                        "stornoMeta.refundError": "Ripristino scorte non riuscito"
                    }
                }
            )
            console.error("Storno rollback stock error:", rollbackError)
            return { success: false, error: "Ripristino scorte non riuscito" }
        }

        const completed = await Order.updateOne(
            leaseFilter,
            {
                $set: {
                    status: "CANCELLED",
                    "stornoMeta.status": "COMPLETED",
                    "stornoMeta.reason": normalizedReason || undefined,
                    "stornoMeta.completedAt": new Date(),
                    "stornoMeta.refundRequired": refundRequired,
                    "stornoMeta.refundStatus": refundStatus,
                    "stornoMeta.refundTransactionId": refundTransactionId,
                    stockEffectStatus: "REVERTED"
                },
                $unset: {
                    "stornoMeta.refundError": 1,
                    stockEffectClaim: 1
                }
            }
        )
        if ((completed.matchedCount ?? completed.modifiedCount) !== 1) {
            return { success: false, error: "Storno rilevato da un'altra operazione: riprova" }
        }

        revalidatePath("/admin/orders")
        revalidatePath("/admin")
        return { success: true }
    } catch (error) {
        try {
            if (leaseClaimed && leaseRequestedAt) {
                await Order.updateOne(
                    {
                        _id: normalizedOrderId,
                        eventId,
                        status: "PAID",
                        "stornoMeta.status": "IN_PROGRESS",
                        "stornoMeta.requestedAt": leaseRequestedAt
                    },
                    {
                        $set: {
                            "stornoMeta.status": "FAILED",
                            "stornoMeta.refundError": "Errore interno inatteso durante lo storno"
                        }
                    }
                )
            }
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
