"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import PosDevice from "@/models/PosDevice"
import Product from "@/models/Product"
import Ingredient from "@/models/Ingredient"
import CashSession from "@/models/CashSession"
import PrintJob from "@/models/PrintJob"
import { revalidatePath } from "next/cache"
import { PrinterService } from "@/lib/printer"
import { createSumUpCheckout } from "@/lib/sumup"
import { decryptSecret } from "@/lib/secrets"
import { getOrderCodeFromOrder, parseOrderNumberInput } from "@/lib/order-code"
import { resolvePizzaTicketForCart } from "@/lib/pizza-ticket"
import { type StockMode } from "@/lib/inventory"
import { computeCashSessionSummary } from "@/lib/cash-session"
import { aggregateOrderProductConsumptions } from "@/lib/product-consumption"
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
import { ensureAuthenticatedSession } from "@/lib/authz"

interface PrintDispatchSummary {
    attempted: number
    succeeded: number
    failed: number
    allSuccessful: boolean
}

async function ensurePosActionSession() {
    const sessionCheck = await ensureAuthenticatedSession()
    if (!sessionCheck.ok) {
        return { success: false as const, error: sessionCheck.error }
    }
    return { success: true as const }
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

interface PosCartMenuSelection {
    groupId: string
    productId: string
}

interface PosCartItemInput {
    productId: string
    snapshotName: string
    quantity: number
    selectedOptions: PosCartSelectedOption[]
    menuSelections: PosCartMenuSelection[]
}

type PosPricingMode = "STANDARD" | "VOLUNTEER"

interface PosOrderPricingResult {
    baseAmount: number
    discountApplied: number
    finalAmount: number
    cartWithDiscounts: Array<{
        productId: string
        snapshotName: string
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
    }).select("_id name basePrice volunteerPrice kind availableOnlyInMenus salesChannels menuComponents menuChoiceGroups").lean() as Array<{
        _id: string | { toString(): string }
        name?: string
        basePrice?: number | null
        volunteerPrice?: number | null
        kind?: string
        availableOnlyInMenus?: boolean
        salesChannels?: string[]
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
            return {
                success: true as const,
                item: {
                    productId: item.productId,
                    snapshotName: item.snapshotName,
                    quantity: item.quantity,
                    productKind,
                    unitBasePrice,
                    selectedOptions: item.selectedOptions,
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
    if (pricingMode === "VOLUNTEER" && (data.orderDiscount || (data.lineDiscounts && data.lineDiscounts.length > 0))) {
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
            cartWithDiscounts: normalizedCart.map((item, index) => {
                const line = computedDiscounts.summary.lineResults[index]
                const optionsDelta = item.selectedOptions.reduce((sum, option) =>
                    sum + normalizeCurrencyAmount(option.priceVariation), 0
                )
                const grossLineTotal = normalizeCurrencyAmount((item.unitBasePrice + optionsDelta) * item.quantity)
                return {
                    productId: item.productId,
                    snapshotName: item.snapshotName,
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
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

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

        const paidOrdersForSession = await Order.find({
            cashSessionId: openSession._id,
            status: "PAID"
        }).lean() as Array<{
            cart?: Array<{
                productId?: { toString(): string } | string
                snapshotName?: string
                quantity?: number
                selectedOptions?: Array<{ priceVariation?: number }>
                discountApplied?: number
                lineTotal?: number
            }>
        }>

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
            }).select("_id name basePrice").lean() as Array<{ _id: string | { toString(): string }; name?: string; basePrice?: number }>
            : []

        const catalogByProductId = new Map(
            catalogProducts.map((product) => [
                product._id.toString(),
                { name: product.name, basePrice: product.basePrice }
            ])
        )

        const printItems = aggregateOrderProductConsumptions({
            orders: paidOrdersForSession,
            catalogByProductId
        }).map((metric) => ({
            name: metric.productName,
            qty: metric.quantityConsumed,
            lineTotal: metric.revenueAmount
        }))

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
                closingNotes: closingNotes || undefined,
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
        menuSelections?: Array<{ groupId: string, productId: string }>
    }>,
    orderDiscount?: DiscountInput,
    lineDiscounts?: LineDiscountInput[],
    pricingMode?: PosPricingMode,
    paymentMethod: "CASH" | "CARD" | "OTHER",
    sumupCheckoutId?: string,
    posDeviceId?: string,
    allowStockOverride?: boolean
}) {
    let stockAdjustmentsToRollback: StockAdjustment[] = []
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
        const pizzaTicket = await resolvePizzaTicketForCart(
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

        const stockMode: StockMode = data.allowStockOverride ? "override" : "strict"
        const requiresPendingState = computeRequiresPendingState(data.paymentMethod, capabilitiesResult.capabilities)

        if (requiresPendingState) {
            const stockCheckResult = await validateStockForPendingOrder(data.eventId, stockPayload, stockMode, ingredientPlan)
            if (!stockCheckResult.success) {
                return {
                    success: false,
                    error: stockCheckResult.error || "Scorte non sufficienti",
                    stockShortages: stockCheckResult.stockShortages
                }
            }
        } else {
            const stockApplyResult = await applyStockForPaidOrder(data.eventId, stockPayload, stockMode, ingredientPlan)
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
            status: requiresPendingState ? "PENDING" : "PAID",
            customer: data.customer,
            totalAmount: payableAmount,
            discountApplied: pricingResult.pricing.discountApplied,
            discountMeta: pricingResult.pricing.orderDiscountMeta,
            pricingMode: data.pricingMode === "VOLUNTEER" ? "VOLUNTEER" : "STANDARD",
            cart: pricingResult.pricing.cartWithDiscounts,
            ingredientPlan,
            pizzaTicket,
            paymentMethod: data.paymentMethod,
            sumupCheckoutId: requiresPendingState ? undefined : data.sumupCheckoutId,
            posDeviceId: data.posDeviceId,
            cashSessionId: sessionResult.session.id,
            stockOverrideApproved: Boolean(data.allowStockOverride)
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
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

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
    pricingMode?: PosPricingMode
    cart?: Array<{
        productId: string
        snapshotName: string
        quantity: number
        selectedOptions?: Array<{ name: string, priceVariation: number }>
        menuSelections?: Array<{ groupId: string, productId: string }>
    }>
}) {
    let stockAdjustmentsToRollback: StockAdjustment[] = []
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
                    cartWithDiscounts: order.cart.map((item: {
                        productId: { toString(): string } | string
                        snapshotName: string
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
                    }) => ({
                        productId: item.productId.toString(),
                        snapshotName: item.snapshotName,
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
                    }))
                }
            }
        } else {
            pricingResult = await computePricingForCart({
                eventId: data.eventId,
                cart: orderCartInput,
                declaredTotalAmount: data.totalAmount,
                orderDiscount: data.orderDiscount,
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
        const pizzaTicket = await resolvePizzaTicketForCart(
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
            })),
            order.pizzaTicket
        )

        const stockMode: StockMode = data.allowStockOverride ? "override" : "strict"
        const stockApplyResult = await applyStockForPaidOrder(data.eventId, currentCart, stockMode, ingredientPlan)
        if (!stockApplyResult.success) {
            return {
                success: false,
                error: stockApplyResult.error || "Scorte non sufficienti",
                stockShortages: stockApplyResult.stockShortages
            }
        }
        stockAdjustmentsToRollback = stockApplyResult.appliedAdjustments || []

        order.set("cart", pricingResult.pricing.cartWithDiscounts)
        order.set("ingredientPlan", ingredientPlan)
        order.set("pizzaTicket", pizzaTicket || undefined)
        order.totalAmount = payableAmount
        order.discountApplied = pricingResult.pricing.discountApplied
        order.set("discountMeta", pricingResult.pricing.orderDiscountMeta || undefined)
        order.set("pricingMode", pendingPricingMode === "VOLUNTEER" ? "VOLUNTEER" : "STANDARD")
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

export async function retryFailedOrderPrintJobs(data: {
    eventId: string
    orderId: string
}): Promise<
    { success: true, retried: number, failed: number, attempted: number }
    | { success: false, error: string }
> {
    try {
        const sessionCheck = await ensurePosActionSession()
        if (!sessionCheck.success) return sessionCheck

        if (!data.eventId || !data.orderId) {
            return { success: false, error: "Dati mancanti per il reinvio stampa" }
        }

        await dbConnect()
        const failedJobs = await PrintJob.find({
            eventId: data.eventId,
            orderId: data.orderId,
            status: "FAILED"
        })
            .sort({ createdAt: 1 })
            .select("_id")
            .lean() as Array<{ _id: { toString(): string } | string }>

        if (failedJobs.length === 0) {
            return { success: true, retried: 0, failed: 0, attempted: 0 }
        }

        const results = await Promise.all(
            failedJobs.map((job) => PrinterService.retryPrintJobById(data.eventId, job._id.toString()))
        )

        const retried = results.filter((result) => result.success).length
        const failed = results.length - retried

        return {
            success: true,
            attempted: results.length,
            retried,
            failed
        }
    } catch (error) {
        console.error("Retry Failed Order Print Jobs Error:", error)
        return { success: false, error: "Errore durante il reinvio delle stampe fallite" }
    }
}
