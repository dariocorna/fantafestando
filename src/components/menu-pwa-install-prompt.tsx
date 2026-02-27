"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function MenuPwaInstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        const onBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setDeferredPrompt(event as BeforeInstallPromptEvent);
        };

        const onAppInstalled = () => {
            setDeferredPrompt(null);
        };

        window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
        window.addEventListener("appinstalled", onAppInstalled);

        return () => {
            window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
            window.removeEventListener("appinstalled", onAppInstalled);
        };
    }, []);

    const installApp = async () => {
        if (!deferredPrompt) return;

        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null);
    };

    if (!deferredPrompt) {
        return null;
    }

    return (
        <div className="fixed right-4 top-4 z-[70]">
            <Button
                type="button"
                onClick={installApp}
                className="h-10 gap-2 rounded-full bg-gradient-to-r from-[#1e5fb8] to-[#249fe8] px-4 text-white shadow-md shadow-blue-200 hover:from-[#1a54a4] hover:to-[#218fce]"
            >
                <Download className="h-4 w-4" />
                Installa Menu
            </Button>
        </div>
    );
}
