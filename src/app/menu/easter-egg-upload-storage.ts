"use client";

const STORAGE_PREFIX = "fantafestando:easter-egg-upload:";

export interface PendingEasterEggUpload {
    orderId: string;
    token: string;
}

function getStorageKey(orderId: string) {
    return `${STORAGE_PREFIX}${orderId}`;
}

export function storePendingEasterEggUpload(payload: PendingEasterEggUpload) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(getStorageKey(payload.orderId), payload.token);
    window.dispatchEvent(new Event("fantafestando:easter-egg-upload"));
}

export function readPendingEasterEggUpload(orderId: string): PendingEasterEggUpload | null {
    if (typeof window === "undefined" || !orderId) return null;
    const token = window.sessionStorage.getItem(getStorageKey(orderId));
    if (!token) return null;
    return { orderId, token };
}

export function clearPendingEasterEggUpload(orderId: string) {
    if (typeof window === "undefined" || !orderId) return;
    window.sessionStorage.removeItem(getStorageKey(orderId));
    window.dispatchEvent(new Event("fantafestando:easter-egg-upload"));
}

export function subscribeToPendingEasterEggUpload(callback: () => void) {
    if (typeof window === "undefined") {
        return () => undefined;
    }

    const handler = () => callback();
    window.addEventListener("storage", handler);
    window.addEventListener("fantafestando:easter-egg-upload", handler);

    return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener("fantafestando:easter-egg-upload", handler);
    };
}
