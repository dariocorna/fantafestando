"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { EasterEggComposer } from "@/components/easter-egg-composer";
import {
    readPendingEasterEggUpload,
    subscribeToPendingEasterEggUpload
} from "@/app/menu/easter-egg-upload-storage";
import { type ThermalRasterPayload } from "@/lib/easter-egg-raster";

export function MenuOrderEasterEgg({ orderId }: { orderId: string | null }) {
    const token = useSyncExternalStore(
        subscribeToPendingEasterEggUpload,
        () => (orderId ? readPendingEasterEggUpload(orderId)?.token || null : null),
        () => null
    );
    const isEnabled = useMemo(() => Boolean(orderId && token), [orderId, token]);
    if (!isEnabled || !orderId || !token) {
        return null;
    }

    async function handleSubmitRaster(raster: ThermalRasterPayload) {
        const uploadToken = token;
        if (!uploadToken) {
            return { error: "Token upload non disponibile." };
        }
        const formData = new FormData();
        formData.set("token", uploadToken);
        formData.set("rasterWidth", String(raster.width));
        formData.set("rasterHeight", String(raster.height));
        const rasterBytes = new Uint8Array(raster.data.byteLength);
        rasterBytes.set(raster.data);
        formData.set(
            "rasterBits",
            new File(
                [rasterBytes],
                "order-easter-egg.bin",
                { type: "application/octet-stream" }
            )
        );

        const response = await fetch(`/api/public/orders/${orderId}/easter-egg`, {
            method: "POST",
            body: formData
        });
        const payload = await response.json().catch(() => ({} as { error?: string; success?: string }));
        if (!response.ok) {
            return { error: payload.error || "Impossibile allegare la foto all'ordine." };
        }

        return {
            success: typeof payload.success === "string" && payload.success.trim().length > 0
                ? payload.success
                : "Foto allegata all'ordine. Se vuoi cambiarla, dovrai prima confermare lo sblocco."
        };
    }

    return (
        <div className="space-y-4">
            <EasterEggComposer
                key={orderId}
                title="Foto per la tua comanda"
                submitLabel="Allega foto all'ordine"
                submittingLabel="Invio allegato..."
                inputLabel="Selfie o foto"
                helpText="Usa due dita per zoomare e trascina la preview per centrare il soggetto. Dopo il salvataggio la foto si blocca, e per modificarla di nuovo serve una conferma."
                emptyStateTitle="Scatta la tua foto"
                emptyStateDescription="Si aprirà la fotocamera del telefono; vedrai subito la preview in bianco e nero."
                captureMode="user"
                lockAfterFirstSave
                requireUnlockConfirmation
                autoSaveDelayMs={3000}
                testIdPrefix="menu-easter-egg"
                onSubmitRaster={handleSubmitRaster}
            />

            <div className="rounded-[30px] border border-[#d9e6f8] bg-white/95 p-5 shadow-[var(--brand-shadow-soft)]">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#8b6800]">
                    Funzione opzionale
                </p>
                <h2 className="font-brand-display mt-2 text-3xl font-black tracking-tight text-[var(--brand-ink)]">
                    Aggiungi una foto alla comanda
                </h2>
                <p className="mt-3 flex items-center gap-2 text-sm font-medium leading-relaxed text-slate-600">
                    <Sparkles className="h-4 w-4" />
                    Scatta una foto, verifica l&apos;anteprima e allegala all&apos;ordine. Verra&apos; stampata in cassa con la comanda al momento della chiusura.
                </p>
            </div>
        </div>
    );
}
