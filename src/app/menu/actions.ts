"use server"

import dbConnect from "@/lib/mongoose"
import Order from "@/models/Order"
import Product from "@/models/Product"
import Ingredient from "@/models/Ingredient"
import Event from "@/models/Event"
import { revalidatePath } from "next/cache"
import { getNextPublicOrderNumber, getOrderCodeFromOrder } from "@/lib/order-code"
import { getCurrentDayCode, isProductAvailableToday } from "@/lib/product-availability"
import { createEasterEggUploadToken } from "@/lib/easter-egg-order"
import { buildPublicOrderSummary } from "@/lib/public-order-summary"
import {
    aggregateCartQuantities,
    collectStockShortages,
    normalizeStockQuantity,
    type ProductStockInfo,
    type StockShortage
} from "@/lib/inventory"
import {
    collectReferencedProductIds,
    getProductUnitBasePrice,
    isProductVisibleInChannel,
    normalizeProductKind,
    resolveFixedMenuSelection,
    type MenuSelectionInput,
} from "@/lib/fixed-menu"
import {
    buildIngredientPlanForCart,
    normalizeRecipeItems,
} from "@/lib/ingredient-plan"

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

export async function createPublicOrder(data: {
    eventId: string,
    customer: { name?: string, table?: string },
    totalAmount: number,
    cart: Array<{
        productId: string,
        snapshotName: string,
        quantity: number,
        selectedOptions: Array<{ name: string, priceVariation: number }>,
        menuSelections?: Array<{ groupId: string, productId: string }>
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
        }).select("_id name shortName basePrice kind availableOnlyInMenus salesChannels menuComponents menuChoiceGroups availableDays stockQuantity isSoldOut").lean() as Array<{
            _id: unknown
            name: string
            shortName?: string
            basePrice?: number | null
            kind?: string
            availableOnlyInMenus?: boolean
            salesChannels?: string[]
            menuComponents?: Array<{ productId?: unknown, quantity?: number | null }>
            menuChoiceGroups?: Array<{
                id?: string
                name?: string
                minSelections?: number | null
                maxSelections?: number | null
                options?: Array<{ productId?: unknown, quantity?: number | null }>
            }>
            availableDays?: string[]
            stockQuantity?: number | null
            isSoldOut?: boolean
        }>

        if (products.length !== productIds.length) {
            return { success: false, error: "Alcuni prodotti non sono più disponibili. Aggiorna il carrello." }
        }

        const currentDayCode = getCurrentDayCode("Europe/Rome")
        const productById = new Map(products.map((product) => [String(product._id), product]))
        const referencedProductIds = [...new Set(
            products.flatMap((product) => collectReferencedProductIds(product))
        )]
        const referencedProducts = referencedProductIds.length > 0
            ? await Product.find({
                eventId: data.eventId,
                _id: { $in: referencedProductIds }
            }).select("_id name stockQuantity isSoldOut").lean() as Array<{
                _id: unknown
                name?: string
                stockQuantity?: number | null
                isSoldOut?: boolean
            }>
            : []
        referencedProducts.forEach((product) => {
            const productId = String(product._id)
            if (!productById.has(productId)) {
                productById.set(productId, {
                    _id: product._id,
                    name: product.name || "Prodotto"
                })
            }
        })
        const hasUnavailableProducts = data.cart.some((item) => {
            const product = productById.get(item.productId)
            if (!product) return true
            if (!isProductVisibleInChannel(product, "MENU")) return true
            return !isProductAvailableToday(product.availableDays || [], currentDayCode)
        })

        if (hasUnavailableProducts) {
            return {
                success: false,
                error: "Alcuni prodotti non sono più disponibili oggi. Torna al menu e aggiorna il carrello."
            }
        }

        const resolvedCart = data.cart.map((item) => {
            const product = productById.get(item.productId)
            if (!product) {
                return { success: false as const, error: "Alcuni prodotti non sono più disponibili. Aggiorna il carrello." }
            }

            const kind = normalizeProductKind(product.kind)
            if (!isProductVisibleInChannel(product, "MENU")) {
                return { success: false as const, error: "Alcuni prodotti non sono disponibili per l'ordinazione da app." }
            }

            if (kind === "STANDARD") {
                return {
                    success: true as const,
                    item: {
                        productId: item.productId,
                        snapshotName: product.name,
                        quantity: item.quantity,
                        productKind: kind,
                        unitBasePrice: getProductUnitBasePrice(product),
                        lineTotal: Number((getProductUnitBasePrice(product) * item.quantity).toFixed(2)),
                        selectedOptions: [],
                        includedComponents: []
                    }
                }
            }

            const menuSelections = Array.isArray(item.menuSelections)
                ? item.menuSelections
                    .filter((entry) => entry && typeof entry.groupId === "string" && typeof entry.productId === "string")
                    .map((entry) => ({ groupId: entry.groupId.trim(), productId: entry.productId.trim() } satisfies MenuSelectionInput))
                : []
            const menuResolution = resolveFixedMenuSelection({
                menu: product,
                productById: new Map(
                    [...productById.entries()].map(([key, value]) => [key, { _id: value._id, name: value.name }])
                ),
                selections: menuSelections
            })
            if (!menuResolution.success) {
                return { success: false as const, error: menuResolution.error }
            }

            const unitBasePrice = getProductUnitBasePrice(product)
            return {
                success: true as const,
                item: {
                    productId: item.productId,
                    snapshotName: product.name,
                    quantity: item.quantity,
                    productKind: kind,
                    unitBasePrice,
                    lineTotal: Number((unitBasePrice * item.quantity).toFixed(2)),
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

        const cartResolutionError = resolvedCart.find((entry) => !entry.success)
        if (cartResolutionError && !cartResolutionError.success) {
            return { success: false, error: cartResolutionError.error }
        }

        const normalizedCart = resolvedCart
            .filter((entry): entry is Extract<typeof entry, { success: true }> => entry.success)
            .map((entry) => entry.item)
        const computedTotalAmount = Number(
            normalizedCart.reduce((sum, item) => sum + (item.lineTotal || 0), 0).toFixed(2)
        )
        if (Math.abs(computedTotalAmount - Number(data.totalAmount || 0)) > 0.01) {
            return {
                success: false,
                error: "Il totale del carrello non è più coerente. Aggiorna il carrello e riprova."
            }
        }

        const demands = aggregateCartQuantities(
            normalizedCart.flatMap((item) => {
                if (Array.isArray(item.includedComponents) && item.includedComponents.length > 0) {
                    return item.includedComponents.map((component) => ({
                        productId: component.productId,
                        quantity: component.quantity * item.quantity,
                        snapshotName: component.snapshotName
                    }))
                }

                return [{
                    productId: item.productId,
                    quantity: item.quantity,
                    snapshotName: item.snapshotName
                }]
            })
        )
        const productStockMap = new Map<string, ProductStockInfo>(
            [...productById.values()].map((product) => [
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
        const ingredientPlan = await buildPersistedIngredientPlan(
            data.eventId,
            normalizedCart.map((item) => ({
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

        // Create the order with PENDING status
        const order = await Order.create({
            eventId: data.eventId,
            pickupNumber,
            status: "PENDING",
            customer: data.customer,
            totalAmount: computedTotalAmount,
            cart: normalizedCart,
            ingredientPlan,
            easterEggAttachment: easterEggUpload
                ? {
                    uploadTokenHash: easterEggUpload.hash
                }
                : undefined
        })

        const shortCode = getOrderCodeFromOrder({ pickupNumber: order.pickupNumber, _id: order._id })

        revalidatePath("/admin/orders")
        return {
            success: true,
            orderId: order._id.toString(),
            shortCode: shortCode,
            orderSummary: buildPublicOrderSummary({
                _id: order._id,
                pickupNumber: order.pickupNumber,
                totalAmount: order.totalAmount,
                customer: order.customer,
                cart: order.cart
            }),
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
