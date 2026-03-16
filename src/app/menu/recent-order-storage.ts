"use client";

import { type PublicOrderSummary } from "@/lib/public-order-summary";

const STORAGE_PREFIX = "fantafestando:recent-order:";

function getStorageKey(orderId: string) {
    return `${STORAGE_PREFIX}${orderId}`;
}

export function storeRecentOrderSummary(summary: PublicOrderSummary) {
    if (typeof window === "undefined" || !summary.orderId) return;
    window.sessionStorage.setItem(getStorageKey(summary.orderId), JSON.stringify(summary));
}

export function readRecentOrderSummary(orderId: string): PublicOrderSummary | null {
    if (typeof window === "undefined" || !orderId) return null;
    const rawValue = window.sessionStorage.getItem(getStorageKey(orderId));
    if (!rawValue) return null;

    try {
        return JSON.parse(rawValue) as PublicOrderSummary;
    } catch (error) {
        console.error("Failed to parse recent order summary from sessionStorage", error);
        return null;
    }
}
