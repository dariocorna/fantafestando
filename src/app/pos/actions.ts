"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import PosDevice from "@/models/PosDevice"
import Product from "@/models/Product"
import Ingredient from "@/models/Ingredient"
import CashSession from "@/models/CashSession"
import PrintJob from "@/models/PrintJob"
import Event from "@/models/Event"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import { createSumUpCheckout } from "@/lib/sumup"
import { decryptSecret } from "@/lib/secrets"
import { getOrderCodeFromOrder, parseOrderNumberInput } from "@/lib/order-code"
import { resolveDishTicketsForCart } from "@/lib/pizza-ticket"
import { getStockStatus, type StockMode } from "@/lib/inventory"
import { computeCashSessionSummary } from "@/lib/cash-session"
import {
    aggregateOrderProductSales,
    buildProductSalesPrintRows,
    type ProductConsumptionCatalogEntry,
    type ProductConsumptionOrder
} from "@/lib/product-consumption"
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
import {
    requiresPendingState as computeRequiresPendingState,
    type PeripheralType,
    type PosPaymentCapabilities,
} from "@/lib/payment-logic"
import {
    collectReferencedProductIds,
    getProductUnitBasePrice,
    isProductVisibleInChannel,
    normalizeProductKind,
    resolveFixedMenuSelection,
    type MenuSelectionInput,
} from "@/lib/fixed-menu"
import {
    aggregatePendingIngredientQueue,
    attachIngredientCatalogMetadata,
    buildIngredientPlanForCart,
    normalizeRecipeItems,
} from "@/lib/ingredient-plan"
import { shouldReusePendingIngredientPlan } from "@/lib/pending-ingredient-plan"
import { ensurePosAccess } from "@/lib/pos-access"
import { transitionCashSessionStock } from "@/lib/cash-session-stock"
import { buildCashSessionTransitionClaim, CASH_SESSION_TRANSITION_LEASE_MS } from "@/lib/cash-session-transition"
import {
    claimCashSessionPayment,
    hasPendingSumUpCheckouts,
    refreshCashSessionPaymentClaim,
    releaseCashSessionPaymentClaim,
} from "@/lib/cash-session-payment-claim"

interface PrintDispatchSummary {
    attempted: number
    succeeded: number
    failed: number
    allSuccessful: boolean
    failedPrinters: FailedPrinterGroup[]
}

interface FailedPrinterGroup {
    key: string
    name: string
    error?: string
    count: number
    jobIds: string[]
}

async function ensurePosActionSession() {
    const sessionCheck = await ensurePosAccess()
    if (!sessionCheck.ok) {
        return { success: false as const, error: sessionCheck.error }
    }
    return { success: true as const }
}

export async function updatePosStock(data: {
    eventId: string
    productId: string
    variantName?: string
    stockQuantity: number | null
}) {
    const sessionCheck = await ensurePosActionSession()
    if (!sessionCheck.success) return sessionCheck

    if (!data.eventId || !data.productId || (
        data.stockQuantity !== null
        && (!Number.isInteger(data.stockQuantity) || data.stockQuantity < 0)
    )) {
        return { success: false as const, error: "Quantità scorte non valida" }
    }

    await dbConnect()
    const activeEvent = await Event.exists({ _id: data.eventId, active: true, archived: { $ne: true } })
    if (!activeEvent) return { success: false as const, error: "Evento attivo non valido" }

    const query = data.variantName
        ? { _id: data.productId, eventId: data.eventId, "variants.optionName": data.variantName }
        : { _id: data.productId, eventId: data.eventId }
    const update = data.variantName
        ? { $set: { "variants.$.stockQuantity": data.stockQuantity } }
        : { $set: { stockQuantity: data.stockQuantity, isSoldOut: data.stockQuantity === 0 } }
    const product = await Product.findOneAndUpdate(query, update, { returnDocument: "after" })
        .select("_id stockQuantity isSoldOut variants")
        .lean() as ({
            _id: { toString(): string }
            stockQuantity?: number | null
            isSoldOut?: boolean
            variants?: Array<{ optionName?: string, priceVariation?: number, stockQuantity?: number | null }>
        } | null)

    if (!product) return { success: false as const, error: "Prodotto o variante non trovato" }
    return {
        success: true as const,
        product: {
            id: product._id.toString(),
            stockQuantity: product.stockQuantity ?? null,
            isSoldOut: Boolean(product.isSoldOut),
            stockStatus: getStockStatus(product.stockQuantity ?? null, Boolean(product.isSoldOut)),
            variants: (product.variants || []).map((variant) => ({
                optionName: variant.optionName || "",
                priceVariation: Number(variant.priceVariation || 0),
                stockQuantity: variant.stockQuantity ?? null
            }))
        }
    }
}

interface OpenCashSessionDto {
    id: string
    openedAt: string
    openingFloatAmount: number
    openingNotes?: string
    isTest: boolean
    closeFailedError?: string
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

interface PosCartMenuSelection {
    groupId: string
    productId: string
}

interface PosCartItemInput {
    productId: string
    snapshotName: string
    customKitchenNotes?: string
    splitPrintPerUnit?: boolean
    quantity: number
    selectedOptions: PosCartSelectedOption[]
    menuSelections: PosCartMenuSelection[]
}

type PosPricingMode = "STANDARD" | "VOLUNTEER"

interface PosOrderPricingResult {
    baseAmount: number
    discountApplied: number
    finalAmount: number
    discountComponents: Array<{
        scope: "VOLUNTEER" | "LINE" | "ORDER"
        type: "PERCENT" | "FIXED"
        label?: string
        value: number
        baseAmount: number
        appliedAmount: number
        productId?: string
    }>
    cartWithDiscounts: Array<{
        productId: string
        snapshotName: string
        customKitchenNotes?: string
        splitPrintPerUnit?: boolean
        quantity: number
        productKind: "STANDARD" | "FIXED_MENU"
        unitBasePrice: number
        lineTotal: number
        selectedOptions: PosCartSelectedOption[]
        includedComponents?: Array<{
            productId: string
            snapshotName: string
            quantity: number
            source: "FIXED_ITEM" | "CHOICE_OPTION"
            groupName?: string
        }>
        discountApplied: number
        discountMeta?: LineDiscountMeta
    }>
    orderDiscountMeta?: OrderDiscountMeta
}

interface IngredientPlanCartSource {
    productId: string
    snapshotName: string
    quantity: number
}

interface IngredientPlanCartPayload {
    productId: string
    snapshotName: string
    quantity: number
    includedComponents?: IngredientPlanCartSource[]
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
        customKitchenNotes?: string
        splitPrintPerUnit?: boolean
        selectedOptions?: Array<{ name: string, priceVariation: number }>
        menuSelections?: Array<{ groupId: string, productId: string }>
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
            customKitchenNotes: item.customKitchenNotes?.trim() || undefined,
            splitPrintPerUnit: Boolean(item.splitPrintPerUnit),
            quantity: Math.floor(quantity),
            selectedOptions,
            menuSelections: Array.isArray(item.menuSelections)
                ? item.menuSelections
                    .filter((entry) => entry && typeof entry.groupId === "string" && typeof entry.productId === "string")
                    .map((entry) => ({
                        groupId: entry.groupId.trim(),
                        productId: entry.productId.trim()
                    }))
                    .filter((entry) => entry.groupId && entry.productId)
                : []
        })
    }

    return sanitized
}

async function buildPersistedIngredientPlan(
    eventId: string,
    cart: IngredientPlanCartPayload[]
) {
    const productIds = [...new Set(
        cart.flatMap((item) => [
            item.productId,
            ...((item.includedComponents || []).map((component) => component.productId))
        ])
    )]

    if (productIds.length === 0) {
        return []
    }

    const products = await Product.find({
        eventId,
        _id: { $in: productIds }
    }).select("_id name recipeItems").lean() as Array<{
        _id: string | { toString(): string }
        name?: string
        recipeItems?: Array<{
            ingredientId?: string | { toString(): string }
            quantity?: number | null
        }>
    }>

    const productById = new Map(products.map((product) => [product._id.toString(), product]))
    const ingredientIds = [...new Set(
        products.flatMap((product) => normalizeRecipeItems(product.recipeItems).map((entry) => entry.ingredientId))
    )]
    const ingredients = ingredientIds.length > 0
        ? await Ingredient.find({
            eventId,
            _id: { $in: ingredientIds }
        }).select("_id name shortName active").lean() as Array<{
            _id: string | { toString(): string }
            name?: string
            shortName?: string
            active?: boolean
        }>
        : []

    const ingredientById = new Map(ingredients.map((ingredient) => [ingredient._id.toString(), ingredient]))

    return buildIngredientPlanForCart({
        cart,
        productById,
        ingredientById
    })
}

async function computePricingForCart(data: {
    eventId: string
    cart: PosCartItemInput[]
    declaredTotalAmount?: number
    orderDiscount?: DiscountInput
    orderDiscounts?: DiscountInput[]
    lineDiscounts?: LineDiscountInput[]
    pricingMode?: PosPricingMode
}): Promise<
    { success: true, pricing: PosOrderPricingResult }
    | { success: false, error: string }
> {
    const productIds = [...new Set(data.cart.map((item) => item.productId))]
    const productDocs = await Product.find({
        eventId: data.eventId,
        _id: { $in: productIds }
    }).select("_id name basePrice volunteerPrice kind availableOnlyInMenus salesChannels variants menuComponents menuChoiceGroups").lean() as Array<{
        _id: string | { toString(): string }
        name?: string
        basePrice?: number | null
        volunteerPrice?: number | null
        kind?: string
        availableOnlyInMenus?: boolean
        salesChannels?: string[]
        variants?: Array<{ optionName?: string, priceVariation?: number | null }>
        menuComponents?: Array<{ productId?: string | { toString(): string }, quantity?: number | null }>
        menuChoiceGroups?: Array<{
            id?: string
            name?: string
            minSelections?: number | null
            maxSelections?: number | null
            options?: Array<{ productId?: string | { toString(): string }, quantity?: number | null }>
        }>
    }>

    if (productDocs.length !== productIds.length) {
        return { success: false, error: "Impossibile calcolare il totale: prodotti non più disponibili" }
    }

    const referencedProductIds = [...new Set(productDocs.flatMap((product) => collectReferencedProductIds(product)))]
    const referencedProducts = referencedProductIds.length > 0
        ? await Product.find({
            eventId: data.eventId,
            _id: { $in: referencedProductIds }
        }).select("_id name").lean() as Array<{ _id: string | { toString(): string }, name?: string }>
        : []

    const productById = new Map<string, {
        _id: string | { toString(): string }
        name?: string
        basePrice?: number | null
        volunteerPrice?: number | null
        kind?: string
        availableOnlyInMenus?: boolean
        salesChannels?: string[]
        variants?: Array<{ optionName?: string, priceVariation?: number | null }>
        menuComponents?: Array<{ productId?: string | { toString(): string }, quantity?: number | null }>
        menuChoiceGroups?: Array<{
            id?: string
            name?: string
            minSelections?: number | null
            maxSelections?: number | null
            options?: Array<{ productId?: string | { toString(): string }, quantity?: number | null }>
        }>
    }>()
    productDocs.forEach((product) => {
        productById.set(product._id.toString(), product)
    })
    referencedProducts.forEach((product) => {
        if (!productById.has(product._id.toString())) {
            productById.set(product._id.toString(), product)
        }
    })

    const resolvedCart = data.cart.map((item) => {
        const product = productById.get(item.productId)
        if (!product) {
            return { success: false as const, error: "Impossibile calcolare il totale: prodotti non più disponibili" }
        }

        if (!isProductVisibleInChannel(product, "POS")) {
            return { success: false as const, error: "Alcuni prodotti non sono disponibili nel POS" }
        }

        const productKind = normalizeProductKind(product.kind)
        const unitBasePrice = normalizeCurrencyAmount(getProductUnitBasePrice(product))

        if (productKind === "STANDARD") {
            // The client never prices anything: an option costs what the product
            // variant says it costs, and unknown options are worth zero.
            const variantPriceByName = new Map(
                (product.variants || [])
                    .filter((variant) => typeof variant.optionName === "string")
                    .map((variant) => [
                        variant.optionName as string,
                        normalizeCurrencyAmount(Number(variant.priceVariation || 0))
                    ])
            )

            return {
                success: true as const,
                item: {
                    productId: item.productId,
                    snapshotName: item.snapshotName,
                    customKitchenNotes: item.customKitchenNotes,
                    splitPrintPerUnit: item.splitPrintPerUnit,
                    quantity: item.quantity,
                    productKind,
                    unitBasePrice,
                    selectedOptions: item.selectedOptions.map((option) => ({
                        name: option.name,
                        priceVariation: variantPriceByName.get(option.name) ?? 0
                    })),
                    includedComponents: []
                }
            }
        }

        const menuResolution = resolveFixedMenuSelection({
            menu: product,
            productById: new Map(
                [...productById.entries()].map(([key, value]) => [key, { _id: value._id, name: value.name }])
            ),
            selections: item.menuSelections as MenuSelectionInput[]
        })
        if (!menuResolution.success) {
            return { success: false as const, error: menuResolution.error }
        }

        return {
            success: true as const,
            item: {
                productId: item.productId,
                snapshotName: item.snapshotName,
                customKitchenNotes: item.customKitchenNotes,
                splitPrintPerUnit: item.splitPrintPerUnit,
                quantity: item.quantity,
                productKind,
                unitBasePrice,
                selectedOptions: menuResolution.selectedOptions,
                includedComponents: menuResolution.includedComponents.map((component) => ({
                    productId: component.productId,
                    snapshotName: component.snapshotName,
                    quantity: component.quantity,
                    source: component.source,
                    ...(component.groupId ? { groupId: component.groupId } : {}),
                    ...(component.groupName ? { groupName: component.groupName } : {})
                }))
            }
        }
    })

    const resolvedCartError = resolvedCart.find((entry) => !entry.success)
    if (resolvedCartError && !resolvedCartError.success) {
        return { success: false, error: resolvedCartError.error }
    }

    const normalizedCart = resolvedCart
        .filter((entry): entry is Extract<typeof entry, { success: true }> => entry.success)
        .map((entry) => entry.item)

    const pricingMode = data.pricingMode === "VOLUNTEER" ? "VOLUNTEER" : "STANDARD"
    if (pricingMode === "VOLUNTEER" && (data.orderDiscount || (data.orderDiscounts && data.orderDiscounts.length > 0) || (data.lineDiscounts && data.lineDiscounts.length > 0))) {
        return { success: false, error: "La modalità volontari non può essere combinata con altri sconti" }
    }

    if (pricingMode === "VOLUNTEER") {
        let baseAmount = 0
        let discountApplied = 0
        const invalidVolunteerPrice = normalizedCart.some((item) => {
            const product = productById.get(item.productId)
            const optionsDelta = item.selectedOptions.reduce((sum, option) =>
                sum + normalizeCurrencyAmount(option.priceVariation), 0
            )
            const standardUnitAmount = normalizeCurrencyAmount(item.unitBasePrice + optionsDelta)
            const volunteerUnitAmount = typeof product?.volunteerPrice === "number"
                ? normalizeCurrencyAmount(product.volunteerPrice + optionsDelta)
                : standardUnitAmount
            return volunteerUnitAmount > standardUnitAmount
        })
        if (invalidVolunteerPrice) {
            return { success: false, error: "Prezzo volontari non valido: supera il prezzo standard" }
        }

        const cartWithDiscounts = normalizedCart.map((item) => {
            const product = productById.get(item.productId)
            const optionsDelta = item.selectedOptions.reduce((sum, option) =>
                sum + normalizeCurrencyAmount(option.priceVariation), 0
            )
            const standardUnitAmount = normalizeCurrencyAmount(item.unitBasePrice + optionsDelta)
            const volunteerUnitAmount = typeof product?.volunteerPrice === "number"
                ? normalizeCurrencyAmount(product.volunteerPrice + optionsDelta)
                : standardUnitAmount
            const baseLineTotal = normalizeCurrencyAmount(standardUnitAmount * item.quantity)
            const lineTotal = normalizeCurrencyAmount(volunteerUnitAmount * item.quantity)
            const lineDiscountApplied = normalizeCurrencyAmount(Math.max(0, baseLineTotal - lineTotal))

            baseAmount = normalizeCurrencyAmount(baseAmount + baseLineTotal)
            discountApplied = normalizeCurrencyAmount(discountApplied + lineDiscountApplied)

            return {
                productId: item.productId,
                snapshotName: item.snapshotName,
                customKitchenNotes: item.customKitchenNotes,
                splitPrintPerUnit: item.splitPrintPerUnit,
                quantity: item.quantity,
                productKind: item.productKind,
                unitBasePrice: item.unitBasePrice,
                lineTotal,
                selectedOptions: item.selectedOptions,
                includedComponents: item.includedComponents,
                discountApplied: lineDiscountApplied,
                discountMeta: lineDiscountApplied > 0
                    ? {
                        type: "FIXED" as const,
                        value: normalizeCurrencyAmount(standardUnitAmount - volunteerUnitAmount),
                        label: "Volontari",
                        baseUnitAmount: standardUnitAmount
                    }
                    : undefined
            }
        })

        const finalAmount = normalizeCurrencyAmount(baseAmount - discountApplied)

        if (
            typeof data.declaredTotalAmount === "number"
            && Number.isFinite(data.declaredTotalAmount)
            && !amountsAreEquivalent(finalAmount, normalizeCurrencyAmount(data.declaredTotalAmount))
        ) {
            return { success: false, error: "Totale ordine non coerente con la modalità volontari" }
        }

        return {
            success: true,
            pricing: {
                baseAmount,
                discountApplied,
                finalAmount,
                discountComponents: cartWithDiscounts.flatMap((item) => item.discountMeta
                    ? [{
                        scope: "VOLUNTEER" as const,
                        type: item.discountMeta.type,
                        label: item.discountMeta.label,
                        value: item.discountMeta.value,
                        baseAmount: normalizeCurrencyAmount(item.lineTotal + item.discountApplied),
                        appliedAmount: item.discountApplied,
                        productId: item.productId
                    }]
                    : []),
                cartWithDiscounts
            }
        }
    }

    const computedDiscounts = computeOrderDiscounts({
        lines: normalizedCart.map((item) => {
            const optionsDelta = item.selectedOptions.reduce((sum, option) =>
                sum + normalizeCurrencyAmount(option.priceVariation), 0
            )
            return {
                productId: item.productId,
                quantity: item.quantity,
                unitAmount: normalizeCurrencyAmount(item.unitBasePrice + optionsDelta)
            }
        }),
        orderDiscount: data.orderDiscount,
        orderDiscounts: data.orderDiscounts,
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
            discountComponents: [
                ...computedDiscounts.summary.lineResults.flatMap((line) => line.discountMeta
                    ? [{
                        scope: "LINE" as const,
                        type: line.discountMeta.type,
                        label: line.discountMeta.label,
                        value: line.discountMeta.value,
                        baseAmount: line.baseAmount,
                        appliedAmount: line.discountApplied,
                        productId: line.productId
                    }]
                    : []),
                ...computedDiscounts.summary.orderDiscountComponents.map((component) => ({
                    scope: "ORDER" as const,
                    ...component
                }))
            ],
            orderDiscountMeta: computedDiscounts.summary.orderDiscountMeta,
            cartWithDiscounts: normalizedCart.map((item, index) => {
                const line = computedDiscounts.summary.lineResults[index]
                const optionsDelta = item.selectedOptions.reduce((sum, option) =>
                    sum + normalizeCurrencyAmount(option.priceVariation), 0
                )
                const grossLineTotal = normalizeCurrencyAmount((item.unitBasePrice + optionsDelta) * item.quantity)
                return {
                    productId: item.productId,
                    snapshotName: item.snapshotName,
                    customKitchenNotes: item.customKitchenNotes,
                    splitPrintPerUnit: item.splitPrintPerUnit,
                    quantity: item.quantity,
                    productKind: item.productKind,
                    unitBasePrice: item.unitBasePrice,
                    lineTotal: normalizeCurrencyAmount(grossLineTotal - (line?.discountApplied ?? 0)),
                    selectedOptions: item.selectedOptions,
                    includedComponents: item.includedComponents,
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
    isTest?: boolean
    transition?: { status?: string; error?: string } | null
}): OpenCashSessionDto {
    return {
        id: session._id.toString(),
        openedAt: (session.openedAt || new Date()).toISOString(),
        openingFloatAmount: normalizeCurrencyAmount(session.openingFloatAmount ?? 0),
        openingNotes: session.openingNotes?.trim() || undefined,
        isTest: Boolean(session.isTest),
        closeFailedError: session.transition?.status === "FAILED"
            ? session.transition.error || "Chiusura non riuscita"
            : undefined
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
        .populate({ path: "paymentTerminalId", select: "_id type" })
        .populate({ path: "cashBoxId", select: "_id" })
        .lean() as ({ paymentTerminalId?: { _id: unknown, type?: PeripheralType }, cashBoxId?: unknown } | null)

    if (!posDevice) {
        return { success: false, error: "La cassa selezionata non è valida per l'evento corrente" }
    }

    return {
        success: true,
        capabilities: {
            hasCashBox: Boolean(posDevice.cashBoxId),
            hasPaymentTerminal: Boolean(posDevice.paymentTerminalId),
            paymentTerminalType: posDevice.paymentTerminalId?.type
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
        allSuccessful: attempted > 0 && failed === 0,
        failedPrinters: []
    }
}

const PRINT_RETRY_LEASE_MS = 5 * 60 * 1000

async function recoverStalePrintRetryClaims(eventId: string, orderId: string) {
    await PrintJob.updateMany(
        {
            eventId,
            orderId,
            source: "ORDER",
            status: "QUEUED",
            retryClaimedAt: { $lte: new Date(Date.now() - PRINT_RETRY_LEASE_MS) }
        },
        {
            $set: { status: "FAILED", errorMessage: "Reinvio interrotto: riprova" },
            $unset: { retryClaimedAt: 1 }
        }
    )
}

async function listFailedPrinterGroups(eventId: string, orderId: string): Promise<FailedPrinterGroup[]> {
    await recoverStalePrintRetryClaims(eventId, orderId)
    const jobs = await PrintJob.find({ eventId, orderId, source: "ORDER", status: "FAILED" })
        .sort({ createdAt: 1 })
        .populate("printerId", "name ip port")
        .select("_id printerId destinationHost destinationPort errorMessage")
        .lean() as Array<{
            _id: { toString(): string }
            printerId?: { _id?: { toString(): string }; name?: string; ip?: string; port?: number } | null
            destinationHost?: string
            destinationPort?: number
            errorMessage?: string
        }>
    const groups = new Map<string, FailedPrinterGroup>()
    for (const job of jobs) {
        const fallback = `${job.destinationHost || job.printerId?.ip || "stampante"}:${job.destinationPort || job.printerId?.port || 9100}`
        const key = job.printerId?._id?.toString() || fallback
        const current = groups.get(key) || { key, name: job.printerId?.name || fallback, count: 0, jobIds: [] }
        current.count += 1
        current.jobIds.push(job._id.toString())
        current.error ||= job.errorMessage
        groups.set(key, current)
    }
    return [...groups.values()]
}

async function getOpenCashSession(eventId: string, posDeviceId?: string, includeFailedClose = false): Promise<
    { success: true, session: OpenCashSessionDto } | { success: false, error: string }
> {
    if (!eventId || !posDeviceId) {
        return { success: false, error: "Apri una cassa valida prima di completare il pagamento" }
    }

    await dbConnect()
    const openSession = await CashSession.findOne({
        eventId,
        posDeviceId,
        status: "OPEN",
        // a FAILED close leaves the register open: only the status lookup may see it, so the
        // POS keeps the close/retry action while every payment path still refuses the session
        ...(includeFailedClose
            ? { $or: [{ transition: { $exists: false } }, { "transition.status": "FAILED" }] }
            : { transition: { $exists: false } })
    })
        .sort({ openedAt: -1 })
        .select("_id openedAt openingFloatAmount openingNotes isTest transition")
        .lean() as (
            {
                _id: { toString(): string } | string
                openedAt?: Date
                openingFloatAmount?: number
                openingNotes?: string
                isTest?: boolean
                transition?: { status?: string; error?: string } | null
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
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

        if (!data.eventId) {
            return { success: false, error: "Evento non valido" }
        }

        const capabilitiesResult = await getPosPaymentCapabilities(data.eventId, data.posDeviceId)
        if (!capabilitiesResult.success) {
            return { success: false, error: capabilitiesResult.error }
        }

        const sessionResult = await getOpenCashSession(data.eventId, data.posDeviceId, true)
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
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

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
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

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
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

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

        const transitionClaim = buildCashSessionTransitionClaim(openSession.transition, "CLOSE")
        if (!transitionClaim.success) return { success: false, error: transitionClaim.error }
        const transitionToken = transitionClaim.token
        const claimed = await CashSession.findOneAndUpdate(
            {
                _id: openSession._id,
                status: "OPEN",
                $and: [
                    transitionClaim.guard,
                    {
                        $or: [
                            { paymentClaim: { $exists: false } },
                            { paymentClaim: null },
                            { "paymentClaim.claimedAt": { $lte: new Date(transitionClaim.transition.claimedAt.getTime() - CASH_SESSION_TRANSITION_LEASE_MS) } }
                        ]
                    }
                ]
            },
            { $set: { transition: transitionClaim.transition }, $unset: { paymentClaim: 1 } },
            { returnDocument: "after" }
        )
        if (!claimed) return { success: false, error: "Chiusura già in corso: riprova tra poco" }

        // preflight: nothing is mutated yet, so release the claim instead of leaving a FAILED transition behind
        const releaseTransitionClaim = () => CashSession.updateOne(
            { _id: claimed._id, "transition.token": transitionToken, "transition.claimedAt": transitionClaim.transition.claimedAt },
            { $unset: { transition: 1 } }
        )

        if (await hasPendingSumUpCheckouts(claimed._id.toString())) {
            await releaseTransitionClaim()
            return { success: false, error: "Completa o annulla i pagamenti SumUp in attesa prima di chiudere la cassa" }
        }

        if (claimed.isTest) {
            const sumUpOrder = await Order.exists({
                cashSessionId: claimed._id,
                status: "PAID",
                $or: [{ sumupCheckoutId: { $exists: true, $ne: "" } }, { sumupPaymentId: { $exists: true, $ne: "" } }]
            })
            if (sumUpOrder) {
                await releaseTransitionClaim()
                return { success: false, error: "La sessione TEST contiene pagamenti SumUp: stornali e rimborsali prima della chiusura" }
            }
            const stockResult = await transitionCashSessionStock({ eventId: data.eventId, sessionId: claimed._id.toString(), token: transitionToken, target: "REVERTED" })
            if (!stockResult.success) {
                await CashSession.updateOne(
                    { _id: claimed._id, "transition.token": transitionToken, "transition.claimedAt": transitionClaim.transition.claimedAt },
                    { $set: { "transition.status": "FAILED", "transition.error": stockResult.error } }
                )
                return { success: false, error: stockResult.error }
            }
        }

        const { computed } = await computeSummaryForCashSession({
            eventId: data.eventId,
            posDeviceId: data.posDeviceId,
            cashSessionId: claimed._id.toString(),
            openingFloatAmount: normalizeCurrencyAmount(claimed.openingFloatAmount ?? 0),
            closingCountedCashAmount
        })

        const closedAt = new Date()
        const closedSession = await CashSession.findOneAndUpdate(
            {
                _id: claimed._id,
                status: "OPEN",
                "transition.token": transitionToken,
                "transition.claimedAt": transitionClaim.transition.claimedAt
            },
            {
                $set: {
                    status: "CLOSED",
                    stockEffectStatus: claimed.isTest ? "REVERTED" : "APPLIED",
                    closedAt,
                    closingCountedCashAmount,
                    closingNotes: closingNotes || undefined,
                    paidOrdersCount: computed.paidOrdersCount,
                    cashSalesAmount: computed.cashSalesAmount,
                    cardSalesAmount: computed.cardSalesAmount,
                    otherSalesAmount: computed.otherSalesAmount,
                    expectedCashAmount: computed.expectedCashAmount,
                    varianceAmount: computed.varianceAmount
                },
                $unset: { transition: 1 }
            },
            { returnDocument: "after" }
        )
        if (!closedSession) return { success: false, error: "Chiusura interrotta: riprova per completarla" }

        const paidOrdersForSession = await Order.find({
            cashSessionId: claimed._id,
            status: "PAID"
        }).lean() as ProductConsumptionOrder[]

        const productIds = Array.from(
            new Set(
                paidOrdersForSession.flatMap((order) =>
                    (order.cart || [])
                        .map((item) => item.productId ? item.productId.toString() : null)
                        .filter((productId): productId is string => Boolean(productId))
                )
            )
        )

        const catalogProducts = productIds.length > 0
            ? await Product.find({
                eventId: data.eventId,
                _id: { $in: productIds }
            })
                .select("_id name shortName basePrice categoryId")
                .populate("categoryId", "name printOrder")
                .lean() as Array<{
                    _id: string | { toString(): string }
                    name?: string
                    shortName?: string
                    basePrice?: number
                    categoryId?: { name?: string; printOrder?: number }
                }>
            : []

        const catalogByProductId = new Map<string, ProductConsumptionCatalogEntry>(
            catalogProducts.map((product) => [
                product._id.toString(),
                {
                    name: product.name,
                    shortName: product.shortName,
                    basePrice: product.basePrice,
                    categoryName: product.categoryId?.name,
                    categoryOrder: product.categoryId?.printOrder
                }
            ] as const)
        )

        const salesBreakdown = aggregateOrderProductSales({
            orders: paidOrdersForSession,
            catalogByProductId
        })
        const printItems = buildProductSalesPrintRows(salesBreakdown)

        try {
            await PrinterService.printCashSessionSummary(data.eventId, data.posDeviceId, {
                sessionId: closedSession._id.toString(),
                isTest: closedSession.isTest,
                openedAt: closedSession.openedAt,
                closedAt,
                openingFloatAmount: normalizeCurrencyAmount(closedSession.openingFloatAmount ?? 0),
                cashSalesAmount: computed.cashSalesAmount,
                cardSalesAmount: computed.cardSalesAmount,
                otherSalesAmount: computed.otherSalesAmount,
                expectedCashAmount: computed.expectedCashAmount,
                closingCountedCashAmount,
                varianceAmount: computed.varianceAmount,
                paidOrdersCount: computed.paidOrdersCount,
                openingNotes: closedSession.openingNotes,
                closingNotes: closingNotes || undefined,
                grossSalesAmount: salesBreakdown.totals.grossAmount,
                discountSalesAmount: salesBreakdown.totals.discountAmount,
                discountSummaries: salesBreakdown.discountSummaries.map((summary) => ({
                    label: summary.label,
                    amount: summary.discountAmount
                })),
                items: printItems
            })
        } catch (printError) {
            console.error("Cash session closed but summary print failed:", printError)
        }

        revalidatePath("/pos")
        revalidatePath("/admin")
        return {
            success: true,
            summary: {
                sessionId: closedSession._id.toString(),
                openingFloatAmount: normalizeCurrencyAmount(closedSession.openingFloatAmount ?? 0),
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
        customKitchenNotes?: string,
        splitPrintPerUnit?: boolean,
        quantity: number,
        selectedOptions: Array<{ name: string, priceVariation: number }>
        menuSelections?: Array<{ groupId: string, productId: string }>
    }>,
    orderDiscount?: DiscountInput,
    orderDiscounts?: DiscountInput[],
    lineDiscounts?: LineDiscountInput[],
    pricingMode?: PosPricingMode,
    paymentMethod: "CASH" | "CARD" | "OTHER",
    sumupCheckoutId?: string,
    posDeviceId?: string,
    allowStockOverride?: boolean
}) {
    let stockAdjustmentsToRollback: StockAdjustment[] = []
    let paymentClaimToken: string | undefined
    let paymentClaimSessionId: string | undefined
    try {
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

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
            orderDiscounts: data.orderDiscounts,
            lineDiscounts: data.lineDiscounts,
            pricingMode: data.pricingMode
        })
        if (!pricingResult.success) {
            return { success: false, error: pricingResult.error }
        }

        const payableAmount = pricingResult.pricing.finalAmount
        const stockPayload = pricingResult.pricing.cartWithDiscounts.map((item) => ({
            productId: item.productId,
            snapshotName: item.snapshotName,
            quantity: item.quantity,
            selectedOptions: item.selectedOptions,
            includedComponents: item.includedComponents
        }))
        const ingredientPlan = await buildPersistedIngredientPlan(
            data.eventId,
            pricingResult.pricing.cartWithDiscounts.map((item) => ({
                productId: item.productId,
                snapshotName: item.snapshotName,
                quantity: item.quantity,
                includedComponents: item.includedComponents?.map((component) => ({
                    productId: component.productId,
                    snapshotName: component.snapshotName,
                    quantity: component.quantity
                }))
            }))
        )
        const dishTickets = await resolveDishTicketsForCart(
            data.eventId,
            pricingResult.pricing.cartWithDiscounts.map((item) => ({
                productId: item.productId,
                snapshotName: item.snapshotName,
                quantity: item.quantity,
                splitPrintPerUnit: item.splitPrintPerUnit,
                includedComponents: item.includedComponents?.map((component) => ({
                    productId: component.productId,
                    snapshotName: component.snapshotName,
                    quantity: component.quantity
                }))
            }))
        )

        const stockMode: StockMode = data.allowStockOverride ? "override" : "strict"
        const requiresPendingState = computeRequiresPendingState(data.paymentMethod, capabilitiesResult.capabilities)
        const paymentClaim = await claimCashSessionPayment(sessionResult.session.id)
        if (!paymentClaim.success) {
            return { success: false, error: "La cassa è in chiusura o sta completando un altro pagamento", cashSessionRequired: true }
        }
        paymentClaimToken = paymentClaim.token
        paymentClaimSessionId = sessionResult.session.id
        if (paymentClaim.isTest && requiresPendingState) {
            await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
            paymentClaimToken = undefined
            return { success: false, error: "I pagamenti sul terminale SumUp sono bloccati nelle sessioni TEST" }
        }

        if (requiresPendingState) {
            const stockCheckResult = await validateStockForPendingOrder(data.eventId, stockPayload, stockMode, ingredientPlan)
            if (!stockCheckResult.success) {
                await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
                paymentClaimToken = undefined
                return {
                    success: false,
                    error: stockCheckResult.error || "Scorte non sufficienti",
                    stockShortages: stockCheckResult.stockShortages
                }
            }
        } else {
            const stockApplyResult = await applyStockForPaidOrder(data.eventId, stockPayload, stockMode, ingredientPlan)
            if (!stockApplyResult.success) {
                await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
                paymentClaimToken = undefined
                return {
                    success: false,
                    error: stockApplyResult.error || "Scorte non sufficienti",
                    stockShortages: stockApplyResult.stockShortages
                }
            }
            stockAdjustmentsToRollback = stockApplyResult.appliedAdjustments || []
        }
        if (!await refreshCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)) {
            if (stockAdjustmentsToRollback.length > 0) await rollbackStockAdjustments(data.eventId, stockAdjustmentsToRollback)
            stockAdjustmentsToRollback = []
            await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
            paymentClaimToken = undefined
            return { success: false, error: "La sessione cassa è stata chiusa durante il pagamento", cashSessionRequired: true }
        }

        const order = await Order.create({
            eventId: data.eventId,
            status: requiresPendingState ? "PENDING" : "PAID",
            customer: data.customer,
            totalAmount: payableAmount,
            discountApplied: pricingResult.pricing.discountApplied,
            discountMeta: pricingResult.pricing.orderDiscountMeta,
            discountComponents: pricingResult.pricing.discountComponents,
            pricingMode: data.pricingMode === "VOLUNTEER" ? "VOLUNTEER" : "STANDARD",
            cart: pricingResult.pricing.cartWithDiscounts,
            ingredientPlan,
            dishTickets,
            paymentMethod: data.paymentMethod,
            sumupCheckoutId: requiresPendingState ? undefined : data.sumupCheckoutId,
            posDeviceId: data.posDeviceId,
            cashSessionId: sessionResult.session.id,
            stockOverrideApproved: Boolean(data.allowStockOverride),
            stockAdjustments: stockAdjustmentsToRollback,
            stockEffectStatus: requiresPendingState ? undefined : "APPLIED"
        })
        stockAdjustmentsToRollback = []

        if (requiresPendingState) {
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
                    await releaseCashSessionPaymentClaim(paymentClaimSessionId || "", paymentClaimToken)
                    paymentClaimToken = undefined
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
                    await releaseCashSessionPaymentClaim(paymentClaimSessionId || "", paymentClaimToken)
                    paymentClaimToken = undefined
                    return { success: false, error: "Impossibile associare il checkout SumUp all'ordine" }
                }
            }
        }

        await releaseCashSessionPaymentClaim(paymentClaimSessionId || "", paymentClaimToken)
        paymentClaimToken = undefined

        let printSummary: PrintDispatchSummary | undefined

        // Trigger network printing ONLY if PAID immediately.
        if (order.status === "PAID") {
            try {
                const printResults = await PrinterService.routeOrderToPrinters(order._id.toString(), data.posDeviceId)
                printSummary = summarizePrintDispatch(printResults)
                if (printSummary.failed > 0) printSummary.failedPrinters = await listFailedPrinterGroups(data.eventId, order._id.toString())
            } catch (printError) {
                console.error("Order created but printer routing failed:", printError)
                printSummary = {
                    attempted: 1,
                    succeeded: 0,
                    failed: 1,
                    allSuccessful: false,
                    failedPrinters: await listFailedPrinterGroups(data.eventId, order._id.toString())
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
        if (paymentClaimSessionId && paymentClaimToken) {
            try {
                await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
            } catch (releaseError) {
                console.error("Create Order payment claim release error:", releaseError)
            }
        }
        console.error("Create Order Error:", error)
        return { success: false, error: "Failed to create order" }
    }
}

export async function triggerSumUpPayment(amount: number, eventId: string, posDeviceId?: string) {
    try {
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

        const cashSessionResult = await getOpenCashSession(eventId, posDeviceId)
        if (!cashSessionResult.success) return cashSessionResult
        if (cashSessionResult.session.isTest) {
            return { success: false, error: "I pagamenti sul terminale SumUp sono bloccati nelle sessioni TEST" }
        }

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
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

        const pendingOrderLookupProjection =
            "_id pickupNumber totalAmount customer pricingMode cart easterEggAttachment.uploadedAt easterEggAttachment.printedAt"
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
            pricingMode?: PosPricingMode
            customer?: { name?: string, table?: string }
            cart: Array<{
                productId: string | { toString(): string }
                snapshotName: string
                customKitchenNotes?: string
                splitPrintPerUnit?: boolean
                quantity: number
                unitBasePrice?: number
                lineTotal?: number
                selectedOptions?: Array<{ name: string, priceVariation: number }>
                includedComponents?: Array<{
                    productId: string | { toString(): string }
                    source?: "FIXED_ITEM" | "CHOICE_OPTION"
                    groupId?: string
                }>
            }>
            easterEggAttachment?: { uploadedAt?: Date | string | null, printedAt?: Date | string | null }
        }

        let foundOrder: PendingOrderResult | null = null

        if (parsedNumber !== null) {
            foundOrder = await Order.findOne({
                eventId: data.eventId,
                status: "PENDING",
                pickupNumber: parsedNumber
            }).select(pendingOrderLookupProjection).lean() as PendingOrderResult | null
        }

        // Legacy fallback: old pending orders used the last 4 chars of _id as code.
        if (!foundOrder && normalizedCode.length >= 4) {
            const pendingOrders = await Order.find({ eventId: data.eventId, status: "PENDING" })
                .sort({ createdAt: -1 })
                .limit(500)
                .select(pendingOrderLookupProjection)
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

        const resolvedPricingMode: PosPricingMode = foundOrder.pricingMode === "VOLUNTEER" ? "VOLUNTEER" : "STANDARD"

        return {
            success: true,
            order: {
                id: foundOrder._id.toString(),
                code: resolvedCode,
                totalAmount: foundOrder.totalAmount,
                pricingMode: resolvedPricingMode,
                customer: {
                    name: foundOrder.customer?.name,
                    table: foundOrder.customer?.table
                },
                easterEggAttached: Boolean(
                    foundOrder.easterEggAttachment?.uploadedAt
                    && !foundOrder.easterEggAttachment?.printedAt
                ),
                items: foundOrder.cart.map((item) => ({
                    productId: item.productId.toString(),
                    snapshotName: item.snapshotName,
                    customKitchenNotes: item.customKitchenNotes,
                    splitPrintPerUnit: Boolean(item.splitPrintPerUnit),
                    quantity: item.quantity,
                    unitPrice: Number.isFinite(item.unitBasePrice)
                        ? Number(item.unitBasePrice)
                        : (Number.isFinite(item.lineTotal) && item.quantity > 0
                            ? Number((Number(item.lineTotal) / item.quantity).toFixed(2))
                            : (priceByProductId.get(item.productId.toString()) ?? fallbackUnitPrice)),
                    volunteerPrice: resolvedPricingMode === "VOLUNTEER" && Number.isFinite(item.lineTotal) && item.quantity > 0
                        ? Number((Number(item.lineTotal) / item.quantity).toFixed(2))
                        : undefined,
                    selectedOptions: item.selectedOptions || [],
                    menuSelections: (item.includedComponents || [])
                        .filter((component) => component.source === "CHOICE_OPTION" && component.groupId)
                        .map((component) => ({
                            groupId: component.groupId || "",
                            productId: component.productId.toString()
                        }))
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
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

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

export async function listPendingIngredientQueue(data: {
    eventId: string
    limit?: number
}): Promise<
    { success: true, items: Array<{ ingredientKey: string, label: string, quantity: number, orderCount: number, legacy: boolean, stockQuantity?: number | null, remainingStockQuantity?: number | null, active?: boolean }> }
    | { success: false, error: string }
> {
    try {
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

        if (!data.eventId) {
            return { success: false, error: "Evento non valido" }
        }

        const requestedLimit = data.limit ?? 12
        const safeLimit = Math.min(Math.max(requestedLimit, 1), 30)

        await dbConnect()
        const pendingOrders = await Order.find({ eventId: data.eventId, status: "PENDING" })
            .select("ingredientPlan cart")
            .lean() as Array<{
                ingredientPlan?: Array<{
                    ingredientId?: string | { toString(): string }
                    snapshotName?: string
                    quantity?: number
                    sourceProductId?: string | { toString(): string }
                    sourceProductName?: string
                    legacy?: boolean
                }>
                cart?: Array<{
                    productId?: string | { toString(): string }
                    snapshotName?: string
                    quantity?: number
                    includedComponents?: Array<{
                        productId?: string | { toString(): string }
                        snapshotName?: string
                        quantity?: number
                    }>
                }>
            }>

        const aggregatedQueue = aggregatePendingIngredientQueue(pendingOrders)
        const ingredientIds = aggregatedQueue
            .filter((entry) => entry.ingredientKey.startsWith("ingredient:"))
            .map((entry) => entry.ingredientKey.slice("ingredient:".length))

        const ingredients = ingredientIds.length > 0
            ? await Ingredient.find({
                eventId: data.eventId,
                _id: { $in: ingredientIds }
            }).select("_id stockQuantity active").lean() as Array<{
                _id: string | { toString(): string }
                stockQuantity?: number | null
                active?: boolean
            }>
            : []

        return {
            success: true,
            items: attachIngredientCatalogMetadata(
                aggregatedQueue,
                new Map(ingredients.map((ingredient) => [ingredient._id.toString(), ingredient]))
            ).slice(0, safeLimit)
        }
    } catch (error) {
        console.error("List Pending Ingredient Queue Error:", error)
        return { success: false, error: "Errore durante il recupero ingredienti in coda" }
    }
}

export async function printProductIngredients(data: {
    eventId: string
    posDeviceId?: string
    productId: string
    removedIngredientIds?: string[]
    addedIngredientIds?: string[]
    customNote?: string
}) {
    try {
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

        if (!data.eventId || !data.posDeviceId || !data.productId) {
            return { success: false, error: "Dati stampa ingredienti incompleti" }
        }

        await dbConnect()
        const [product, posDevice] = await Promise.all([
            Product.findOne({ _id: data.productId, eventId: data.eventId })
                .select("_id name shortName recipeItems")
                .lean() as Promise<{
                    _id: string | { toString(): string }
                    name?: string
                    shortName?: string
                    recipeItems?: Array<{ ingredientId?: string | { toString(): string }, quantity?: number | null }>
                } | null>,
            PosDevice.findOne({ _id: data.posDeviceId, eventId: data.eventId })
                .populate({ path: "printerId", select: "_id ip port isVirtual emulatorSlot" })
                .lean() as Promise<{
                    printerId?: {
                        _id?: unknown
                        ip?: string
                        port?: number
                        isVirtual?: boolean
                        emulatorSlot?: number
                    } | null
                } | null>
        ])

        if (!product) {
            return { success: false, error: "Prodotto non trovato" }
        }
        if (!posDevice?.printerId?.ip) {
            return { success: false, error: "La cassa selezionata non ha una stampante configurata" }
        }

        const recipeIngredientIds = normalizeRecipeItems(product.recipeItems).map((entry) => entry.ingredientId)
        const requestedIngredientIds = [
            ...recipeIngredientIds,
            ...(data.removedIngredientIds || []),
            ...(data.addedIngredientIds || [])
        ].filter((id, index, ids) => id && ids.indexOf(id) === index)
        const ingredients = requestedIngredientIds.length > 0
            ? await Ingredient.find({ eventId: data.eventId, _id: { $in: requestedIngredientIds } })
                .select("_id name shortName active")
                .lean() as Array<{ _id: string | { toString(): string }, name?: string, shortName?: string, active?: boolean }>
            : []
        const ingredientById = new Map(ingredients.map((ingredient) => [
            ingredient._id.toString(),
            {
                label: ingredient.shortName?.trim() || ingredient.name?.trim() || "Ingrediente",
                active: ingredient.active !== false
            }
        ]))
        const removedIds = new Set(data.removedIngredientIds || [])
        const recipeNames = recipeIngredientIds
            .filter((id) => !removedIds.has(id))
            .map((id) => ingredientById.get(id))
            .map((ingredient) => ingredient?.label)
            .filter((name): name is string => Boolean(name))
        const addedNames = (data.addedIngredientIds || [])
            .map((id) => ingredientById.get(id))
            .filter((ingredient) => ingredient?.active)
            .map((ingredient) => ingredient?.label)
            .filter((name): name is string => Boolean(name))
        const removedNames = (data.removedIngredientIds || [])
            .map((id) => ingredientById.get(id))
            .map((ingredient) => ingredient?.label)
            .filter((name): name is string => Boolean(name))
        const noteLines = [
            recipeNames.length > 0 ? `Ingredienti: ${recipeNames.join(", ")}` : "Ingredienti: non configurati",
            addedNames.length > 0 ? `Aggiunte: ${addedNames.join(", ")}` : "",
            removedNames.length > 0 ? `Senza: ${removedNames.join(", ")}` : "",
            data.customNote?.trim() ? `Nota: ${data.customNote.trim()}` : ""
        ].filter(Boolean)

        const printed = await PrinterService.printComanda({
            ip: posDevice.printerId.ip,
            port: posDevice.printerId.port,
            emulatorSlot: posDevice.printerId.emulatorSlot,
            printerId: posDevice.printerId._id ? String(posDevice.printerId._id) : undefined,
            eventId: data.eventId,
            source: "MANUAL_TEST",
            printType: "MANUAL_TEST",
            isVirtual: Boolean(posDevice.printerId.isVirtual),
            title: "INGREDIENTI PIATTO",
            copyLabel: "STAMPA INGREDIENTI",
            orderId: `ingredienti-${Date.now()}`,
            items: [{
                name: product.shortName?.trim() || product.name?.trim() || "Prodotto",
                quantity: 1,
                notes: noteLines.join(" | ")
            }]
        }, 1)

        if (!printed) {
            return { success: false, error: "Invio stampa ingredienti fallito" }
        }

        return { success: true }
    } catch (error) {
        console.error("Print Product Ingredients Error:", error)
        return { success: false, error: "Errore durante la stampa ingredienti" }
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
    orderDiscounts?: DiscountInput[]
    lineDiscounts?: LineDiscountInput[]
    pricingMode?: PosPricingMode
    cart?: Array<{
        productId: string
        snapshotName: string
        customKitchenNotes?: string
        splitPrintPerUnit?: boolean
        quantity: number
        selectedOptions?: Array<{ name: string, priceVariation: number }>
        menuSelections?: Array<{ groupId: string, productId: string }>
    }>
}) {
    let stockAdjustmentsToRollback: StockAdjustment[] = []
    let paymentClaimToken: string | undefined
    let paymentClaimSessionId: string | undefined
    try {
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

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

        const persistedOrderCartInput = sanitizeCartItems(
            order.cart.map((item: {
                productId: { toString(): string } | string
                snapshotName: string
                customKitchenNotes?: string
                splitPrintPerUnit?: boolean
                quantity: number
                selectedOptions?: Array<{ name: string, priceVariation: number }>
                includedComponents?: Array<{
                    productId: { toString(): string } | string
                    source?: "FIXED_ITEM" | "CHOICE_OPTION"
                    groupId?: string
                    groupName?: string
                }>
            }) => ({
                productId: item.productId.toString(),
                snapshotName: item.snapshotName,
                customKitchenNotes: item.customKitchenNotes,
                splitPrintPerUnit: Boolean(item.splitPrintPerUnit),
                quantity: item.quantity,
                selectedOptions: item.selectedOptions || [],
                menuSelections: (item.includedComponents || [])
                    .filter((component) => component.source === "CHOICE_OPTION" && component.groupId)
                    .map((component) => ({
                        groupId: component.groupId || "",
                        productId: component.productId.toString()
                    }))
            }))
        ) || []

        let orderCartInput: PosCartItemInput[] = []

        if (data.cart) {
            const sanitizedCart = sanitizeCartItems(data.cart)
            if (!sanitizedCart) {
                return { success: false, error: "Dati carrello non validi" }
            }
            orderCartInput = sanitizedCart
        } else {
            orderCartInput = persistedOrderCartInput
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

        const pendingPricingMode = data.pricingMode || order.pricingMode
        let pricingResult: Awaited<ReturnType<typeof computePricingForCart>>
        if (
            pendingPricingMode === "VOLUNTEER"
            && order.pricingMode === "VOLUNTEER"
            && !data.orderDiscount
            && (!data.orderDiscounts || data.orderDiscounts.length === 0)
            && (!data.lineDiscounts || data.lineDiscounts.length === 0)
            && shouldReusePendingIngredientPlan(orderCartInput, persistedOrderCartInput)
        ) {
            const persistedFinalAmount = normalizeCurrencyAmount(Number(order.totalAmount || 0))
            if (
                typeof data.totalAmount === "number"
                && Number.isFinite(data.totalAmount)
                && !amountsAreEquivalent(persistedFinalAmount, normalizeCurrencyAmount(data.totalAmount))
            ) {
                return { success: false, error: "Totale ordine non coerente con la modalità volontari" }
            }

            pricingResult = {
                success: true,
                pricing: {
                    baseAmount: normalizeCurrencyAmount(persistedFinalAmount + Number(order.discountApplied || 0)),
                    discountApplied: normalizeCurrencyAmount(Number(order.discountApplied || 0)),
                    finalAmount: persistedFinalAmount,
                    discountComponents: Array.isArray(order.discountComponents)
                        ? order.discountComponents.map((component: {
                            scope: "VOLUNTEER" | "LINE" | "ORDER"
                            type: "PERCENT" | "FIXED"
                            label?: string
                            value: number
                            baseAmount: number
                            appliedAmount: number
                            productId?: { toString(): string } | string
                        }) => ({
                            scope: component.scope,
                            type: component.type,
                            label: component.label,
                            value: component.value,
                            baseAmount: component.baseAmount,
                            appliedAmount: component.appliedAmount,
                            productId: component.productId?.toString()
                        }))
                        : [],
                    cartWithDiscounts: order.cart.map((item: {
                        productId: { toString(): string } | string
                        snapshotName: string
                        customKitchenNotes?: string
                        splitPrintPerUnit?: boolean
                        quantity: number
                        productKind?: "STANDARD" | "FIXED_MENU"
                        unitBasePrice?: number
                        lineTotal?: number
                        selectedOptions?: Array<{ name: string, priceVariation: number }>
                        includedComponents?: Array<{
                            productId: { toString(): string } | string
                            snapshotName: string
                            quantity: number
                            source: "FIXED_ITEM" | "CHOICE_OPTION"
                            groupId?: string
                            groupName?: string
                        }>
                        discountApplied?: number
                        discountMeta?: LineDiscountMeta
                    }, index: number) => {
                        const inputItem = orderCartInput[index]
                        return {
                            productId: item.productId.toString(),
                            snapshotName: item.snapshotName,
                            // La guardia shouldReusePendingIngredientPlan garantisce l'allineamento per indice:
                            // usa la nota del client così com'è (anche se svuotata), senza ripescare la persistita.
                            customKitchenNotes: inputItem ? inputItem.customKitchenNotes : item.customKitchenNotes,
                            splitPrintPerUnit: Boolean(inputItem?.splitPrintPerUnit ?? item.splitPrintPerUnit),
                            quantity: item.quantity,
                            productKind: item.productKind || "STANDARD",
                            unitBasePrice: normalizeCurrencyAmount(Number(item.unitBasePrice || 0)),
                            lineTotal: normalizeCurrencyAmount(Number(item.lineTotal || 0)),
                            selectedOptions: item.selectedOptions || [],
                            includedComponents: item.includedComponents?.map((component) => ({
                                productId: component.productId.toString(),
                                snapshotName: component.snapshotName,
                                quantity: component.quantity,
                                source: component.source,
                                ...(component.groupId ? { groupId: component.groupId } : {}),
                                ...(component.groupName ? { groupName: component.groupName } : {})
                            })),
                            discountApplied: normalizeCurrencyAmount(Number(item.discountApplied || 0)),
                            discountMeta: item.discountMeta
                        }
                    })
                }
            }
        } else {
            pricingResult = await computePricingForCart({
                eventId: data.eventId,
                cart: orderCartInput,
                declaredTotalAmount: data.totalAmount,
                orderDiscount: data.orderDiscount,
                orderDiscounts: data.orderDiscounts,
                lineDiscounts: data.lineDiscounts,
                pricingMode: pendingPricingMode
            })
        }
        if (!pricingResult.success) {
            return { success: false, error: pricingResult.error }
        }

        const payableAmount = pricingResult.pricing.finalAmount
        const currentCart = pricingResult.pricing.cartWithDiscounts.map((item) => ({
            productId: item.productId,
            snapshotName: item.snapshotName,
            quantity: item.quantity,
            selectedOptions: item.selectedOptions,
            includedComponents: item.includedComponents
        }))
        const shouldReusePersistedPlan = Array.isArray(order.ingredientPlan)
            && order.ingredientPlan.length > 0
            && shouldReusePendingIngredientPlan(orderCartInput, persistedOrderCartInput)
        const ingredientPlan = shouldReusePersistedPlan
            ? order.ingredientPlan.map((entry: {
                ingredientId?: { toString(): string } | string
                snapshotName: string
                quantity: number
                sourceProductId?: { toString(): string } | string
                sourceProductName?: string
                legacy?: boolean
            }) => ({
                ingredientId: entry.ingredientId?.toString(),
                snapshotName: entry.snapshotName,
                quantity: entry.quantity,
                sourceProductId: entry.sourceProductId?.toString(),
                sourceProductName: entry.sourceProductName,
                legacy: Boolean(entry.legacy)
            }))
            : await buildPersistedIngredientPlan(
                data.eventId,
                pricingResult.pricing.cartWithDiscounts.map((item) => ({
                    productId: item.productId,
                    snapshotName: item.snapshotName,
                    quantity: item.quantity,
                    includedComponents: item.includedComponents?.map((component) => ({
                        productId: component.productId,
                        snapshotName: component.snapshotName,
                        quantity: component.quantity
                    }))
                }))
            )
        const dishTickets = await resolveDishTicketsForCart(
            data.eventId,
            pricingResult.pricing.cartWithDiscounts.map((item) => ({
                productId: item.productId,
                snapshotName: item.snapshotName,
                quantity: item.quantity,
                splitPrintPerUnit: item.splitPrintPerUnit,
                includedComponents: item.includedComponents?.map((component) => ({
                    productId: component.productId,
                    snapshotName: component.snapshotName,
                    quantity: component.quantity
                }))
            })),
            order.dishTickets
        )

        const stockMode: StockMode = data.allowStockOverride ? "override" : "strict"
        const paymentClaim = await claimCashSessionPayment(sessionResult.session.id)
        if (!paymentClaim.success) {
            return { success: false, error: "La cassa è in chiusura o sta completando un altro pagamento", cashSessionRequired: true }
        }
        paymentClaimToken = paymentClaim.token
        paymentClaimSessionId = sessionResult.session.id
        const stockApplyResult = await applyStockForPaidOrder(data.eventId, currentCart, stockMode, ingredientPlan)
        if (!stockApplyResult.success) {
            await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
            paymentClaimToken = undefined
            return {
                success: false,
                error: stockApplyResult.error || "Scorte non sufficienti",
                stockShortages: stockApplyResult.stockShortages
            }
        }
        stockAdjustmentsToRollback = stockApplyResult.appliedAdjustments || []
        if (!await refreshCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)) {
            await rollbackStockAdjustments(data.eventId, stockAdjustmentsToRollback)
            stockAdjustmentsToRollback = []
            await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
            paymentClaimToken = undefined
            return { success: false, error: "La sessione cassa è stata chiusa durante il pagamento", cashSessionRequired: true }
        }

        order.set("cart", pricingResult.pricing.cartWithDiscounts)
        order.set("ingredientPlan", ingredientPlan)
        order.set("dishTickets", dishTickets)
        order.totalAmount = payableAmount
        order.discountApplied = pricingResult.pricing.discountApplied
        order.set("discountMeta", pricingResult.pricing.orderDiscountMeta || undefined)
        order.set("discountComponents", pricingResult.pricing.discountComponents)
        order.set("pricingMode", pendingPricingMode === "VOLUNTEER" ? "VOLUNTEER" : "STANDARD")
        order.status = "PAID"
        order.paymentMethod = data.paymentMethod
        order.set("posDeviceId", data.posDeviceId || undefined)
        order.set("cashSessionId", sessionResult.session.id)
        order.set("stockOverrideApproved", Boolean(data.allowStockOverride))
        order.set("stockAdjustments", stockAdjustmentsToRollback)
        order.set("stockEffectStatus", "APPLIED")
        await order.save()
        stockAdjustmentsToRollback = []
        await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
        paymentClaimToken = undefined

        let printSummary: PrintDispatchSummary | undefined
        try {
            const printResults = await PrinterService.routeOrderToPrinters(order._id.toString(), data.posDeviceId)
            printSummary = summarizePrintDispatch(printResults)
            if (printSummary.failed > 0) printSummary.failedPrinters = await listFailedPrinterGroups(data.eventId, order._id.toString())
        } catch (printError) {
            console.error("Pending order completed but printer routing failed:", printError)
            printSummary = {
                attempted: 1,
                succeeded: 0,
                failed: 1,
                allSuccessful: false,
                failedPrinters: await listFailedPrinterGroups(data.eventId, order._id.toString())
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
        if (paymentClaimSessionId && paymentClaimToken) {
            try {
                await releaseCashSessionPaymentClaim(paymentClaimSessionId, paymentClaimToken)
            } catch (releaseError) {
                console.error("Complete Pending Order payment claim release error:", releaseError)
            }
        }
        console.error("Complete Pending Order Error:", error)
        return { success: false, error: "Errore durante la chiusura dell'ordine" }
    }
}

export async function retryFailedOrderPrintJobs(data: {
    orderId: string
    jobIds: string[]
}): Promise<
    { success: true, retried: number, failed: number, attempted: number, failedPrinters: FailedPrinterGroup[] }
    | { success: false, error: string }
> {
    try {
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

        if (!data.orderId || !Array.isArray(data.jobIds) || data.jobIds.length === 0) {
            return { success: false, error: "Dati mancanti per il reinvio stampa" }
        }

        await dbConnect()
        const order = await Order.findOne({ _id: data.orderId, status: "PAID" }).select("eventId").lean() as ({ eventId: { toString(): string } } | null)
        if (!order) return { success: false, error: "Ordine pagato non trovato" }
        const eventId = order.eventId.toString()
        await recoverStalePrintRetryClaims(eventId, data.orderId)
        const failedJobs = await PrintJob.find({
            eventId,
            orderId: data.orderId,
            source: "ORDER",
            status: "FAILED",
            _id: { $in: data.jobIds }
        })
            .sort({ createdAt: 1 })
            .select("_id")
            .lean() as Array<{ _id: { toString(): string } | string }>

        if (failedJobs.length === 0) {
            return { success: true, retried: 0, failed: 0, attempted: 0, failedPrinters: await listFailedPrinterGroups(eventId, data.orderId) }
        }

        const results = []
        for (const job of failedJobs) {
            const result = await PrinterService.retryPrintJobById(eventId, job._id.toString())
            results.push(result)
            if (!result.success) break
        }

        const retried = results.filter((result) => result.success).length
        const failed = results.length - retried

        return {
            success: true,
            attempted: results.length,
            retried,
            failed,
            failedPrinters: await listFailedPrinterGroups(eventId, data.orderId)
        }
    } catch (error) {
        console.error("Retry Failed Order Print Jobs Error:", error)
        return { success: false, error: "Errore durante il reinvio delle stampe fallite" }
    }
}
