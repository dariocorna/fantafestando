"use client";

import Link from "next/link";
import { Workflow } from "lucide-react";
import { EasterEggComposer } from "@/components/easter-egg-composer";
import { type ThermalRasterPayload } from "@/lib/easter-egg-raster";

interface PortalEasterEggMobileProps {
    eventId: string;
    eventName: string;
    enabled: boolean;
}

export function PortalEasterEggMobile({
    eventId,
    eventName,
    enabled
}: PortalEasterEggMobileProps) {
    async function handleSubmitRaster(raster: ThermalRasterPayload) {
        const formData = new FormData();
        formData.set("eventId", eventId);
        formData.set("rasterWidth", String(raster.width));
        formData.set("rasterHeight", String(raster.height));
        const rasterBytes = new Uint8Array(raster.data.byteLength);
        rasterBytes.set(raster.data);
        formData.set(
            "rasterBits",
            new File(
                [rasterBytes],
                "easter-egg-raster.bin",
                { type: "application/octet-stream" }
            )
        );

        const response = await fetch("/api/admin/easter-egg/print-test", {
            method: "POST",
            body: formData
        });
        const payload = await response.json().catch(() => ({} as { error?: string; success?: string }));
        if (!response.ok) {
            return { error: payload.error || "Invio stampa non riuscito. Controlla il Monitor Stampa." };
        }
        return {
            success: typeof payload.success === "string"
                ? payload.success
                : "Stampa easter egg inviata."
        };
    }

    return (
        <div className="space-y-6">
            <div className="rounded-[32px] border border-[#d9e6f8] bg-white p-5 shadow-[var(--brand-shadow-soft)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                        <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--brand-blue-700)]">
                            Tool di test admin
                        </p>
                        <h1 className="font-brand-display text-3xl font-black text-[var(--brand-ink)]">
                            Easter Egg Termico
                        </h1>
                        <p className="text-sm font-medium text-slate-500">
                            {eventName} · nessuna immagine viene precaricata o salvata sul server.
                        </p>
                    </div>
                    <div className={`rounded-2xl border px-4 py-3 text-sm font-bold ${enabled
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}>
                        Funzione cliente {enabled ? "abilitata" : "disabilitata"}
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                        href="/admin/settings"
                        className="inline-flex items-center gap-2 rounded-full border border-[#d9e6f8] bg-[#f7fbff] px-4 py-2 text-sm font-bold text-[var(--brand-blue-700)] transition-colors hover:bg-[#edf5ff]"
                    >
                        <Workflow className="h-4 w-4" />
                        Vai alle impostazioni festa
                    </Link>
                </div>
            </div>

            <EasterEggComposer
                title="Stampa prova immediata"
                description="Carica o scatta una foto, adatta il ritaglio con gesture touch e invia direttamente alla stampante della festa selezionata."
                submitLabel="Stampa prova"
                submittingLabel="Invio stampa..."
                inputLabel="Foto di test"
                helpText="La preview è già in bianco e nero. I controlli avanzati restano solo qui in area admin per debug resa."
                emptyStateTitle="Nessuna foto caricata"
                emptyStateDescription="Scatta o scegli una foto per generare localmente il raster termico."
                captureMode="user"
                showAdvancedControls
                testIdPrefix="portal-easter-egg"
                onSubmitRaster={handleSubmitRaster}
            />
        </div>
    );
}
