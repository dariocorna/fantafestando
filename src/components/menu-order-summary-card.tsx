"use client";

import { MapPinned, ReceiptText, User, UtensilsCrossed } from "lucide-react";
import { type PublicOrderSummary } from "@/lib/public-order-summary";

function formatCurrency(value: number) {
    return new Intl.NumberFormat("it-IT", {
        style: "currency",
        currency: "EUR"
    }).format(value);
}

export function MenuOrderSummaryCard({ summary }: { summary: PublicOrderSummary }) {
    return (
        <section className="rounded-[34px] border border-[#d9e6f8] bg-white/95 p-6 shadow-[var(--brand-shadow-soft)]">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--brand-blue-700)]">
                        Riepilogo ordine
                    </p>
                    <h2 className="font-brand-display mt-2 text-3xl font-black tracking-tight text-[var(--brand-ink)]">
                        Quello che hai ordinato
                    </h2>
                </div>
                <div className="hidden rounded-2xl bg-[#f7fbff] p-3 text-[var(--brand-blue-700)] md:block">
                    <UtensilsCrossed className="h-6 w-6" />
                </div>
            </div>

            {(summary.customer.name || summary.customer.table) ? (
                <div className="mt-5 flex flex-wrap gap-3">
                    {summary.customer.name ? (
                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600">
                            <User className="h-4 w-4 text-[var(--brand-blue-700)]" />
                            {summary.customer.name}
                        </div>
                    ) : null}
                    {summary.customer.table ? (
                        <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600">
                            <MapPinned className="h-4 w-4 text-[var(--brand-blue-700)]" />
                            Tavolo {summary.customer.table}
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="mt-6 space-y-4">
                {summary.items.map((item) => (
                    <div
                        key={`${item.name}-${item.quantity}`}
                        className="rounded-[26px] border border-[#d9e6f8] bg-[#fcfdff] p-4"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-lg font-black text-[var(--brand-ink)]">
                                    {item.quantity} x {item.name}
                                </p>
                                {item.selectedOptions.length > 0 ? (
                                    <p className="mt-2 text-sm font-medium text-slate-500">
                                        {item.selectedOptions.map((option) => `+ ${option.name}`).join(" • ")}
                                    </p>
                                ) : (
                                    <p className="mt-2 text-sm font-medium text-slate-400">
                                        Nessuna opzione aggiuntiva
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 rounded-[28px] border border-[#d9e6f8] bg-[linear-gradient(135deg,#f7fbff_0%,#eef6ff_100%)] px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-white/75 p-2 text-[var(--brand-blue-700)]">
                            <ReceiptText className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                                Totale ordine
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-500">
                                Sempre leggibile anche dopo l&apos;invio
                            </p>
                        </div>
                    </div>
                    <p className="font-brand-display text-4xl font-black tracking-tight text-[var(--brand-blue-700)]">
                        {formatCurrency(summary.totalAmount)}
                    </p>
                </div>
            </div>
        </section>
    );
}
