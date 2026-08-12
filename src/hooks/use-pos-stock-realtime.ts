"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"

export const POS_STOCK_POLL_INTERVAL_MS = 5_000
export const POS_STOCK_RECONCILE_INTERVAL_MS = 30_000

export type PosStockConnectionStatus = "connecting" | "live" | "polling"

type StockVariant = {
    optionName: string
    priceVariation: number
    stockQuantity?: number | null
}

export type PosStockSnapshotProduct = {
    _id: string
    stockQuantity: number | null
    isSoldOut: boolean
    stockStatus: "UNLIMITED" | "OK" | "LOW" | "OUT"
    variants: Array<StockVariant & { stockQuantity: number | null }>
}

type StockAwareProduct = {
    _id: string
    stockQuantity?: number | null
    isSoldOut?: boolean
    stockStatus?: PosStockSnapshotProduct["stockStatus"]
    variants?: StockVariant[]
}

export function mergePosStockSnapshot<T extends StockAwareProduct>(
    products: T[],
    snapshot: PosStockSnapshotProduct[]
): T[] {
    const stockByProductId = new Map(snapshot.map((product) => [product._id, product]))

    return products.map((product) => {
        const stock = stockByProductId.get(product._id)
        if (!stock) return product

        const variantStock = new Map(stock.variants.map((variant) => [variant.optionName, variant.stockQuantity]))
        return {
            ...product,
            stockQuantity: stock.stockQuantity,
            isSoldOut: stock.isSoldOut,
            stockStatus: stock.stockStatus,
            variants: product.variants?.map((variant) => variantStock.has(variant.optionName)
                ? { ...variant, stockQuantity: variantStock.get(variant.optionName) ?? null }
                : variant),
        } as T
    })
}

export function usePosStockRealtime<T extends StockAwareProduct>(
    eventId: string | undefined,
    setProducts: Dispatch<SetStateAction<T[]>>
): PosStockConnectionStatus {
    const [status, setStatus] = useState<PosStockConnectionStatus>("connecting")

    useEffect(() => {
        if (!eventId) {
            setStatus("connecting")
            return
        }

        let disposed = false
        let syncing = false
        let syncPending = false
        let streamConnected = false
        let pollingTimer: ReturnType<typeof setInterval> | undefined
        let reconcileTimer: ReturnType<typeof setInterval> | undefined

        const stopPolling = () => {
            if (pollingTimer !== undefined) clearInterval(pollingTimer)
            pollingTimer = undefined
        }

        const stopReconciliation = () => {
            if (reconcileTimer !== undefined) clearInterval(reconcileTimer)
            reconcileTimer = undefined
        }

        const syncSnapshot = async () => {
            if (disposed) return
            if (syncing) {
                syncPending = true
                return
            }
            syncing = true
            try {
                const response = await fetch(`/api/pos/stock?eventId=${encodeURIComponent(eventId)}`, {
                    cache: "no-store",
                })
                if (!response.ok) throw new Error(`Stock snapshot failed: ${response.status}`)
                const payload = await response.json() as { eventId?: string; products?: PosStockSnapshotProduct[] }
                if (disposed || payload.eventId !== eventId || !Array.isArray(payload.products)) return
                setProducts((current) => mergePosStockSnapshot(current, payload.products || []))
                if (streamConnected) {
                    stopPolling()
                    startReconciliation()
                    setStatus("live")
                }
            } catch {
                if (!disposed) startPolling()
            } finally {
                syncing = false
                if (syncPending && !disposed) {
                    syncPending = false
                    void syncSnapshot()
                }
            }
        }

        const startPolling = () => {
            if (disposed || pollingTimer !== undefined) return
            stopReconciliation()
            setStatus("polling")
            pollingTimer = setInterval(() => void syncSnapshot(), POS_STOCK_POLL_INTERVAL_MS)
        }

        const startReconciliation = () => {
            if (disposed || reconcileTimer !== undefined) return
            reconcileTimer = setInterval(() => void syncSnapshot(), POS_STOCK_RECONCILE_INTERVAL_MS)
        }

        setStatus("connecting")
        if (typeof EventSource === "undefined") {
            startPolling()
            void syncSnapshot()
            return () => {
                disposed = true
                stopPolling()
                stopReconciliation()
            }
        }

        const source = new EventSource(`/api/pos/stock-stream?eventId=${encodeURIComponent(eventId)}`)
        const onStock = () => void syncSnapshot()
        source.addEventListener("stock", onStock)
        source.onopen = () => {
            if (disposed) return
            streamConnected = true
            stopPolling()
            startReconciliation()
            setStatus("live")
            void syncSnapshot()
        }
        source.onerror = () => {
            if (disposed) return
            streamConnected = false
            stopReconciliation()
            startPolling()
            void syncSnapshot()
        }

        return () => {
            disposed = true
            stopPolling()
            stopReconciliation()
            source.removeEventListener("stock", onStock)
            source.close()
        }
    }, [eventId, setProducts])

    return status
}
