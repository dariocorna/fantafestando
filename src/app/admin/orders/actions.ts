"use server"

import crypto from "node:crypto";
import dbConnect from "@/lib/mongoose";
import { getAdminContextEventId } from "@/lib/events";
import { ensureAdminSession } from "@/lib/authz";
import { validateOrderResetConfirmationToken } from "@/lib/order-reset";
import Order from "@/models/Order";
import OrderCounter from "@/models/OrderCounter";
import PrintJob from "@/models/PrintJob";
import CashSession from "@/models/CashSession";
import { PrinterService } from "@/lib/printer";
import { recoverStaleManualPrintRetryClaims } from "@/lib/print-queue";
import {
    resolveSumUpCredentialsForOrder,
    type SumUpRefundCredentialsSnapshot
} from "@/lib/sumup-order-credentials";
import {
    getSumUpReaderStatus,
    getSumUpTransactionByClientTransactionId,
    getSumUpTransactionByForeignTransactionId,
    refundSumUpTransaction,
    resolveSumUpTransactionIdByCheckout
} from "@/lib/sumup";
import { getSumUpRefundState } from "@/lib/sumup-refund";
import {
    finalizeClaimedSumUpOrder,
    sumUpTransactionMatchesOrder,
    sumUpTransactionsMatch,
    type ClaimedSumUpOrder,
    type VerifiedSumUpTransaction
} from "@/lib/sumup-order-finalization";
import { transitionSumUpOrderStock } from "@/lib/sumup-order-stock";
import { type StockAdjustment } from "@/lib/stock-operations";
import { transitionClaimedOrderStock } from "@/lib/cash-session-stock";
import {
    claimSumUpEventOperation,
    releaseSumUpEventOperation,
    startSumUpEventOperationHeartbeat
} from "@/lib/sumup-event-operation";
import { completeSumUpPrintIntentsIfSent } from "@/lib/sumup-print-routing";
import { revalidatePath } from "next/cache";

interface OrderForStornoProjection {
    _id: string | { toString(): string }
    status: "PENDING" | "PAID" | "CANCELLED"
    paymentMethod?: "CASH" | "CARD" | "OTHER"
    totalAmount?: number
    sumupCheckoutId?: string
    sumupPaymentId?: string
    sumupRefundCredentials?: SumUpRefundCredentialsSnapshot
    sumupLateSuccessDetectedAt?: Date
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

const SUMUP_UNCERTAIN_RECOVERY_GRACE_MS = 15 * 60 * 1000
const SUMUP_RECOVERY_CLAIM_TTL_MS = 5 * 60 * 1000

type RecoverableSumUpOrder = ClaimedSumUpOrder & {
    sumupCheckoutId?: string
    sumupPaymentId?: string
    sumupRefundCredentials?: SumUpRefundCredentialsSnapshot
    sumupInitiatedAt?: Date
}

function transactionClientId(transaction: VerifiedSumUpTransaction) {
    return transaction.client_transaction_id?.trim()
}

async function lookupRecoveryTransaction(params: {
    orderId: string
    checkoutId: string
    merchantCode: string
    apiKey: string
}) {
    const foreignLookup = await getSumUpTransactionByForeignTransactionId({
        foreignTransactionId: params.orderId,
        merchantCode: params.merchantCode,
        apiKey: params.apiKey
    })
    const marker = `initiating:${params.orderId}`
    const linkedClientId = params.checkoutId === marker ? undefined : params.checkoutId
    const clientLookup = linkedClientId
        ? await getSumUpTransactionByClientTransactionId({
            clientTransactionId: linkedClientId,
            merchantCode: params.merchantCode,
            apiKey: params.apiKey
        })
        : undefined

    if (!foreignLookup.success) {
        if (!foreignLookup.notFound) return { success: false as const, error: foreignLookup.error }
        if (!clientLookup) return { success: false as const, notFound: true as const }
        if (!clientLookup.success && clientLookup.notFound) return { success: false as const, notFound: true as const }
        return { success: false as const, error: clientLookup.success
            ? "La transazione SumUp esiste ma i riferimenti non coincidono"
            : clientLookup.error }
    }

    const resolvedClientId = transactionClientId(foreignLookup.transaction) || linkedClientId
    if (!resolvedClientId) {
        return { success: false as const, error: "La transazione SumUp non espone un riferimento client verificabile" }
    }
    const verifiedClientLookup = clientLookup || await getSumUpTransactionByClientTransactionId({
        clientTransactionId: resolvedClientId,
        merchantCode: params.merchantCode,
        apiKey: params.apiKey
    })
    if (!verifiedClientLookup.success) {
        return { success: false as const, error: verifiedClientLookup.error }
    }
    if (!sumUpTransactionsMatch(foreignLookup.transaction, verifiedClientLookup.transaction)) {
        return { success: false as const, error: "I riferimenti della transazione SumUp non coincidono" }
    }
    return {
        success: true as const,
        checkoutId: resolvedClientId,
        transaction: foreignLookup.transaction
    }
}

export async function recoverUncertainSumUpOrderById(orderId: string) {
    const sessionCheck = await ensureAdminSession()
    if (!sessionCheck.ok) return { success: false, error: sessionCheck.error }

    const normalizedOrderId = orderId?.trim()
    if (!normalizedOrderId) return { success: false, error: "Ordine non valido" }

    const eventId = await getAdminContextEventId()
    if (!eventId) return { success: false, error: "Nessuna festa selezionata nel contesto admin" }

    const now = new Date()
    const claimToken = crypto.randomUUID()
    const initiationCutoff = new Date(now.getTime() - SUMUP_UNCERTAIN_RECOVERY_GRACE_MS)
    const staleClaimCutoff = new Date(now.getTime() - SUMUP_RECOVERY_CLAIM_TTL_MS)
    let claimedOrder: RecoverableSumUpOrder | null = null

    try {
        await dbConnect()
        claimedOrder = await Order.findOneAndUpdate(
            {
                _id: normalizedOrderId,
                eventId,
                status: "PENDING",
                sumupCheckoutId: { $exists: true, $nin: [null, ""] },
                sumupPaymentId: { $in: [null, ""] },
                sumupInitiatedAt: { $lte: initiationCutoff },
                $or: [
                    { sumupWebhookClaimedAt: { $exists: false } },
                    { sumupWebhookClaimedAt: { $lt: staleClaimCutoff } }
                ]
            },
            { $set: { sumupWebhookClaimToken: claimToken, sumupWebhookClaimedAt: now } },
            { returnDocument: "after" }
        )
            .select("_id status totalAmount eventId cashSessionId posDeviceId stockEffectStatus stockAdjustments sumupCheckoutId sumupPaymentId sumupInitiatedAt +sumupRefundCredentials")
            .lean() as RecoverableSumUpOrder | null

        if (!claimedOrder) {
            const current = await Order.findOne({ _id: normalizedOrderId, eventId })
                .select("status sumupCheckoutId sumupPaymentId sumupInitiatedAt sumupWebhookClaimedAt")
                .lean() as (RecoverableSumUpOrder & { sumupWebhookClaimedAt?: Date }) | null
            if (!current) return { success: false, error: "Ordine non trovato nella festa selezionata" }
            if (current.status !== "PENDING" || !current.sumupCheckoutId?.trim() || current.sumupPaymentId?.trim()) {
                return { success: false, error: "L'ordine non richiede più il recupero SumUp" }
            }
            if (!current.sumupInitiatedAt || new Date(current.sumupInitiatedAt).getTime() > initiationCutoff.getTime()) {
                return { success: false, error: "Attendi almeno 15 minuti dall'avvio del pagamento prima del recupero" }
            }
            return { success: false, error: "Un'altra verifica SumUp è già in corso; riprova tra poco" }
        }

        const checkoutId = claimedOrder.sumupCheckoutId?.trim()
        if (!checkoutId || !claimedOrder.eventId) {
            return { success: false, error: "Riferimenti dell'ordine SumUp incompleti" }
        }
        if (checkoutId.startsWith("initiating:") && checkoutId !== `initiating:${normalizedOrderId}`) {
            return { success: false, error: "Marker di inizializzazione SumUp non coerente con l'ordine" }
        }
        const credentials = await resolveSumUpCredentialsForOrder(claimedOrder)
        if (!credentials.success) return credentials
        if (!credentials.readerId) {
            return { success: false, error: "Reader ID SumUp mancante nella periferica associata" }
        }

        const lookup = await lookupRecoveryTransaction({
            orderId: normalizedOrderId,
            checkoutId,
            merchantCode: credentials.merchantCode,
            apiKey: credentials.apiKey
        })
        if (lookup.success) {
            if (!sumUpTransactionMatchesOrder(lookup.transaction, credentials.merchantCode, claimedOrder)) {
                return { success: false, error: "La transazione SumUp non coincide con importo, valuta o merchant dell'ordine" }
            }
            const finalized = await finalizeClaimedSumUpOrder({
                order: claimedOrder,
                transaction: lookup.transaction,
                checkoutId: lookup.checkoutId,
                claimToken
            })
            if (!finalized.success) return { success: false, error: finalized.error }
            revalidatePath("/admin/orders")
            revalidatePath("/admin")
            return {
                success: true,
                status: finalized.status,
                message: finalized.status === "PAID"
                    ? "Pagamento SumUp verificato e ordine completato"
                    : "Esito SumUp negativo verificato e ordine annullato"
            }
        }
        if (!("notFound" in lookup) || !lookup.notFound) {
            return { success: false, error: lookup.error }
        }

        const readerStatus = await getSumUpReaderStatus({
            merchantCode: credentials.merchantCode,
            readerId: credentials.readerId,
            apiKey: credentials.apiKey
        })
        if (!readerStatus.success) return { success: false, error: readerStatus.error }
        if (readerStatus.status !== "ONLINE" || readerStatus.state !== "IDLE") {
            return {
                success: false,
                error: "Il reader SumUp non è online e libero: non è sicuro annullare l'ordine"
            }
        }

        const confirmationLookup = await lookupRecoveryTransaction({
            orderId: normalizedOrderId,
            checkoutId,
            merchantCode: credentials.merchantCode,
            apiKey: credentials.apiKey
        })
        if (confirmationLookup.success || !("notFound" in confirmationLookup) || !confirmationLookup.notFound) {
            return {
                success: false,
                error: confirmationLookup.success
                    ? "Una transazione SumUp è comparsa durante la verifica; ripeti il recupero"
                    : confirmationLookup.error
            }
        }

        const stockResult = await transitionSumUpOrderStock({
            eventId: claimedOrder.eventId.toString(),
            orderId: normalizedOrderId,
            token: `SUMUP_RECOVERY_CANCEL:${normalizedOrderId}`,
            target: "REVERTED",
            adjustments: (claimedOrder.stockAdjustments || []).map((entry) => ({
                ...entry,
                entityId: entry.entityId.toString()
            }))
        })
        if (!stockResult.success) return { success: false, error: stockResult.error }

        const cancelled = await Order.updateOne(
            {
                _id: normalizedOrderId,
                eventId,
                status: "PENDING",
                sumupCheckoutId: checkoutId,
                sumupPaymentId: { $in: [null, ""] },
                sumupWebhookClaimToken: claimToken
            },
            {
                $set: { status: "CANCELLED", sumupRecoveryCancelledAt: new Date() },
                $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 }
            }
        )
        if (!cancelled.acknowledged || cancelled.matchedCount !== 1) {
            return { success: false, error: "Il recupero SumUp è entrato in conflitto con un'altra operazione" }
        }

        revalidatePath("/admin/orders")
        revalidatePath("/admin")
        return {
            success: true,
            status: "CANCELLED" as const,
            message: "Nessuna transazione SumUp trovata: prenotazione scorte rilasciata e ordine annullato"
        }
    } catch (error) {
        console.error("SumUp uncertain order recovery error:", error)
        return { success: false, error: "Errore interno durante il recupero SumUp" }
    } finally {
        if (claimedOrder) {
            await Order.updateOne(
                { _id: normalizedOrderId, status: "PENDING", sumupWebhookClaimToken: claimToken },
                { $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 } }
            ).catch((error) => console.error("SumUp recovery claim release error:", error))
        }
    }
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

            await completeSumUpPrintIntentsIfSent(eventId, normalizedOrderId)

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
        const operationToken = await claimSumUpEventOperation(eventId)
        if (!operationToken) {
            return {
                success: false,
                error: "Operazione bloccata: un pagamento SumUp o una modifica della festa è già in corso"
            }
        }

        try {
            const protectedSumUpOrder = await Order.exists({
                eventId,
                $or: [
                    {
                        status: "PENDING",
                        sumupCheckoutId: { $exists: true, $nin: [null, ""] }
                    },
                    {
                        status: "PAID",
                        $or: [
                            { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                            { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                        ]
                    },
                    {
                        status: "CANCELLED",
                        sumupRecoveryCancelledAt: { $exists: true, $ne: null },
                        sumupRecoveryResolvedAt: { $exists: false },
                        "stornoMeta.refundStatus": { $ne: "DONE" }
                    }
                ]
            })
            if (protectedSumUpOrder) {
                return {
                    success: false,
                    error: "Completa o rimborsa tutti i pagamenti SumUp prima di azzerare gli ordini della festa"
                }
            }

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
        } finally {
            await releaseSumUpEventOperation(eventId, operationToken)
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
    let leaseOrderStatus: "PAID" | "CANCELLED" | undefined
    let leaseClaimed = false
    let eventOperationToken: string | null = null
    let eventOperationHeartbeat: ReturnType<typeof startSumUpEventOperationHeartbeat> | undefined
    try {
        await dbConnect()
        eventOperationToken = await claimSumUpEventOperation(eventId)
        if (!eventOperationToken) {
            return { success: false, error: "Operazione bloccata: un pagamento SumUp o una modifica della festa è già in corso" }
        }
        eventOperationHeartbeat = startSumUpEventOperationHeartbeat(eventId, eventOperationToken)
        if (!await eventOperationHeartbeat.ensureOwned()) {
            return { success: false, error: "Operazione SumUp non più esclusiva: riprova" }
        }
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
                $and: [
                    {
                        $or: [
                            { status: "PAID" },
                            {
                                status: "CANCELLED",
                                sumupLateSuccessDetectedAt: { $exists: true },
                                "stornoMeta.refundStatus": { $ne: "DONE" }
                            }
                        ]
                    },
                    {
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
                    }
                ]
            },
            {
                $set: lockSetPayload
            },
            { returnDocument: "after" }
        ).select("+sumupRefundCredentials").lean() as OrderForStornoProjection | null

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
        if (lockedOrder.status !== "PAID" && lockedOrder.status !== "CANCELLED") {
            return { success: false, error: "Solo gli ordini pagati possono essere stornati" }
        }
        leaseOrderStatus = lockedOrder.status

        const leaseFilter = {
            _id: normalizedOrderId,
            eventId,
            status: lockedOrder.status,
            "stornoMeta.status": "IN_PROGRESS",
            "stornoMeta.requestedAt": now
        }

        if (lockedOrder.stockEffectStatus !== "REVERTED") {
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
            ).select("+sumupRefundCredentials").lean() as OrderForStornoProjection | null
            if (!stockClaimedOrder) {
                await Order.updateOne(
                    leaseFilter,
                    { $set: { "stornoMeta.status": "FAILED", "stornoMeta.refundError": "Modifica scorte già in corso" } }
                )
                return { success: false, error: "Modifica scorte già in corso per questo ordine: riprova tra poco" }
            }
            lockedOrder = stockClaimedOrder
        }

        const refundRequired = Boolean(
            lockedOrder.sumupCheckoutId?.trim()
            || lockedOrder.sumupPaymentId?.trim()
        )
        let refundStatus: "SKIPPED" | "DONE" | "FAILED" = refundRequired ? "FAILED" : "SKIPPED"
        let refundTransactionId = lockedOrder.stornoMeta?.refundTransactionId?.trim()

        if (refundRequired) {
            const refundAlreadyDone = lockedOrder.stornoMeta?.refundStatus === "DONE" && Boolean(refundTransactionId)

            if (!refundAlreadyDone) {
                const apiKeyResult = await resolveSumUpCredentialsForOrder({
                    ...lockedOrder,
                    eventId
                })
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
                    if (!await eventOperationHeartbeat.ensureOwned()) {
                        return { success: false, error: "Operazione SumUp non più esclusiva: riprova" }
                    }
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

        if (lockedOrder.stockEffectStatus !== "REVERTED") {
            if (!await eventOperationHeartbeat.ensureOwned()) {
                return { success: false, error: "Operazione SumUp non più esclusiva: riprova" }
            }
            const stockAdjustments = Array.isArray(lockedOrder.stockAdjustments)
                ? lockedOrder.stockAdjustments
                : buildStockAdjustmentsFromOrder(lockedOrder)
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
        }

        if (!await eventOperationHeartbeat.ensureOwned()) {
            return { success: false, error: "Operazione SumUp non più esclusiva: riprova" }
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
                    stockEffectClaim: 1,
                    ...(refundStatus === "DONE" ? { sumupRefundCredentials: 1 } : {})
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
                        status: leaseOrderStatus,
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
    } finally {
        eventOperationHeartbeat?.stop()
        await releaseSumUpEventOperation(eventId, eventOperationToken).catch((error) => {
            console.error("Storno event operation release error:", error)
        })
    }
}

export async function stornoPaidOrder(formData: FormData) {
    const orderId = formData.get("orderId") as string
    const reason = formData.get("reason") as string | null
    return await stornoPaidOrderById(orderId, reason || undefined)
}
