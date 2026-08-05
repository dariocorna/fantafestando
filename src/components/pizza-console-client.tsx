"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPizzaBarcodeValue } from "@/lib/pizza-barcode";

interface PizzaConsolePayload {
    eventName: string | null;
    queuedTickets: Array<{
        orderId: string;
        pizzaNumber: number;
        productName: string;
        orderCode: string;
        customerName?: string;
        table?: string;
        createdAt: string;
    }>;
    readyTickets: Array<{
        orderId: string;
        pizzaNumber: number;
        productName: string;
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
                setError("Console preparazioni non disponibile");
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
            throw new Error(result.status === "invalid" ? "Barcode non valido" : "Ticket preparazione non trovato");
        }

        if (result.status === "already_ready") {
            setFeedback("Ticket già marcato come pronto.");
            return;
        }

        setFeedback("Piatto segnato come pronto.");
    };

    const requeue = async (orderId: string, pizzaNumber: number) => {
        const response = await fetch("/api/pizza-console/requeue", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ orderId, pizzaNumber })
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

    const removeTicket = async (orderId: string, pizzaNumber: number, source: "queued" | "ready") => {
        const response = await fetch("/api/pizza-console/remove", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ orderId, pizzaNumber })
        });
        const result = await response.json().catch(() => ({} as { status?: string }));
        if (!response.ok && result.status !== "already_removed") {
            throw new Error("Impossibile rimuovere il ticket.");
        }

        if (result.status === "already_removed") {
            setFeedback("Ticket già rimosso dalla console.");
            return;
        }

        setFeedback(
            source === "queued"
                ? "Piatto rimosso dalla coda di preparazione."
                : "Piatto rimosso dalla lista dei pronti."
        );
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

    const handleRequeue = (orderId: string, pizzaNumber: number) => {
        startTransition(async () => {
            try {
                setError(null);
                await requeue(orderId, pizzaNumber);
                await refreshTickets();
            } catch (requeueError) {
                console.error("Pizza requeue failed", requeueError);
                setError(requeueError instanceof Error ? requeueError.message : "Errore requeue");
            } finally {
                inputRef.current?.focus();
            }
        });
    };

    const handleRemove = (orderId: string, pizzaNumber: number, source: "queued" | "ready") => {
        startTransition(async () => {
            try {
                setError(null);
                await removeTicket(orderId, pizzaNumber, source);
                await refreshTickets();
            } catch (removeError) {
                console.error("Pizza remove failed", removeError);
                setError(removeError instanceof Error ? removeError.message : "Errore rimozione");
            } finally {
                inputRef.current?.focus();
            }
        });
    };

    return (
        <div className="min-h-screen bg-[linear-gradient(180deg,#f4f8ff_0%,#eef6ff_32%,#f8fbff_100%)] px-4 py-6 md:px-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="rounded-[34px] border border-[#d9e6f8] bg-white/95 p-6 shadow-[var(--brand-shadow-soft)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-700">
                                <ScanLine className="h-4 w-4" />
                                Console preparazioni
                            </p>
                            <h1 className="mt-4 font-brand-display text-4xl font-black tracking-[-0.05em] text-slate-900 md:text-5xl">
                                {payload?.eventName || "Nessuna festa attiva"}
                            </h1>
                            <p className="mt-2 text-sm font-semibold text-slate-600">
                                Scansiona il barcode della comanda o usa i comandi manuali sulla coda.
                            </p>
                        </div>

                        <form
                            className="rounded-[28px] border border-[#d9e6f8] bg-[linear-gradient(135deg,#ffffff_0%,#f7fbff_100%)] p-4 shadow-[var(--brand-shadow-soft)] lg:w-[360px]"
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
                                placeholder="00000420"
                                autoComplete="off"
                                spellCheck={false}
                                className="mt-3 h-14 w-full rounded-2xl border border-[#d9e6f8] bg-white px-4 text-lg font-black tracking-wide text-slate-900 outline-none ring-0 placeholder:text-slate-300"
                                data-testid="pizza-console-scanner-input"
                            />
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold text-slate-500">
                                    Il campo resta pronto per gli scanner USB.
                                </p>
                                <Button
                                    type="submit"
                                    className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                                    disabled={isPending}
                                >
                                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invia"}
                                </Button>
                            </div>
                        </form>
                    </div>

                    {feedback ? (
                        <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                            {feedback}
                        </p>
                    ) : null}
                    {error ? (
                        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                            {error}
                        </p>
                    ) : null}
                </header>

                <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                    <section className="rounded-[34px] border border-[#d9e6f8] bg-white/95 p-6 shadow-[var(--brand-shadow-soft)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">In preparazione</p>
                                <h2 className="mt-2 text-2xl font-black text-slate-900">Coda preparazioni</h2>
                            </div>
                            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">
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
                                        key={`${ticket.orderId}-${ticket.pizzaNumber}`}
                                        className="rounded-[28px] border border-[#d9e6f8] bg-[linear-gradient(135deg,#ffffff_0%,#f7fbff_52%,#eef6ff_100%)] p-5 shadow-[var(--brand-shadow-soft)]"
                                        data-testid={`pizza-console-queued-${ticket.pizzaNumber}`}
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-amber-700">
                                                    Piatto in coda
                                                </p>
                                                <p className="font-brand-display mt-3 text-5xl font-black tracking-[-0.07em] text-slate-900">
                                                    {ticket.pizzaNumber}
                                                </p>
                                                <p className="mt-1 text-sm font-black text-slate-900">{ticket.productName}</p>
                                                <p className="mt-2 text-sm font-bold text-slate-700">
                                                    Ordine {ticket.orderCode}
                                                    {ticket.customerName ? ` · ${ticket.customerName}` : ""}
                                                    {ticket.table ? ` · Tavolo ${ticket.table}` : ""}
                                                </p>
                                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                                    Creato alle {formatTime(ticket.createdAt)}
                                                </p>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <Button
                                                    type="button"
                                                    className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                                                    onClick={() => submitScanner(getPizzaBarcodeValue(ticket.pizzaNumber))}
                                                    disabled={isPending}
                                                >
                                                    Segna pronta
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="rounded-2xl border-rose-200 bg-white/85 text-rose-700 hover:bg-rose-50"
                                                    onClick={() => handleRemove(ticket.orderId, ticket.pizzaNumber, "queued")}
                                                    disabled={isPending}
                                                    data-testid={`pizza-console-remove-queued-${ticket.pizzaNumber}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    Rimuovi
                                                </Button>
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <div className="mt-5 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm font-semibold text-slate-500">
                                Nessun piatto in coda.
                            </div>
                        )}
                    </section>

                    <section className="rounded-[34px] border border-[#d9e6f8] bg-white/95 p-6 shadow-[var(--brand-shadow-soft)]">
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
                                        key={`${ticket.orderId}-${ticket.pizzaNumber}-${ticket.readyAt}`}
                                        className="rounded-[28px] border border-[#d9e6f8] bg-[linear-gradient(135deg,#ffffff_0%,#f5fffa_48%,#ebfff3_100%)] p-5 shadow-[var(--brand-shadow-soft)]"
                                        data-testid={`pizza-console-ready-${ticket.pizzaNumber}`}
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    Pronta
                                                </p>
                                                <p className="font-brand-display mt-3 text-5xl font-black tracking-[-0.07em] text-slate-900">
                                                    {ticket.pizzaNumber}
                                                </p>
                                                <p className="mt-1 text-sm font-black text-slate-900">{ticket.productName}</p>
                                                <p className="mt-2 text-xs font-semibold text-emerald-700">
                                                    Pubblicata alle {formatTime(ticket.readyAt)}
                                                </p>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="rounded-2xl border-emerald-300 bg-white/80 text-emerald-700 hover:bg-white"
                                                    onClick={() => handleRequeue(ticket.orderId, ticket.pizzaNumber)}
                                                    disabled={isPending}
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                    Rimetti in coda
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="rounded-2xl border-rose-200 bg-white/85 text-rose-700 hover:bg-rose-50"
                                                    onClick={() => handleRemove(ticket.orderId, ticket.pizzaNumber, "ready")}
                                                    disabled={isPending}
                                                    data-testid={`pizza-console-remove-ready-${ticket.pizzaNumber}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    Rimuovi
                                                </Button>
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <div className="mt-5 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm font-semibold text-slate-500">
                                Nessun piatto segnato come pronto.
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
