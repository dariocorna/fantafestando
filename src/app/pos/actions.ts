"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import PosDevice from "@/models/PosDevice"
import Product from "@/models/Product"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import { createSumUpCheckout } from "@/lib/sumup"
import { decryptSecret } from "@/lib/secrets"
import { getOrderCodeFromOrder, parseOrderNumberInput } from "@/lib/order-code"
import {
    aggregateCartQuantities,
    applyStockDecrement,
    collectStockShortages,
    isStockTracked,
    normalizeStockQuantity,
    type CartStockItem,
    type ProductStockInfo,
    type StockMode,
    type StockShortage
} from "@/lib/inventory"

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

interface OrderCartPayloadItem {
    productId: string
    snapshotName: string
    quantity: number
    selectedOptions?: Array<{ name: string, priceVariation: number }>
}

interface StockAdjustment {
    productId: string
    quantity: number
}

interface StockOperationResult {
    success: boolean
    error?: string
    stockShortages?: StockShortage[]
    appliedAdjustments?: StockAdjustment[]
}

function buildDemandMap(cart: OrderCartPayloadItem[]): Map<string, number> {
    const demandItems: CartStockItem[] = cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        snapshotName: item.snapshotName
    }))
    return aggregateCartQuantities(demandItems)
}

async function loadProductStocks(eventId: string, productIds: string[]): Promise<Map<string, ProductStockInfo>> {
    const docs = await Product.find({
        eventId,
        _id: { $in: productIds }
    }).select("_id name stockQuantity isSoldOut").lean() as Array<{
        _id: string | { toString(): string }
        name: string
        stockQuantity?: number | null
        isSoldOut?: boolean
    }>

    return new Map(
        docs.map((doc) => [
            doc._id.toString(),
            {
                id: doc._id.toString(),
                name: doc.name,
                stockQuantity: normalizeStockQuantity(doc.stockQuantity ?? null),
                isSoldOut: Boolean(doc.isSoldOut)
            }
        ])
    )
}

function splitMissingShortages(shortages: StockShortage[]) {
    const missing = shortages.filter((entry) => entry.productName === "Prodotto non trovato")
    const stock = shortages.filter((entry) => entry.productName !== "Prodotto non trovato")
    return { missing, stock }
}

async function syncSoldOutFlags(eventId: string, productIds: string[]) {
    const uniqueProductIds = [...new Set(productIds)]
    if (uniqueProductIds.length === 0) return

    const docs = await Product.find({
        eventId,
        _id: { $in: uniqueProductIds }
    }).select("_id stockQuantity").lean() as Array<{ _id: string | { toString(): string }, stockQuantity?: number | null }>

    for (const doc of docs) {
        const normalizedStock = normalizeStockQuantity(doc.stockQuantity ?? null)
        await Product.updateOne(
            { eventId, _id: doc._id.toString() },
            {
                $set: {
                    stockQuantity: normalizedStock,
                    isSoldOut: normalizedStock !== null ? normalizedStock <= 0 : false
                }
            }
        )
    }
}

function aggregateStockAdjustments(adjustments: StockAdjustment[]): StockAdjustment[] {
    const totals = new Map<string, number>()
    for (const adjustment of adjustments) {
        const productId = adjustment.productId?.trim()
        const quantity = Number(adjustment.quantity)
        if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue
        totals.set(productId, (totals.get(productId) || 0) + quantity)
    }
    return [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity }))
}

async function rollbackStockAdjustments(eventId: string, adjustments: StockAdjustment[]) {
    const aggregatedAdjustments = aggregateStockAdjustments(adjustments)
    if (aggregatedAdjustments.length === 0) return

    for (const adjustment of aggregatedAdjustments) {
        await Product.updateOne(
            { eventId, _id: adjustment.productId },
            { $inc: { stockQuantity: adjustment.quantity } }
        )
    }

    await syncSoldOutFlags(eventId, aggregatedAdjustments.map((entry) => entry.productId))
}

async function decrementTrackedStocksStrict(
    eventId: string,
    demands: Map<string, number>,
    products: Map<string, ProductStockInfo>
): Promise<StockOperationResult> {
    const applied: StockAdjustment[] = []

    for (const [productId, requestedQuantity] of demands.entries()) {
        const product = products.get(productId)
        if (!product || !isStockTracked(product.stockQuantity)) continue

        const updated = await Product.findOneAndUpdate(
            {
                eventId,
                _id: productId,
                stockQuantity: { $gte: requestedQuantity }
            },
            { $inc: { stockQuantity: -requestedQuantity } },
            { new: true }
        ).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

        if (!updated) {
            await rollbackStockAdjustments(eventId, applied)

            const refreshedStocks = await loadProductStocks(eventId, [...demands.keys()])
            const refreshedShortages = collectStockShortages(demands, refreshedStocks)
            return {
                success: false,
                error: "Scorte non sufficienti per completare l'operazione",
                stockShortages: refreshedShortages,
                appliedAdjustments: []
            }
        }

        applied.push({ productId, quantity: requestedQuantity })
    }

    await syncSoldOutFlags(eventId, applied.map((entry) => entry.productId))
    return { success: true, appliedAdjustments: applied }
}

async function decrementTrackedStocksOverride(
    eventId: string,
    demands: Map<string, number>,
    products: Map<string, ProductStockInfo>
): Promise<StockOperationResult> {
    const touched: string[] = []
    const applied: StockAdjustment[] = []

    for (const [productId, requestedQuantity] of demands.entries()) {
        const product = products.get(productId)
        if (!product || !isStockTracked(product.stockQuantity)) continue

        const latestDoc = await Product.findOne({
            eventId,
            _id: productId
        }).select("_id stockQuantity").lean() as ({ _id: string | { toString(): string }, stockQuantity?: number | null } | null)

        if (!latestDoc) {
            await rollbackStockAdjustments(eventId, applied)
            return {
                success: false,
                error: "Prodotto non trovato durante l'aggiornamento scorte",
                stockShortages: [{
                    productId,
                    productName: product.name,
                    requestedQuantity,
                    availableQuantity: 0
                }],
                appliedAdjustments: []
            }
        }

        const normalizedStock = normalizeStockQuantity(latestDoc.stockQuantity ?? null)
        if (!isStockTracked(normalizedStock)) continue

        const result = applyStockDecrement(normalizedStock, requestedQuantity, "override")
        await Product.updateOne(
            { eventId, _id: productId },
            {
                $set: {
                    stockQuantity: result.nextStockQuantity,
                    isSoldOut: (result.nextStockQuantity ?? 0) <= 0
                }
            }
        )
        if (result.appliedQuantity > 0) {
            applied.push({ productId, quantity: result.appliedQuantity })
        }
        touched.push(productId)
    }

    await syncSoldOutFlags(eventId, touched)
    return { success: true, appliedAdjustments: applied }
}

async function applyStockForPaidOrder(
    eventId: string,
    cart: OrderCartPayloadItem[],
    mode: StockMode
): Promise<StockOperationResult> {
    const demands = buildDemandMap(cart)
    if (demands.size === 0) return { success: true }

    const productIds = [...demands.keys()]
    const productStocks = await loadProductStocks(eventId, productIds)
    const shortages = collectStockShortages(demands, productStocks)
    const { missing, stock } = splitMissingShortages(shortages)

    if (missing.length > 0) {
        return {
            success: false,
            error: "Alcuni prodotti non sono più disponibili",
            stockShortages: shortages
        }
    }

    if (mode === "strict" && stock.length > 0) {
        return {
            success: false,
            error: "Scorte non sufficienti per completare l'operazione",
            stockShortages: stock
        }
    }

    if (mode === "strict") {
        return decrementTrackedStocksStrict(eventId, demands, productStocks)
    }

    return decrementTrackedStocksOverride(eventId, demands, productStocks)
}

async function validateStockForPendingOrder(
    eventId: string,
    cart: OrderCartPayloadItem[],
    mode: StockMode
): Promise<StockOperationResult> {
    const demands = buildDemandMap(cart)
    if (demands.size === 0) return { success: true }

    const productStocks = await loadProductStocks(eventId, [...demands.keys()])
    const shortages = collectStockShortages(demands, productStocks)
    const { missing, stock } = splitMissingShortages(shortages)

    if (missing.length > 0) {
        return {
            success: false,
            error: "Alcuni prodotti non sono più disponibili",
            stockShortages: shortages
        }
    }

    if (mode === "strict" && stock.length > 0) {
        return {
            success: false,
            error: "Scorte non sufficienti per completare l'operazione",
            stockShortages: stock
        }
    }

    return { success: true }
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
    posDeviceId?: string,
    allowStockOverride?: boolean
}) {
    let stockAdjustmentsToRollback: StockAdjustment[] = []
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
        const stockMode: StockMode = data.allowStockOverride ? "override" : "strict"
        const isCardPayment = data.paymentMethod === "CARD"

        if (isCardPayment) {
            const stockCheckResult = await validateStockForPendingOrder(data.eventId, data.cart, stockMode)
            if (!stockCheckResult.success) {
                return {
                    success: false,
                    error: stockCheckResult.error || "Scorte non sufficienti",
                    stockShortages: stockCheckResult.stockShortages
                }
            }
        } else {
            const stockApplyResult = await applyStockForPaidOrder(data.eventId, data.cart, stockMode)
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
            totalAmount: data.totalAmount,
            cart: data.cart,
            paymentMethod: data.paymentMethod,
            sumupCheckoutId: isCardPayment ? undefined : data.sumupCheckoutId,
            posDeviceId: data.posDeviceId,
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
                const sumupResult = await triggerSumUpPayment(data.totalAmount, data.eventId, data.posDeviceId)
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

        // Trigger network printing ONLY if PAID immediately.
        // Printing must never block order creation.
        if (order.status === "PAID") {
            try {
                await PrinterService.routeOrderToPrinters(order._id.toString(), data.posDeviceId)
            } catch (printError) {
                console.error("Order created but printer routing failed:", printError)
            }
        }

        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString() }
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
        let foundOrder: {
            _id: string | { toString(): string }
            pickupNumber?: number
            totalAmount: number
            customer?: { name?: string, table?: string }
            cart: Array<{ productId: string | { toString(): string }, snapshotName: string, quantity: number }>
        } | null = null

        if (parsedNumber !== null) {
            foundOrder = await Order.findOne({
                eventId: data.eventId,
                status: "PENDING",
                pickupNumber: parsedNumber
            }).lean() as typeof foundOrder
        }

        // Legacy fallback: old pending orders used the last 4 chars of _id as code.
        if (!foundOrder && normalizedCode.length >= 4) {
            const pendingOrders = await Order.find({ eventId: data.eventId, status: "PENDING" })
                .sort({ createdAt: -1 })
                .limit(500)
                .lean()
            foundOrder = (pendingOrders.find(order =>
                order._id.toString().slice(-4).toUpperCase() === normalizedCode
            ) || null) as typeof foundOrder
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

        await dbConnect()
        const order = await Order.findOne({ _id: data.orderId, eventId: data.eventId, status: "PENDING" })
        if (!order) {
            return { success: false, error: "Ordine non trovato o già chiuso" }
        }

        if (data.cart) {
            if (data.cart.length === 0) {
                return { success: false, error: "L'ordine deve contenere almeno un prodotto" }
            }

            const hasInvalidItem = data.cart.some((item) =>
                !item.productId || !item.snapshotName || !Number.isFinite(item.quantity) || item.quantity < 1
            )
            if (hasInvalidItem) {
                return { success: false, error: "Dati carrello non validi" }
            }

            order.set("cart", data.cart.map((item) => ({
                productId: item.productId,
                snapshotName: item.snapshotName,
                quantity: item.quantity,
                selectedOptions: item.selectedOptions || []
            })))
        }

        if (data.customer) {
            order.set("customer", {
                name: data.customer.name || undefined,
                table: data.customer.table || undefined
            })
        }

        if (typeof data.totalAmount === "number") {
            if (!Number.isFinite(data.totalAmount) || data.totalAmount < 0) {
                return { success: false, error: "Totale ordine non valido" }
            }
            order.totalAmount = data.totalAmount
        }

        const stockMode: StockMode = data.allowStockOverride ? "override" : "strict"
        const currentCart = order.cart.map((item) => ({
            productId: item.productId.toString(),
            snapshotName: item.snapshotName,
            quantity: item.quantity,
            selectedOptions: (item.selectedOptions || []).map((option) => ({
                name: option.name,
                priceVariation: option.priceVariation
            }))
        }))

        const stockApplyResult = await applyStockForPaidOrder(data.eventId, currentCart, stockMode)
        if (!stockApplyResult.success) {
            return {
                success: false,
                error: stockApplyResult.error || "Scorte non sufficienti",
                stockShortages: stockApplyResult.stockShortages
            }
        }
        stockAdjustmentsToRollback = stockApplyResult.appliedAdjustments || []

        order.status = "PAID"
        order.paymentMethod = data.paymentMethod
        order.set("posDeviceId", data.posDeviceId || undefined)
        order.set("stockOverrideApproved", Boolean(data.allowStockOverride))
        await order.save()
        stockAdjustmentsToRollback = []

        revalidatePath("/admin/orders")
        return { success: true, orderId: order._id.toString() }
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
