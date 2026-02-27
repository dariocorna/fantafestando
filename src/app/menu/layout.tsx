import type { Metadata, Viewport } from "next";
import { getAppReleaseKey } from "@/lib/app-version";
import { MenuPwaInstallPrompt } from "@/components/menu-pwa-install-prompt";
import { PwaServiceWorker } from "@/components/pwa-service-worker";

export const metadata: Metadata = {
    title: "OSG Fest",
    description: "Menu pubblico OSG Fest",
    manifest: "/manifest-menu.webmanifest",
    appleWebApp: {
        capable: true,
        title: "OSG Fest",
        statusBarStyle: "black-translucent",
    },
    icons: {
        icon: "/icons/icon-192x192.png",
        apple: "/icons/icon-180x180.png",
    },
};

export const viewport: Viewport = {
    themeColor: "#1e5fb8",
};

export default function MenuLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const appReleaseKey = getAppReleaseKey();

    return (
        <>
            <PwaServiceWorker scriptUrl="/sw-menu.js" scope="/menu/" releaseKey={appReleaseKey} />
            {children}
            <MenuPwaInstallPrompt />
        </>
    );
}
