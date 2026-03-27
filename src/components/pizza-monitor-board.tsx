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

    const primaryReady = payload?.readyNumbers[0] || null;
    const secondaryReady = payload?.readyNumbers.slice(1) || [];
    const secondaryGridClass = secondaryReady.length <= 1
        ? "grid-cols-1"
        : secondaryReady.length === 2
            ? "grid-cols-1 sm:grid-cols-2"
            : secondaryReady.length === 3
                ? "grid-cols-1 sm:grid-cols-3"
                : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";

    return (
        <div className="min-h-screen bg-[#1d1d1b] px-3 py-3 text-black md:px-5 md:py-5">
            <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1600px] flex-col rounded-[28px] border-[10px] border-[#111111] bg-[#d8e84f] shadow-[0_24px_80px_rgba(0,0,0,0.45)] md:min-h-[calc(100vh-2.5rem)] md:rounded-[36px] md:border-[14px]">
                <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-4 md:px-8 md:pb-4 md:pt-6">
                    <div className="min-w-0">
                        <p className="inline-flex items-center gap-2 rounded-sm border-2 border-black bg-white/80 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-black md:text-xs">
                            <Pizza className="h-3.5 w-3.5" />
                            Monitor pizza
                        </p>
                        <p className="mt-3 text-[11px] font-black uppercase tracking-[0.28em] text-black/65 md:text-sm">
                            {payload?.eventName || "Nessuna festa attiva"}
                        </p>
                    </div>
                    <div className="rounded-sm border-2 border-black bg-white/80 px-3 py-2 text-right">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-black/60 md:text-xs">
                            Refresh
                        </p>
                        <p className="mt-1 text-base font-black tabular-nums text-black md:text-2xl">
                            {updatedAt ? formatReadyTime(updatedAt) : "--:--"}
                        </p>
                    </div>
                </header>

                <main className="mt-8 flex flex-1 flex-col">
                    {isLoading ? (
                        <div className="flex flex-1 items-center justify-center">
                            <Loader2 className="h-12 w-12 animate-spin text-black" />
                        </div>
                    ) : error ? (
                        <div className="flex flex-1 items-center justify-center">
                            <div className="mx-4 rounded-[28px] border-4 border-black bg-[#fff8dd] px-8 py-10 text-center shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
                                <p className="text-sm font-black uppercase tracking-[0.18em] text-black/60">Errore</p>
                                <p className="mt-3 text-3xl font-black text-black">{error}</p>
                            </div>
                        </div>
                    ) : primaryReady ? (
                        <div className="flex flex-1 flex-col px-3 pb-3 md:px-5 md:pb-5">
                            <section
                                className="flex flex-1 flex-col rounded-[24px] border-4 border-black bg-[#d8e84f] px-4 py-4 md:rounded-[30px] md:px-8 md:py-6"
                                data-testid={`pizza-monitor-number-${primaryReady.pizzaNumber}`}
                            >
                                <div className="text-center">
                                    <h1 className="font-brand-display text-4xl font-black uppercase tracking-[-0.05em] text-black md:text-7xl xl:text-8xl">
                                        Pizzeria
                                    </h1>
                                    <p className="mt-2 text-[11px] font-black uppercase tracking-[0.26em] text-black/65 md:text-sm">
                                        Pizza pronta per il ritiro
                                    </p>
                                </div>

                                <div className="flex flex-1 items-center justify-center py-6 md:py-8">
                                    <div className="text-center">
                                        <p className="font-brand-display text-[9rem] font-black leading-none tracking-[-0.12em] text-black sm:text-[11rem] md:text-[16rem] xl:text-[21rem]">
                                            {primaryReady.pizzaNumber}
                                        </p>
                                        <p className="mt-2 text-sm font-black uppercase tracking-[0.22em] text-black/70 md:text-xl">
                                            Pronta dalle {formatReadyTime(primaryReady.readyAt)}
                                        </p>
                                    </div>
                                </div>

                                <div className={`grid gap-2 md:gap-3 ${secondaryGridClass}`}>
                                    {secondaryReady.length > 0 ? secondaryReady.map((entry) => (
                                        <article
                                            key={`${entry.pizzaNumber}-${entry.readyAt}`}
                                            className="flex min-h-[112px] flex-col items-center justify-center border-2 border-black bg-white px-3 py-2 text-center md:min-h-[150px] md:px-4 md:py-3"
                                            data-testid={`pizza-monitor-number-${entry.pizzaNumber}`}
                                        >
                                            <p className="text-sm font-black uppercase tracking-[0.16em] text-black/70 md:text-xl">
                                                Pizzeria
                                            </p>
                                            <p className="font-brand-display mt-1 text-5xl font-black leading-none tracking-[-0.08em] text-black md:mt-2 md:text-8xl">
                                                {entry.pizzaNumber}
                                            </p>
                                            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.18em] text-black/55 md:text-xs">
                                                {formatReadyTime(entry.readyAt)}
                                            </p>
                                        </article>
                                    )) : (
                                        <article className="flex min-h-[112px] items-center justify-center border-2 border-black bg-white px-4 py-3 text-center md:min-h-[150px]">
                                            <p className="text-sm font-black uppercase tracking-[0.18em] text-black/55 md:text-lg">
                                                Nessun altro numero in attesa
                                            </p>
                                        </article>
                                    )}
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="flex flex-1 items-center justify-center">
                            <div className="mx-4 rounded-[28px] border-4 border-black bg-[#fff8dd] px-10 py-12 text-center shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
                                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-black bg-white text-black">
                                    <RefreshCw className="h-8 w-8" />
                                </div>
                                <p className="mt-5 text-sm font-black uppercase tracking-[0.18em] text-black/55">
                                    In attesa
                                </p>
                                <p className="mt-3 font-brand-display text-4xl font-black tracking-tight text-black">
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
