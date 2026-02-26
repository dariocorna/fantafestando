"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import PosDevice from "@/models/PosDevice"
import Product from "@/models/Product"
import CashSession from "@/models/CashSession"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import { createSumUpCheckout } from "@/lib/sumup"
import { decryptSecret } from "@/lib/secrets"
import { getOrderCodeFromOrder, parseOrderNumberInput } from "@/lib/order-code"
import { type StockMode } from "@/lib/inventory"
import { computeCashSessionSummary } from "@/lib/cash-session"
import {
    computeOrderDiscounts,
    type DiscountInput,
    type LineDiscountInput,
    type LineDiscountMeta,
    type OrderDiscountMeta
} from "@/lib/order-discounts"
import {
    applyStockForPaidOrder,
    validateStockForPendingOrder,
    rollbackStockAdjustments,
    type StockAdjustment,
} from "@/lib/stock-operations"

interface PosPaymentCapabilities {
    hasCashBox: boolean
    hasPaymentTerminal: boolean
}

interface PrintDispatchSummary {
    attempted: number
    succeeded: number
    failed: number
    allSuccessful: boolean
}

interface OpenCashSessionDto {
    id: string
    openedAt: string
    openingFloatAmount: number
    openingNotes?: string
}

interface CashSessionClosurePreviewDto {
    sessionId: string
    openedAt: string
    openingFloatAmount: number
    paidOrdersCount: number
    cashSalesAmount: number
    cardSalesAmount: number
    otherSalesAmount: number
    expectedCashAmount: number
}

interface CashSessionPaidOrderProjection {
    status?: string
    paymentMethod?: string
    totalAmount?: number
}

interface PosCartSelectedOption {
    name: string
    priceVariation: number
}

interface PosCartItemInput {
    productId: string
    snapshotName: string
    quantity: number
    selectedOptions: PosCartSelectedOption[]
}

interface PosOrderPricingResult {
    baseAmount: number
    discountApplied: number
    finalAmount: number
    cartWithDiscounts: Array<{
        productId: string
        snapshotName: string
        quantity: number
        selectedOptions: PosCartSelectedOption[]
        discountApplied: number
        discountMeta?: LineDiscountMeta
    }>
    orderDiscountMeta?: OrderDiscountMeta
}

function normalizeCurrencyAmount(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Number(Math.max(0, value).toFixed(2))
}

function toCents(amount: number): number {
    return Math.round(amount * 100)
}

function amountsAreEquivalent(left: number, right: number): boolean {
    return Math.abs(toCents(left) - toCents(right)) <= 1
}

function sanitizeCartItems(
    cart: Array<{
        productId: string
        snapshotName: string
        quantity: number
        selectedOptions?: Array<{ name: string, priceVariation: number }>
    }>
): PosCartItemInput[] | null {
    if (!Array.isArray(cart) || cart.length === 0) return null

    const sanitized: PosCartItemInput[] = []
    for (const item of cart) {
        const productId = item.productId?.trim()
        const snapshotName = item.snapshotName?.trim()
        const quantity = Number(item.quantity)
        if (!productId || !snapshotName || !Number.isFinite(quantity) || quantity < 1) {
            return null
        }

        const selectedOptions = Array.isArray(item.selectedOptions)
            ? item.selectedOptions
                .filter((option) => option && typeof option.name === "string")
                .map((option) => ({
                    name: option.name,
                    priceVariation: Number.isFinite(option.priceVariation)
                        ? Number(option.priceVariation)
                        : 0
                }))
            : []

        sanitized.push({
            productId,
            snapshotName,
            quantity: Math.floor(quantity),
            selectedOptions
        })
    }

    return sanitized
}

async function computePricingForCart(data: {
    eventId: string
    cart: PosCartItemInput[]
    declaredTotalAmount?: number
    orderDiscount?: DiscountInput
    lineDiscounts?: LineDiscountInput[]
}): Promise<
    { success: true, pricing: PosOrderPricingResult }
    | { success: false, error: string }
> {
    const productIds = [...new Set(data.cart.map((item) => item.productId))]
    const productDocs = await Product.find({
        eventId: data.eventId,
        _id: { $in: productIds }
    }).select("_id basePrice").lean() as Array<{
        _id: string | { toString(): string }
        basePrice?: number
    }>

    if (productDocs.length !== productIds.length) {
        return { success: false, error: "Impossibile calcolare il totale: prodotti non più disponibili" }
    }

    const basePriceByProductId = new Map<string, number>()
    productDocs.forEach((product) => {
        basePriceByProductId.set(product._id.toString(), normalizeCurrencyAmount(product.basePrice ?? 0))
    })

    const computedDiscounts = computeOrderDiscounts({
        lines: data.cart.map((item) => {
            const basePrice = basePriceByProductId.get(item.productId) ?? 0
            const optionsDelta = item.selectedOptions.reduce((sum, option) =>
                sum + normalizeCurrencyAmount(option.priceVariation), 0
            )
            return {
                productId: item.productId,
                quantity: item.quantity,
                unitAmount: normalizeCurrencyAmount(basePrice + optionsDelta)
            }
        }),
        orderDiscount: data.orderDiscount,
        lineDiscounts: data.lineDiscounts
    })

    if (!computedDiscounts.success) {
        return { success: false, error: computedDiscounts.error }
    }

    if (
        typeof data.declaredTotalAmount === "number"
        && Number.isFinite(data.declaredTotalAmount)
        && !amountsAreEquivalent(computedDiscounts.summary.finalAmount, normalizeCurrencyAmount(data.declaredTotalAmount))
    ) {
        return { success: false, error: "Totale ordine non coerente con la scontistica applicata" }
    }

    return {
        success: true,
        pricing: {
            baseAmount: computedDiscounts.summary.baseAmount,
            discountApplied: computedDiscounts.summary.discountApplied,
            finalAmount: computedDiscounts.summary.finalAmount,
            orderDiscountMeta: computedDiscounts.summary.orderDiscountMeta,
            cartWithDiscounts: data.cart.map((item, index) => {
                const line = computedDiscounts.summary.lineResults[index]
                return {
                    productId: item.productId,
                    snapshotName: item.snapshotName,
                    quantity: item.quantity,
                    selectedOptions: item.selectedOptions,
                    discountApplied: line?.discountApplied ?? 0,
                    discountMeta: line?.discountMeta
                }
            })
        }
    }
}

function serializeOpenCashSession(session: {
    _id: { toString(): string } | string
    openedAt?: Date
    openingFloatAmount?: number
    openingNotes?: string
}): OpenCashSessionDto {
    return {
        id: session._id.toString(),
        openedAt: (session.openedAt || new Date()).toISOString(),
        openingFloatAmount: normalizeCurrencyAmount(session.openingFloatAmount ?? 0),
        openingNotes: session.openingNotes?.trim() || undefined
    }
}

async function computeSummaryForCashSession(data: {
    eventId: string
    posDeviceId: string
    cashSessionId: string
    openingFloatAmount: number
    closingCountedCashAmount: number
}) {
    const paidOrders = await Order.find({
        eventId: data.eventId,
        posDeviceId: data.posDeviceId,
        cashSessionId: data.cashSessionId,
        status: "PAID"
    })
        .select("status paymentMethod totalAmount")
        .lean() as CashSessionPaidOrderProjection[]

    const computed = computeCashSessionSummary({
        openingFloatAmount: data.openingFloatAmount,
        closingCountedCashAmount: data.closingCountedCashAmount,
        orders: paidOrders
    })

    return { paidOrders, computed }
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

function summarizePrintDispatch(results: boolean[] | undefined): PrintDispatchSummary {
    const normalized = Array.isArray(results) ? results : []
    const attempted = normalized.length
    const succeeded = normalized.filter(Boolean).length
    const failed = attempted - succeeded
    return {
        attempted,
        succeeded,
        failed,
        allSuccessful: attempted > 0 && failed === 0
    }
}

async function getOpenCashSession(eventId: string, posDeviceId?: string): Promise<
    { success: true, session: OpenCashSessionDto } | { success: false, error: string }
> {
    if (!eventId || !posDeviceId) {
        return { success: false, error: "Apri una cassa valida prima di completare il pagamento" }
    }

    await dbConnect()
    const openSession = await CashSession.findOne({
        eventId,
        posDeviceId,
        status: "OPEN"
    })
        .sort({ openedAt: -1 })
        .select("_id openedAt openingFloatAmount openingNotes")
        .lean() as (
            {
                _id: { toString(): string } | string
                openedAt?: Date
                openingFloatAmount?: number
                openingNotes?: string
            } | null
        )

    if (!openSession) {
        return { success: false, error: "Cassa chiusa. Esegui prima l'apertura cassa." }
    }

    return { success: true, session: serializeOpenCashSession(openSession) }
}

export async function getCashSessionStatus(data: {
    eventId: string
    posDeviceId?: string
}): Promise<
    { success: true, session: OpenCashSessionDto | null }
    | { success: false, error: string }
> {
    try {
        if (!data.eventId) {
            return { success: false, error: "Evento non valido" }
        }

        const capabilitiesResult = await getPosPaymentCapabilities(data.eventId, data.posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        const sessionResult = await getOpenCashSession(data.eventId, data.posDeviceId)
        if (!sessionResult.success) {
            return { success: true, session: null }
        }

        return { success: true, session: sessionResult.session }
    } catch (error) {
        console.error("Get Cash Session Status Error:", error)
        return { success: false, error: "Errore nel recupero stato cassa" }
    }
}

export async function openCashSession(data: {
    eventId: string
    posDeviceId?: string
    openingFloatAmount: number
    openingNotes?: string
}): Promise<
    { success: true, session: OpenCashSessionDto }
    | { success: false, error: string }
> {
    try {
        if (!data.eventId || !data.posDeviceId) {
            return { success: false, error: "Seleziona una cassa valida prima di aprire la sessione" }
        }

        const capabilitiesResult = await getPosPaymentCapabilities(data.eventId, data.posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        const openingFloatAmount = normalizeCurrencyAmount(data.openingFloatAmount)
        const openingNotes = data.openingNotes?.trim()

        await dbConnect()
        const alreadyOpen = await CashSession.findOne({
            eventId: data.eventId,
            posDeviceId: data.posDeviceId,
            status: "OPEN"
        }).select("_id").lean()

        if (alreadyOpen) {
            return { success: false, error: "Esiste già una sessione cassa aperta per questa postazione" }
        }

        const session = await CashSession.create({
            eventId: data.eventId,
            posDeviceId: data.posDeviceId,
            status: "OPEN",
            openedAt: new Date(),
            openingFloatAmount,
            openingNotes: openingNotes || undefined
        })

        revalidatePath("/pos")
        return { success: true, session: serializeOpenCashSession(session) }
    } catch (error) {
        console.error("Open Cash Session Error:", error)
        return { success: false, error: "Errore durante l'apertura cassa" }
    }
}

export async function getCashSessionClosurePreview(data: {
    eventId: string
    posDeviceId?: string
}): Promise<
    { success: true, preview: CashSessionClosurePreviewDto }
    | { success: false, error: string }
> {
    try {
        if (!data.eventId || !data.posDeviceId) {
            return { success: false, error: "Seleziona una cassa valida" }
        }

        const capabilitiesResult = await getPosPaymentCapabilities(data.eventId, data.posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        await dbConnect()
        const openSession = await CashSession.findOne({
            eventId: data.eventId,
            posDeviceId: data.posDeviceId,
            status: "OPEN"
        })
            .sort({ openedAt: -1 })
            .select("_id openedAt openingFloatAmount")
            .lean() as (
                {
                    _id: { toString(): string } | string
                    openedAt?: Date
                    openingFloatAmount?: number
                } | null
            )

        if (!openSession) {
            return { success: false, error: "Nessuna sessione cassa aperta da chiudere" }
        }

        const { computed } = await computeSummaryForCashSession({
            eventId: data.eventId,
            posDeviceId: data.posDeviceId,
            cashSessionId: openSession._id.toString(),
            openingFloatAmount: normalizeCurrencyAmount(openSession.openingFloatAmount ?? 0),
            closingCountedCashAmount: 0
        })

        return {
            success: true,
            preview: {
                sessionId: openSession._id.toString(),
                openedAt: (openSession.openedAt || new Date()).toISOString(),
                openingFloatAmount: normalizeCurrencyAmount(openSession.openingFloatAmount ?? 0),
                paidOrdersCount: computed.paidOrdersCount,
                cashSalesAmount: computed.cashSalesAmount,
                cardSalesAmount: computed.cardSalesAmount,
                otherSalesAmount: computed.otherSalesAmount,
                expectedCashAmount: computed.expectedCashAmount
            }
        }
    } catch (error) {
        console.error("Get Cash Session Closure Preview Error:", error)
        return { success: false, error: "Errore durante il calcolo del contante atteso" }
    }
}

export async function closeCashSession(data: {
    eventId: string
    posDeviceId?: string
    closingCountedCashAmount: number
    closingNotes?: string
}): Promise<
    {
        success: true
        summary: {
            sessionId: string
            openingFloatAmount: number
            closingCountedCashAmount: number
            paidOrdersCount: number
            cashSalesAmount: number
            cardSalesAmount: number
            otherSalesAmount: number
            expectedCashAmount: number
            varianceAmount: number
            closedAt: string
        }
    }
    | { success: false, error: string }
> {
    try {
        if (!data.eventId || !data.posDeviceId) {
            return { success: false, error: "Seleziona una cassa valida prima di chiudere la sessione" }
        }

        const capabilitiesResult = await getPosPaymentCapabilities(data.eventId, data.posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        const closingCountedCashAmount = normalizeCurrencyAmount(data.closingCountedCashAmount)
        const closingNotes = data.closingNotes?.trim()

        await dbConnect()
        const openSession = await CashSession.findOne({
            eventId: data.eventId,
            posDeviceId: data.posDeviceId,
            status: "OPEN"
        })

        if (!openSession) {
            return { success: false, error: "Nessuna sessione cassa aperta da chiudere" }
        }

        const { computed } = await computeSummaryForCashSession({
            eventId: data.eventId,
            posDeviceId: data.posDeviceId,
            cashSessionId: openSession._id.toString(),
            openingFloatAmount: normalizeCurrencyAmount(openSession.openingFloatAmount ?? 0),
            closingCountedCashAmount
        })

        const closedAt = new Date()
        openSession.status = "CLOSED"
        openSession.closedAt = closedAt
        openSession.closingCountedCashAmount = closingCountedCashAmount
        openSession.closingNotes = closingNotes || undefined
        openSession.paidOrdersCount = computed.paidOrdersCount
        openSession.cashSalesAmount = computed.cashSalesAmount
        openSession.cardSalesAmount = computed.cardSalesAmount
        openSession.otherSalesAmount = computed.otherSalesAmount
        openSession.expectedCashAmount = computed.expectedCashAmount
        openSession.varianceAmount = computed.varianceAmount
        await openSession.save()

        try {
            await PrinterService.printCashSessionSummary(data.eventId, data.posDeviceId, {
                sessionId: openSession._id.toString(),
                openedAt: openSession.openedAt,
                closedAt,
                openingFloatAmount: normalizeCurrencyAmount(openSession.openingFloatAmount ?? 0),
                cashSalesAmount: computed.cashSalesAmount,
                cardSalesAmount: computed.cardSalesAmount,
                otherSalesAmount: computed.otherSalesAmount,
                expectedCashAmount: computed.expectedCashAmount,
                closingCountedCashAmount,
                varianceAmount: computed.varianceAmount,
                paidOrdersCount: computed.paidOrdersCount,
                openingNotes: openSession.openingNotes,
                closingNotes: closingNotes || undefined
            })
        } catch (printError) {
            console.error("Cash session closed but summary print failed:", printError)
        }

        revalidatePath("/pos")
        revalidatePath("/admin")
        return {
            success: true,
            summary: {
                sessionId: openSession._id.toString(),
                openingFloatAmount: normalizeCurrencyAmount(openSession.openingFloatAmount ?? 0),
                closingCountedCashAmount,
                paidOrdersCount: computed.paidOrdersCount,
                cashSalesAmount: computed.cashSalesAmount,
                cardSalesAmount: computed.cardSalesAmount,
                otherSalesAmount: computed.otherSalesAmount,
                expectedCashAmount: computed.expectedCashAmount,
                varianceAmount: computed.varianceAmount,
                closedAt: closedAt.toISOString()
            }
        }
    } catch (error) {
        console.error("Close Cash Session Error:", error)
        return { success: false, error: "Errore durante la chiusura cassa" }
    }
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
    orderDiscount?: DiscountInput,
    lineDiscounts?: LineDiscountInput[],
    paymentMethod: "CASH" | "CARD" | "OTHER",
    sumupCheckoutId?: string,
    posDeviceId?: string,
    allowStockOverride?: boolean
}) {
    let stockAdjustmentsToRollback: StockAdjustment[] = []
    try {
        const sanitizedCart = sanitizeCartItems(data.cart)
        if (!sanitizedCart) {
            return { success: false, error: "Dati carrello non validi" }
        }

        const capabilitiesResult = await getPosPaymentCapabilities(data.eventId, data.posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        const paymentValidationError = validatePaymentMethodAvailability(data.paymentMethod, capabilitiesResult.capabilities)
        if (paymentValidationError) {
            return { success: false, error: paymentValidationError }
        }

        const sessionResult = await getOpenCashSession(data.eventId, data.posDeviceId)
        if (!sessionResult.success) {
            return { success: false, error: sessionResult.error, cashSessionRequired: true }
        }

        await dbConnect()
        const pricingResult = await computePricingForCart({
            eventId: data.eventId,
            cart: sanitizedCart,
            declaredTotalAmount: data.totalAmount,
            orderDiscount: data.orderDiscount,
            lineDiscounts: data.lineDiscounts
        })
        if (!pricingResult.success) {
            return { success: false, error: pricingResult.error }
        }

        const payableAmount = pricingResult.pricing.finalAmount
        const stockPayload = sanitizedCart.map((item) => ({
            productId: item.productId,
            snapshotName: item.snapshotName,
            quantity: item.quantity,
            selectedOptions: item.selectedOptions
        }))

        const stockMode: StockMode = data.allowStockOverride ? "override" : "strict"
        const isCardPayment = data.paymentMethod === "CARD"

        if (isCardPayment) {
            const stockCheckResult = await validateStockForPendingOrder(data.eventId, stockPayload, stockMode)
            if (!stockCheckResult.success) {
                return {
                    success: false,
                    error: stockCheckResult.error || "Scorte non sufficienti",
                    stockShortages: stockCheckResult.stockShortages
                }
            }
        } else {
            const stockApplyResult = await applyStockForPaidOrder(data.eventId, stockPayload, stockMode)
            if (!stockApplyResult.success) {
                return {
                    success: false,
                    error: stockApplyResult.error || "Scorte non sufficienti",
                    stockShortages: stockApplyResult.stockShortages
                }
            }
            stockAdjustmentsToRollback = stockApplyResult.appliedAdjustments || []
        }

        const order = await Order.create({
            eventId: data.eventId,
            status: isCardPayment ? "PENDING" : "PAID",
            customer: data.customer,
            totalAmount: payableAmount,
            discountApplied: pricingResult.pricing.discountApplied,
            discountMeta: pricingResult.pricing.orderDiscountMeta,
            cart: pricingResult.pricing.cartWithDiscounts,
            paymentMethod: data.paymentMethod,
            sumupCheckoutId: isCardPayment ? undefined : data.sumupCheckoutId,
            posDeviceId: data.posDeviceId,
            cashSessionId: sessionResult.session.id,
            stockOverrideApproved: Boolean(data.allowStockOverride)
        })
        stockAdjustmentsToRollback = []

        if (isCardPayment) {
            const legacyCheckoutId = data.sumupCheckoutId?.trim()
            if (legacyCheckoutId) {
                await Order.updateOne(
                    { _id: order._id, eventId: data.eventId, status: "PENDING" },
                    { $set: { sumupCheckoutId: legacyCheckoutId } }
                )
            } else {
                const sumupResult = await triggerSumUpPayment(payableAmount, data.eventId, data.posDeviceId)
                if (!sumupResult.success || !sumupResult.checkoutId) {
                    await Order.updateOne(
                        { _id: order._id, eventId: data.eventId, status: "PENDING" },
                        { $set: { status: "CANCELLED" } }
                    )
                    return {
                        success: false,
                        error: sumupResult.error || "Errore durante l'inizializzazione del pagamento elettronico"
                    }
                }

                const checkoutLinkResult = await Order.updateOne(
                    { _id: order._id, eventId: data.eventId, status: "PENDING" },
                    { $set: { sumupCheckoutId: sumupResult.checkoutId } }
                )
                if (!checkoutLinkResult.acknowledged || checkoutLinkResult.matchedCount !== 1) {
                    await Order.updateOne(
                        { _id: order._id, eventId: data.eventId, status: "PENDING" },
                        { $set: { status: "CANCELLED" } }
                    )
                    return { success: false, error: "Impossibile associare il checkout SumUp all'ordine" }
                }
            }
        }

        let printSummary: PrintDispatchSummary | undefined

        // Trigger network printing ONLY if PAID immediately.
        if (order.status === "PAID") {
            try {
                const printResults = await PrinterService.routeOrderToPrinters(order._id.toString(), data.posDeviceId)
                printSummary = summarizePrintDispatch(printResults)
            } catch (printError) {
                console.error("Order created but printer routing failed:", printError)
                printSummary = {
                    attempted: 1,
                    succeeded: 0,
                    failed: 1,
                    allSuccessful: false
                }
            }
        }

        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString(), printSummary }
    } catch (error) {
        if (stockAdjustmentsToRollback.length > 0) {
            try {
                await rollbackStockAdjustments(data.eventId, stockAdjustmentsToRollback)
            } catch (rollbackError) {
                console.error("Create Order rollback error:", rollbackError)
            }
        }
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

        if (!normalizedCode) {
            return { success: false, error: "Inserisci un numero ordine valido" }
        }

        await dbConnect()
        const parsedNumber = parseOrderNumberInput(normalizedCode)

        interface PendingOrderResult {
            _id: string | { toString(): string }
            pickupNumber?: number
            totalAmount: number
            customer?: { name?: string, table?: string }
            cart: Array<{ productId: string | { toString(): string }, snapshotName: string, quantity: number }>
        }

        let foundOrder: PendingOrderResult | null = null

        if (parsedNumber !== null) {
            foundOrder = await Order.findOne({
                eventId: data.eventId,
                status: "PENDING",
                pickupNumber: parsedNumber
            }).lean() as PendingOrderResult | null
        }

        // Legacy fallback: old pending orders used the last 4 chars of _id as code.
        if (!foundOrder && normalizedCode.length >= 4) {
            const pendingOrders = await Order.find({ eventId: data.eventId, status: "PENDING" })
                .sort({ createdAt: -1 })
                .limit(500)
                .lean()
            foundOrder = (pendingOrders.find(order =>
                order._id.toString().slice(-4).toUpperCase() === normalizedCode
            ) || null) as PendingOrderResult | null
        }

        if (!foundOrder) {
            return { success: false, error: `Nessun ordine in attesa trovato per il numero ${normalizedCode}` }
        }

        const resolvedCode = getOrderCodeFromOrder({
            pickupNumber: foundOrder.pickupNumber,
            _id: foundOrder._id
        }) || normalizedCode

        const productIds = foundOrder.cart.map((item) => item.productId.toString())
        const products = await Product.find({
            _id: { $in: productIds },
            eventId: data.eventId
        }).select("_id basePrice").lean() as Array<{ _id: string | { toString(): string }, basePrice: number }>

        const priceByProductId = new Map(products.map((product) => [product._id.toString(), product.basePrice]))
        const totalQuantity = foundOrder.cart.reduce((sum, item) => sum + item.quantity, 0)
        const fallbackUnitPrice = totalQuantity > 0
            ? Number((foundOrder.totalAmount / totalQuantity).toFixed(2))
            : 0

        return {
            success: true,
            order: {
                id: foundOrder._id.toString(),
                code: resolvedCode,
                totalAmount: foundOrder.totalAmount,
                customer: {
                    name: foundOrder.customer?.name,
                    table: foundOrder.customer?.table
                },
                items: foundOrder.cart.map((item) => ({
                    productId: item.productId.toString(),
                    snapshotName: item.snapshotName,
                    quantity: item.quantity,
                    unitPrice: priceByProductId.get(item.productId.toString()) ?? fallbackUnitPrice
                }))
            }
        }
    } catch (error) {
        console.error("Load Pending Order Error:", error)
        return { success: false, error: "Errore durante il caricamento ordine" }
    }
}

export async function listRecentPendingOrders(data: {
    eventId: string
    limit?: number
}): Promise<
    { success: true, orders: Array<{ id: string, code: string, totalAmount: number, customer?: { name?: string, table?: string }, createdAt?: string }> }
    | { success: false, error: string }
> {
    try {
        if (!data.eventId) {
            return { success: false, error: "Evento non valido" }
        }

        const requestedLimit = data.limit ?? 10
        const safeLimit = Math.min(Math.max(requestedLimit, 1), 20)

        await dbConnect()
        const pendingOrders = await Order.find({ eventId: data.eventId, status: "PENDING" })
            .sort({ createdAt: -1 })
            .limit(safeLimit)
            .select("_id pickupNumber totalAmount customer createdAt")
            .lean() as Array<{
                _id: string | { toString(): string }
                pickupNumber?: number
                totalAmount: number
                customer?: { name?: string, table?: string }
                createdAt?: Date
            }>

        return {
            success: true,
            orders: pendingOrders.map((order) => ({
                id: order._id.toString(),
                code: getOrderCodeFromOrder({
                    pickupNumber: order.pickupNumber,
                    _id: order._id
                }),
                totalAmount: order.totalAmount,
                customer: order.customer,
                createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : undefined
            }))
        }
    } catch (error) {
        console.error("List Pending Orders Error:", error)
        return { success: false, error: "Errore durante il recupero ordini recenti" }
    }
}

export async function completePendingOrderPayment(data: {
    eventId: string
    orderId: string
    paymentMethod: "CASH" | "CARD"
    posDeviceId?: string
    allowStockOverride?: boolean
    customer?: { name?: string, table?: string }
    totalAmount?: number
    orderDiscount?: DiscountInput
    lineDiscounts?: LineDiscountInput[]
    cart?: Array<{
        productId: string
        snapshotName: string
        quantity: number
        selectedOptions?: Array<{ name: string, priceVariation: number }>
    }>
}) {
    let stockAdjustmentsToRollback: StockAdjustment[] = []
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

        const sessionResult = await getOpenCashSession(data.eventId, data.posDeviceId)
        if (!sessionResult.success) {
            return { success: false, error: sessionResult.error, cashSessionRequired: true }
        }

        await dbConnect()
        const order = await Order.findOne({ _id: data.orderId, eventId: data.eventId, status: "PENDING" })
        if (!order) {
            return { success: false, error: "Ordine non trovato o già chiuso" }
        }

        let orderCartInput: PosCartItemInput[] = []

        if (data.cart) {
            const sanitizedCart = sanitizeCartItems(data.cart)
            if (!sanitizedCart) {
                return { success: false, error: "Dati carrello non validi" }
            }
            orderCartInput = sanitizedCart
        } else {
            orderCartInput = sanitizeCartItems(
                order.cart.map((item: {
                    productId: { toString(): string } | string
                    snapshotName: string
                    quantity: number
                    selectedOptions?: Array<{ name: string, priceVariation: number }>
                }) => ({
                    productId: item.productId.toString(),
                    snapshotName: item.snapshotName,
                    quantity: item.quantity,
                    selectedOptions: item.selectedOptions || []
                }))
            ) || []
        }

        if (orderCartInput.length === 0) {
            return { success: false, error: "L'ordine deve contenere almeno un prodotto" }
        }

        if (data.customer) {
            order.set("customer", {
                name: data.customer.name || undefined,
                table: data.customer.table || undefined
            })
        }

        if (typeof data.totalAmount === "number" && (!Number.isFinite(data.totalAmount) || data.totalAmount < 0)) {
            return { success: false, error: "Totale ordine non valido" }
        }

        const pricingResult = await computePricingForCart({
            eventId: data.eventId,
            cart: orderCartInput,
            declaredTotalAmount: data.totalAmount,
            orderDiscount: data.orderDiscount,
            lineDiscounts: data.lineDiscounts
        })
        if (!pricingResult.success) {
            return { success: false, error: pricingResult.error }
        }

        const payableAmount = pricingResult.pricing.finalAmount
        const currentCart = orderCartInput.map((item) => ({
            productId: item.productId,
            snapshotName: item.snapshotName,
            quantity: item.quantity,
            selectedOptions: item.selectedOptions
        }))

        const stockMode: StockMode = data.allowStockOverride ? "override" : "strict"
        const stockApplyResult = await applyStockForPaidOrder(data.eventId, currentCart, stockMode)
        if (!stockApplyResult.success) {
            return {
                success: false,
                error: stockApplyResult.error || "Scorte non sufficienti",
                stockShortages: stockApplyResult.stockShortages
            }
        }
        stockAdjustmentsToRollback = stockApplyResult.appliedAdjustments || []

        order.set("cart", pricingResult.pricing.cartWithDiscounts)
        order.totalAmount = payableAmount
        order.discountApplied = pricingResult.pricing.discountApplied
        order.set("discountMeta", pricingResult.pricing.orderDiscountMeta || undefined)
        order.status = "PAID"
        order.paymentMethod = data.paymentMethod
        order.set("posDeviceId", data.posDeviceId || undefined)
        order.set("cashSessionId", sessionResult.session.id)
        order.set("stockOverrideApproved", Boolean(data.allowStockOverride))
        await order.save()
        stockAdjustmentsToRollback = []

        let printSummary: PrintDispatchSummary | undefined
        try {
            const printResults = await PrinterService.routeOrderToPrinters(order._id.toString(), data.posDeviceId)
            printSummary = summarizePrintDispatch(printResults)
        } catch (printError) {
            console.error("Pending order completed but printer routing failed:", printError)
            printSummary = {
                attempted: 1,
                succeeded: 0,
                failed: 1,
                allSuccessful: false
            }
        }

        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString(), printSummary }
    } catch (error) {
        if (stockAdjustmentsToRollback.length > 0) {
            try {
                await rollbackStockAdjustments(data.eventId, stockAdjustmentsToRollback)
            } catch (rollbackError) {
                console.error("Complete Pending Order rollback error:", rollbackError)
            }
        }
        console.error("Complete Pending Order Error:", error)
        return { success: false, error: "Errore durante la chiusura dell'ordine" }
    }
}
