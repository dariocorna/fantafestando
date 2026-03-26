"use client";

import { useEffect, useState } from "react";
import { Loader2, Pizza, RefreshCw } from "lucide-react";

interface PizzaMonitorPayload {
    eventName: string | null;
    readyNumbers: Array<{
        pizzaNumber: number;
        readyAt: string;
    }>;
}

function formatReadyTime(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "--:--";
    return parsed.toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function PizzaMonitorBoard() {
    const [payload, setPayload] = useState<PizzaMonitorPayload | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);

    useEffect(() => {
        let isCancelled = false;

        const load = async () => {
            try {
                const response = await fetch("/api/public/pizza-monitor", { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(`Pizza monitor request failed with status ${response.status}`);
                }
                const nextPayload = await response.json() as PizzaMonitorPayload;
                if (isCancelled) return;
                setPayload(nextPayload);
                setError(null);
                setUpdatedAt(new Date().toISOString());
            } catch (loadError) {
                if (isCancelled) return;
                console.error("Failed to load pizza monitor", loadError);
                setError("Monitor non disponibile");
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        void load();
        const interval = window.setInterval(() => {
            void load();
        }, 3000);

        return () => {
            isCancelled = true;
            window.clearInterval(interval);
        };
    }, []);

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,#fff4da_0%,#ffe4ad_26%,#f6f8fb_62%,#edf2f7_100%)] px-6 py-8 text-slate-900">
            <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col">
                <header className="flex items-start justify-between gap-4">
                    <div>
                        <p className="inline-flex items-center gap-2 rounded-full bg-white/75 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#a24d00] shadow-sm">
                            <Pizza className="h-4 w-4" />
                            Monitor pizza
                        </p>
                        <h1 className="mt-4 font-brand-display text-5xl font-black tracking-[-0.06em] text-[#7a2d00] md:text-7xl">
                            {payload?.eventName || "Nessuna festa attiva"}
                        </h1>
                    </div>
                    <div className="rounded-[28px] border border-white/70 bg-white/70 px-4 py-3 text-right shadow-sm">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                            Ultimo refresh
                        </p>
                        <p className="mt-1 text-lg font-black text-slate-700">
                            {updatedAt ? formatReadyTime(updatedAt) : "--:--"}
                        </p>
                    </div>
                </header>

                <main className="mt-8 flex flex-1 flex-col">
                    {isLoading ? (
                        <div className="flex flex-1 items-center justify-center">
                            <Loader2 className="h-12 w-12 animate-spin text-[#a24d00]" />
                        </div>
                    ) : error ? (
                        <div className="flex flex-1 items-center justify-center">
                            <div className="rounded-[36px] border border-rose-200 bg-white/85 px-8 py-10 text-center shadow-sm">
                                <p className="text-sm font-black uppercase tracking-[0.16em] text-rose-600">Errore</p>
                                <p className="mt-3 text-3xl font-black text-rose-800">{error}</p>
                            </div>
                        </div>
                    ) : payload && payload.readyNumbers.length > 0 ? (
                        <div className="grid flex-1 auto-rows-fr gap-5 md:grid-cols-3 xl:grid-cols-4">
                            {payload.readyNumbers.map((entry) => (
                                <article
                                    key={`${entry.pizzaNumber}-${entry.readyAt}`}
                                    className="flex min-h-[220px] flex-col justify-between rounded-[38px] border border-[#ffc074] bg-[linear-gradient(160deg,#fffef9_0%,#fff0cf_45%,#ffd79f_100%)] p-6 shadow-[0_18px_44px_rgba(188,113,12,0.18)]"
                                    data-testid={`pizza-monitor-number-${entry.pizzaNumber}`}
                                >
                                    <div className="inline-flex w-fit rounded-full bg-white/80 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#9a4d00]">
                                        Pronta ora
                                    </div>
                                    <div className="mt-4">
                                        <p className="font-brand-display text-7xl font-black tracking-[-0.08em] text-[#832400] md:text-8xl">
                                            {entry.pizzaNumber}
                                        </p>
                                    </div>
                                    <div className="mt-6 flex items-center justify-between text-sm font-bold text-[#8b4b09]">
                                        <span>Pubblicata</span>
                                        <span>{formatReadyTime(entry.readyAt)}</span>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-1 items-center justify-center">
                            <div className="rounded-[40px] border border-white/70 bg-white/75 px-10 py-12 text-center shadow-sm">
                                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#fff1d6] text-[#a24d00]">
                                    <RefreshCw className="h-8 w-8" />
                                </div>
                                <p className="mt-5 text-sm font-black uppercase tracking-[0.16em] text-slate-500">
                                    In attesa
                                </p>
                                <p className="mt-3 font-brand-display text-4xl font-black tracking-tight text-slate-700">
                                    Nessuna pizza pronta
                                </p>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
