export const LOW_STOCK_THRESHOLD = 5

export type StockStatus = "UNLIMITED" | "OK" | "LOW" | "OUT"

export type StockMode = "strict" | "override"

export interface StockShortage {
    productId: string
    productName: string
    requestedQuantity: number
    availableQuantity: number
}

export interface ProductStockInfo {
    id: string
    name: string
    stockQuantity?: number | null
    isSoldOut?: boolean
}

export interface CartStockItem {
    productId: string
    quantity: number
    snapshotName?: string
}

export function normalizeStockQuantity(raw?: number | null): number | null {
    if (raw === null || raw === undefined) return null
    if (!Number.isFinite(raw)) return null
    return Math.max(0, Math.floor(raw))
}

export function parseStockQuantityInput(raw?: string | null): number | null {
    if (raw === null || raw === undefined) return null
    const trimmed = raw.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed.replace(/,/g, "."))
    if (!Number.isFinite(parsed)) return null

    return normalizeStockQuantity(parsed)
}

export function isStockTracked(stockQuantity?: number | null): stockQuantity is number {
    return typeof stockQuantity === "number" && Number.isFinite(stockQuantity)
}

export function getStockStatus(stockQuantity?: number | null, isSoldOut = false): StockStatus {
    if (isSoldOut) return "OUT"
    if (!isStockTracked(stockQuantity)) return "UNLIMITED"
    if (stockQuantity <= 0) return "OUT"
    if (stockQuantity <= LOW_STOCK_THRESHOLD) return "LOW"
    return "OK"
}

export function getStockLabel(stockQuantity?: number | null, isSoldOut = false): string {
    const status = getStockStatus(stockQuantity, isSoldOut)
    if (status === "UNLIMITED") return "Illimitato"
    if (status === "OUT") return "Esaurito"
    if (status === "LOW") return `Scorte basse (${stockQuantity})`
    return `OK (${stockQuantity})`
}

export function aggregateCartQuantities(items: CartStockItem[]): Map<string, number> {
    const quantities = new Map<string, number>()

    for (const item of items) {
        const productId = item.productId?.trim()
        const qty = Number(item.quantity)
        if (!productId || !Number.isFinite(qty) || qty <= 0) continue
        quantities.set(productId, (quantities.get(productId) || 0) + qty)
    }

    return quantities
}

export function getAvailableQuantity(stockQuantity?: number | null, isSoldOut = false): number {
    if (isSoldOut) return 0
    if (!isStockTracked(stockQuantity)) return Number.POSITIVE_INFINITY
    return Math.max(0, stockQuantity)
}

export function collectStockShortages(
    demands: Map<string, number>,
    products: Map<string, ProductStockInfo>
): StockShortage[] {
    const shortages: StockShortage[] = []

    for (const [productId, requestedQuantity] of demands.entries()) {
        const product = products.get(productId)
        if (!product) {
            shortages.push({
                productId,
                productName: "Prodotto non trovato",
                requestedQuantity,
                availableQuantity: 0
            })
            continue
        }

        const availableQuantity = getAvailableQuantity(product.stockQuantity, product.isSoldOut || false)
        if (availableQuantity >= requestedQuantity) continue

        shortages.push({
            productId,
            productName: product.name,
            requestedQuantity,
            availableQuantity: Number.isFinite(availableQuantity) ? availableQuantity : requestedQuantity
        })
    }

    return shortages
}

export function applyStockDecrement(
    stockQuantity: number | null | undefined,
    requestedQuantity: number,
    mode: StockMode
): { nextStockQuantity: number | null, appliedQuantity: number } {
    if (!isStockTracked(stockQuantity)) {
        return { nextStockQuantity: null, appliedQuantity: requestedQuantity }
    }

    const safeRequested = Math.max(0, Math.floor(requestedQuantity))
    if (safeRequested === 0) {
        return { nextStockQuantity: stockQuantity, appliedQuantity: 0 }
    }

    if (mode === "strict" && stockQuantity < safeRequested) {
        return { nextStockQuantity: stockQuantity, appliedQuantity: 0 }
    }

    const nextStockQuantity = Math.max(0, stockQuantity - safeRequested)
    const appliedQuantity = Math.min(stockQuantity, safeRequested)
    return { nextStockQuantity, appliedQuantity }
}
