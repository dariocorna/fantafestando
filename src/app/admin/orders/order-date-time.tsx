"use client"

import { useSyncExternalStore } from "react"

const subscribeToHydration = () => () => undefined
const getClientHydrationSnapshot = () => true
const getServerHydrationSnapshot = () => false

export function formatOrderDateTime(value?: string | null): string {
    if (!value) return "-"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "-"

    return new Intl.DateTimeFormat("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date)
}

export function OrderDateTime({ value }: { value?: string | null }) {
    const hydrated = useSyncExternalStore(
        subscribeToHydration,
        getClientHydrationSnapshot,
        getServerHydrationSnapshot
    )

    return <time dateTime={value || undefined}>{hydrated ? formatOrderDateTime(value) : "-"}</time>
}
