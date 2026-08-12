import { getStockStatus, type StockStatus } from "@/lib/inventory"
import { ensurePosAccess } from "@/lib/pos-access"
import { getActiveEventId } from "@/lib/events"
import Product from "@/models/Product"

export interface PosStockProductDto {
    _id: string
    stockQuantity: number | null
    isSoldOut: boolean
    stockStatus: StockStatus
    variants: Array<{
        optionName: string
        priceVariation: number
        stockQuantity: number | null
    }>
}

export async function authorizePosStockRequest(
    eventId: string | null,
    requestHeaders: Pick<Headers, "get">
) {
    const access = await ensurePosAccess(requestHeaders)
    if (!access.ok) {
        return { ok: false as const, status: access.status, error: access.error }
    }

    const requestedEventId = eventId?.trim()
    if (!requestedEventId) {
        return { ok: false as const, status: 400, error: "Evento non valido" }
    }

    if (await getActiveEventId() !== requestedEventId) {
        return { ok: false as const, status: 404, error: "Evento attivo non valido" }
    }

    return { ok: true as const, eventId: requestedEventId }
}

export async function getPosStockSnapshot(eventId: string) {
    const products = await Product.find({ eventId })
        .select("_id stockQuantity isSoldOut variants.optionName variants.priceVariation variants.stockQuantity")
        .lean() as Array<{
            _id: { toString(): string } | string
            stockQuantity?: number | null
            isSoldOut?: boolean
            variants?: Array<{
                optionName?: string
                priceVariation?: number
                stockQuantity?: number | null
            }>
        }>

    return {
        eventId,
        products: products.map((product): PosStockProductDto => {
            const stockQuantity = product.stockQuantity ?? null
            const isSoldOut = Boolean(product.isSoldOut)
            return {
                _id: product._id.toString(),
                stockQuantity,
                isSoldOut,
                stockStatus: getStockStatus(stockQuantity, isSoldOut),
                variants: (product.variants || []).map((variant) => ({
                    optionName: variant.optionName || "",
                    priceVariation: Number(variant.priceVariation || 0),
                    stockQuantity: variant.stockQuantity ?? null
                }))
            }
        })
    }
}
