"use client";

import { useEffect } from "react";

interface PwaServiceWorkerProps {
    scriptUrl: string;
    scope: string;
    releaseKey: string;
}

export function PwaServiceWorker({ scriptUrl, scope, releaseKey }: PwaServiceWorkerProps) {
    useEffect(() => {
        if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
            return;
        }

        const register = async () => {
            try {
                const url = new URL(scriptUrl, window.location.origin);
                url.searchParams.set("v", releaseKey);

                const registration = await navigator.serviceWorker.register(url.toString(), {
                    scope,
                    updateViaCache: "none",
                });

                await registration.update();
            } catch (error) {
                console.error("[PWA] Service worker registration failed", error);
            }
        };

        void register();
    }, [releaseKey, scope, scriptUrl]);

    return null;
}
