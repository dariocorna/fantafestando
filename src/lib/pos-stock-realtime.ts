type StockInvalidationListener = (eventId: string) => void

const realtimeGlobal = globalThis as typeof globalThis & {
    __fantafestandoPosStockListeners?: Map<string, Set<StockInvalidationListener>>
}

const listenersByEvent = realtimeGlobal.__fantafestandoPosStockListeners
    ??= new Map<string, Set<StockInvalidationListener>>()

export function publishStockInvalidation(eventId: string) {
    const listeners = listenersByEvent.get(eventId)
    if (!listeners) return

    for (const listener of listeners) {
        try {
            listener(eventId)
        } catch {
            listeners.delete(listener)
        }
    }
    if (listeners.size === 0) listenersByEvent.delete(eventId)
}

export function subscribeStockInvalidation(eventId: string, listener: StockInvalidationListener) {
    const listeners = listenersByEvent.get(eventId) ?? new Set<StockInvalidationListener>()
    listeners.add(listener)
    listenersByEvent.set(eventId, listeners)

    return () => {
        listeners.delete(listener)
        if (listeners.size === 0) listenersByEvent.delete(eventId)
    }
}
