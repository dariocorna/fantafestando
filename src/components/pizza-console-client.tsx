"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, RotateCcw, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PizzaConsolePayload {
    eventName: string | null;
    queuedTickets: Array<{
        orderId: string;
        pizzaNumber: number;
        orderCode: string;
        customerName?: string;
        table?: string;
        createdAt: string;
    }>;
    readyTickets: Array<{
        orderId: string;
        pizzaNumber: number;
        readyAt: string;
    }>;
}

function formatTime(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "--:--";
    return parsed.toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function PizzaConsoleClient() {
    const [payload, setPayload] = useState<PizzaConsolePayload | null>(null);
    const [scannerValue, setScannerValue] = useState("");
    const [feedback, setFeedback] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPending, startTransition] = useTransition();
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        let isCancelled = false;

        const focusInput = () => {
            inputRef.current?.focus();
        };

        const load = async () => {
            try {
                const response = await fetch("/api/pizza-console/tickets", { cache: "no-store" });
                if (!response.ok) {
                    throw new Error(`Pizza console request failed with status ${response.status}`);
                }
                const nextPayload = await response.json() as PizzaConsolePayload;
                if (isCancelled) return;
                setPayload(nextPayload);
                setError(null);
            } catch (loadError) {
                if (isCancelled) return;
                console.error("Failed to load pizza console", loadError);
                setError("Console pizza non disponibile");
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                    focusInput();
                }
            }
        };

        void load();
        focusInput();
        const refreshInterval = window.setInterval(() => {
            void load();
        }, 3000);
        const focusInterval = window.setInterval(() => {
            if (document.visibilityState === "visible" && document.activeElement !== inputRef.current) {
                focusInput();
            }
        }, 2000);

        return () => {
            isCancelled = true;
            window.clearInterval(refreshInterval);
            window.clearInterval(focusInterval);
        };
    }, []);

    const refreshTickets = async () => {
        const response = await fetch("/api/pizza-console/tickets", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Pizza console refresh failed with status ${response.status}`);
        }
        const nextPayload = await response.json() as PizzaConsolePayload;
        setPayload(nextPayload);
    };

    const markReady = async (barcode: string) => {
        const response = await fetch("/api/pizza-console/scan", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ barcode })
        });
        const result = await response.json().catch(() => ({} as { status?: string }));
        if (!response.ok && result.status !== "already_ready") {
            throw new Error(result.status === "invalid" ? "Barcode non valido" : "Ticket pizza non trovato");
        }

        if (result.status === "already_ready") {
            setFeedback("Ticket già marcato come pronto.");
            return;
        }

        setFeedback("Pizza segnata come pronta.");
    };

    const requeue = async (orderId: string) => {
        const response = await fetch("/api/pizza-console/requeue", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ orderId })
        });
        const result = await response.json().catch(() => ({} as { status?: string }));
        if (!response.ok && result.status !== "already_queued") {
            throw new Error("Impossibile rimettere in coda il ticket.");
        }

        if (result.status === "already_queued") {
            setFeedback("Ticket già in coda.");
            return;
        }

        setFeedback("Ticket rimesso in coda.");
    };

    const submitScanner = (barcode: string) => {
        const normalized = barcode.trim();
        if (!normalized) return;

        startTransition(async () => {
            try {
                setError(null);
                await markReady(normalized);
                await refreshTickets();
                setScannerValue("");
            } catch (submitError) {
                console.error("Pizza scanner submit failed", submitError);
                setError(submitError instanceof Error ? submitError.message : "Errore scanner");
            } finally {
                inputRef.current?.focus();
            }
        });
    };

    const handleRequeue = (orderId: string) => {
        startTransition(async () => {
            try {
                setError(null);
                await requeue(orderId);
                await refreshTickets();
            } catch (requeueError) {
                console.error("Pizza requeue failed", requeueError);
                setError(requeueError instanceof Error ? requeueError.message : "Errore requeue");
            } finally {
                inputRef.current?.focus();
            }
        });
    };

    return (
        <div className="min-h-screen bg-[linear-gradient(180deg,#fff8ea_0%,#fff4dc_14%,#f7fafc_60%,#edf2f7_100%)] px-4 py-6 md:px-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="rounded-[34px] border border-[#ffd39a] bg-white/85 p-6 shadow-[0_18px_42px_rgba(198,124,18,0.12)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="inline-flex items-center gap-2 rounded-full bg-[#fff1d2] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#9a4d00]">
                                <ScanLine className="h-4 w-4" />
                                Console pizza
                            </p>
                            <h1 className="mt-4 font-brand-display text-4xl font-black tracking-[-0.05em] text-[#7a2d00] md:text-5xl">
                                {payload?.eventName || "Nessuna festa attiva"}
                            </h1>
                            <p className="mt-2 text-sm font-semibold text-slate-600">
                                Scansiona il barcode della comanda pizza o usa i comandi manuali sulla coda.
                            </p>
                        </div>

                        <form
                            className="rounded-[28px] border border-[#ffd39a] bg-[#fffaf0] p-4 shadow-sm lg:w-[360px]"
                            onSubmit={(event) => {
                                event.preventDefault();
                                submitScanner(scannerValue);
                            }}
                        >
                            <label htmlFor="pizza-scanner-input" className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                                Scanner barcode
                            </label>
                            <input
                                ref={inputRef}
                                id="pizza-scanner-input"
                                value={scannerValue}
                                onChange={(event) => setScannerValue(event.target.value)}
                                placeholder="PZ:..."
                                autoComplete="off"
                                spellCheck={false}
                                className="mt-3 h-14 w-full rounded-2xl border border-[#f2c27b] bg-white px-4 text-lg font-black tracking-wide text-slate-900 outline-none ring-0 placeholder:text-slate-300"
                                data-testid="pizza-console-scanner-input"
                            />
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold text-slate-500">
                                    Il campo resta pronto per gli scanner USB.
                                </p>
                                <Button
                                    type="submit"
                                    className="rounded-2xl bg-[#a24d00] text-white hover:bg-[#8b4200]"
                                    disabled={isPending}
                                >
                                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invia"}
                                </Button>
                            </div>
                        </form>
                    </div>

                    {feedback ? (
                        <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                            {feedback}
                        </p>
                    ) : null}
                    {error ? (
                        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                            {error}
                        </p>
                    ) : null}
                </header>

                <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                    <section className="rounded-[34px] border border-slate-200 bg-white/90 p-6 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">In preparazione</p>
                                <h2 className="mt-2 text-2xl font-black text-slate-900">Coda pizza</h2>
                            </div>
                            <div className="rounded-full bg-[#fff1d2] px-4 py-2 text-sm font-black text-[#9a4d00]">
                                {payload?.queuedTickets.length || 0}
                            </div>
                        </div>

                        {isLoading ? (
                            <div className="flex h-40 items-center justify-center">
                                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                            </div>
                        ) : payload && payload.queuedTickets.length > 0 ? (
                            <div className="mt-5 space-y-3">
                                {payload.queuedTickets.map((ticket) => (
                                    <article
                                        key={ticket.orderId}
                                        className="rounded-[28px] border border-[#ffd39a] bg-[linear-gradient(160deg,#fffef9_0%,#fff4db_55%,#ffe3ba_100%)] p-5"
                                        data-testid={`pizza-console-queued-${ticket.pizzaNumber}`}
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#9a4d00]">
                                                    Pizza in coda
                                                </p>
                                                <p className="font-brand-display mt-2 text-5xl font-black tracking-[-0.07em] text-[#832400]">
                                                    {ticket.pizzaNumber}
                                                </p>
                                                <p className="mt-2 text-sm font-bold text-slate-700">
                                                    Ordine {ticket.orderCode}
                                                    {ticket.customerName ? ` · ${ticket.customerName}` : ""}
                                                    {ticket.table ? ` · Tavolo ${ticket.table}` : ""}
                                                </p>
                                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                                    Creato alle {formatTime(ticket.createdAt)}
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                className="rounded-2xl bg-[#a24d00] text-white hover:bg-[#8b4200]"
                                                onClick={() => submitScanner(`PZ:${ticket.orderId}`)}
                                            >
                                                Segna pronta
                                            </Button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <div className="mt-5 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm font-semibold text-slate-500">
                                Nessuna pizza in coda.
                            </div>
                        )}
                    </section>

                    <section className="rounded-[34px] border border-slate-200 bg-white/90 p-6 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Ultime pronte</p>
                                <h2 className="mt-2 text-2xl font-black text-slate-900">Bacheca cucina</h2>
                            </div>
                            <div className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-700">
                                {payload?.readyTickets.length || 0}
                            </div>
                        </div>

                        {isLoading ? (
                            <div className="flex h-40 items-center justify-center">
                                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                            </div>
                        ) : payload && payload.readyTickets.length > 0 ? (
                            <div className="mt-5 space-y-3">
                                {payload.readyTickets.map((ticket) => (
                                    <article
                                        key={`${ticket.orderId}-${ticket.readyAt}`}
                                        className="rounded-[28px] border border-emerald-200 bg-[linear-gradient(160deg,#f7fff9_0%,#e8fff0_60%,#d6f6e1_100%)] p-5"
                                        data-testid={`pizza-console-ready-${ticket.pizzaNumber}`}
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    Pronta
                                                </p>
                                                <p className="font-brand-display mt-2 text-5xl font-black tracking-[-0.07em] text-emerald-800">
                                                    {ticket.pizzaNumber}
                                                </p>
                                                <p className="mt-2 text-xs font-semibold text-emerald-700">
                                                    Pubblicata alle {formatTime(ticket.readyAt)}
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="rounded-2xl border-emerald-300 bg-white/80 text-emerald-700 hover:bg-white"
                                                onClick={() => handleRequeue(ticket.orderId)}
                                            >
                                                <RotateCcw className="h-4 w-4" />
                                                Rimetti in coda
                                            </Button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <div className="mt-5 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm font-semibold text-slate-500">
                                Nessuna pizza segnata come pronta.
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
