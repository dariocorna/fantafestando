"use client"

export const MENU_CART_STORAGE_KEY = "osg_cart"
export const MENU_CART_EVENT_STORAGE_KEY = "osg_eventId"
export const EMPTY_STORED_MENU_CART_ITEMS: StoredMenuCartItem[] = []

const MENU_CART_STORAGE_EVENT = "fantafestando:menu-cart-change"

export interface StoredMenuCartItem {
    _id: string
    name: string
    basePrice: number
    quantity: number
    categoryId?: string
    description?: string
    variants?: { optionName: string; priceVariation: number }[]
}

interface StoredMenuCartPayload {
    eventId: string | null
    items: StoredMenuCartItem[]
}

let lastStorageValue: string | null = null
let lastLegacyEventId: string | null = null
let lastActiveEventId: string | null = null
let lastCartSnapshot: StoredMenuCartItem[] = EMPTY_STORED_MENU_CART_ITEMS

function normalizeEventId(eventId: string | null | undefined) {
    const trimmed = eventId?.trim()
    return trimmed ? trimmed : null
}

function isStoredMenuCartItem(value: unknown): value is StoredMenuCartItem {
    if (!value || typeof value !== "object") return false

    const item = value as Record<string, unknown>
    return (
        typeof item._id === "string"
        && item._id.length > 0
        && typeof item.name === "string"
        && item.name.length > 0
        && typeof item.basePrice === "number"
        && Number.isFinite(item.basePrice)
        && typeof item.quantity === "number"
        && Number.isInteger(item.quantity)
        && item.quantity > 0
    )
}

function filterStoredMenuCartItems(items: unknown[]): StoredMenuCartItem[] {
    return items.filter(isStoredMenuCartItem)
}

export function parseStoredMenuCart(
    rawValue: string | null,
    legacyEventId: string | null,
): StoredMenuCartPayload {
    const normalizedLegacyEventId = normalizeEventId(legacyEventId)
    if (!rawValue) {
        return { eventId: normalizedLegacyEventId, items: [] }
    }

    try {
        const parsed = JSON.parse(rawValue)

        if (Array.isArray(parsed)) {
            return {
                eventId: normalizedLegacyEventId,
                items: filterStoredMenuCartItems(parsed),
            }
        }

        if (parsed && typeof parsed === "object" && "items" in parsed) {
            const payload = parsed as { eventId?: unknown; items?: unknown }
            const items = Array.isArray(payload.items) ? filterStoredMenuCartItems(payload.items) : []
            const eventId = typeof payload.eventId === "string"
                ? normalizeEventId(payload.eventId)
                : normalizedLegacyEventId

            return { eventId, items }
        }
    } catch (error) {
        console.error("Failed to parse cart from localStorage", error)
    }

    return { eventId: normalizedLegacyEventId, items: [] }
}

export function getStoredMenuCartItemsForEvent(
    payload: StoredMenuCartPayload,
    activeEventId: string | null,
): StoredMenuCartItem[] {
    const normalizedActiveEventId = normalizeEventId(activeEventId)
    if (!normalizedActiveEventId) return EMPTY_STORED_MENU_CART_ITEMS
    if (!payload.eventId || payload.eventId !== normalizedActiveEventId) return EMPTY_STORED_MENU_CART_ITEMS
    return payload.items
}

export function readStoredMenuCart(activeEventId: string | null): StoredMenuCartItem[] {
    if (typeof window === "undefined") return EMPTY_STORED_MENU_CART_ITEMS

    const storageValue = window.localStorage.getItem(MENU_CART_STORAGE_KEY)
    const legacyEventId = window.localStorage.getItem(MENU_CART_EVENT_STORAGE_KEY)
    const normalizedActiveEventId = normalizeEventId(activeEventId)

    if (
        storageValue === lastStorageValue
        && legacyEventId === lastLegacyEventId
        && normalizedActiveEventId === lastActiveEventId
    ) {
        return lastCartSnapshot
    }

    const payload = parseStoredMenuCart(
        storageValue,
        legacyEventId,
    )
    const nextSnapshot = getStoredMenuCartItemsForEvent(payload, normalizedActiveEventId)

    lastStorageValue = storageValue
    lastLegacyEventId = legacyEventId
    lastActiveEventId = normalizedActiveEventId
    lastCartSnapshot = nextSnapshot.length > 0 ? nextSnapshot : EMPTY_STORED_MENU_CART_ITEMS

    return lastCartSnapshot
}

function emitStoredMenuCartChange() {
    if (typeof window === "undefined") return
    window.dispatchEvent(new Event(MENU_CART_STORAGE_EVENT))
}

export function subscribeToStoredMenuCart(onStoreChange: () => void) {
    if (typeof window === "undefined") {
        return () => undefined
    }

    const handleStorageChange = (event: Event) => {
        if (
            event instanceof StorageEvent
            && event.key
            && event.key !== MENU_CART_STORAGE_KEY
            && event.key !== MENU_CART_EVENT_STORAGE_KEY
        ) {
            return
        }

        onStoreChange()
    }

    window.addEventListener("storage", handleStorageChange)
    window.addEventListener(MENU_CART_STORAGE_EVENT, handleStorageChange)

    return () => {
        window.removeEventListener("storage", handleStorageChange)
        window.removeEventListener(MENU_CART_STORAGE_EVENT, handleStorageChange)
    }
}

export function writeStoredMenuCart(
    items: StoredMenuCartItem[],
    eventId: string | null,
) {
    if (typeof window === "undefined") return

    const normalizedEventId = normalizeEventId(eventId)
    if (items.length === 0 || !normalizedEventId) {
        clearStoredMenuCart()
        return
    }

    window.localStorage.setItem(
        MENU_CART_STORAGE_KEY,
        JSON.stringify({
            eventId: normalizedEventId,
            items,
        } satisfies StoredMenuCartPayload),
    )
    window.localStorage.setItem(MENU_CART_EVENT_STORAGE_KEY, normalizedEventId)
    emitStoredMenuCartChange()
}

export function clearStoredMenuCart() {
    if (typeof window === "undefined") return

    window.localStorage.removeItem(MENU_CART_STORAGE_KEY)
    window.localStorage.removeItem(MENU_CART_EVENT_STORAGE_KEY)
    emitStoredMenuCartChange()
}
