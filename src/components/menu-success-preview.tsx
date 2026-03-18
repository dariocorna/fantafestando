"use client";

import { CheckCircle2, MapPinned, ShoppingBag, User, UtensilsCrossed } from "lucide-react";
import { BrandFestiveStrip } from "@/components/brand/brand-festive-strip";
import { EasterEggComposer } from "@/components/easter-egg-composer";
import { Button } from "@/components/ui/button";
import { type ThermalRasterPayload } from "@/lib/easter-egg-raster";

const mockOrder = {
    code: "123",
    customerName: "Mario Rossi",
    table: "B12",
    totalAmount: 14,
    items: [
        {
            name: "Panino Salamella",
            quantity: 2,
            total: 10,
            options: ["Cipolla"]
        },
        {
            name: "Birra Media",
            quantity: 1,
            total: 4,
            options: []
        }
    ]
};

function formatCurrency(value: number) {
    return new Intl.NumberFormat("it-IT", {
        style: "currency",
        currency: "EUR"
    }).format(value);
}

async function simulatePhotoAttach(raster: ThermalRasterPayload) {
    void raster;
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    return {
        success: "Anteprima mock: foto associata all'ordine. Nel flusso reale verra' allegata alla comanda."
    };
}

export function MenuSuccessPreview() {
    const showPhotoOption = true;

    return (
        <div className="brand-surface-menu min-h-screen pb-16">
            <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
                <div className="mx-auto max-w-5xl">
                    <div className="mb-6 rounded-[28px] border border-[#d9e6f8] bg-white/80 px-4 py-3 text-sm font-semibold text-[var(--brand-blue-700)] shadow-[var(--brand-shadow-soft)] backdrop-blur">
                        Preview UI issue #57: proposta schermata &quot;ordine effettuato&quot; con riepilogo e foto opzionale in coda.
                    </div>

                    <section className="overflow-hidden rounded-[42px] border border-[#d9e6f8] bg-white/95 p-6 shadow-[var(--brand-shadow-strong)] md:p-8">
                        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_300px] lg:items-center">
                            <div>
                                <BrandFestiveStrip compact className="max-w-sm" />
                                <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Ordine inviato
                                </div>

                                <h1 className="font-brand-display mt-5 text-4xl font-black tracking-tight text-[var(--brand-ink)] md:text-5xl">
                                    Pronto per la cassa
                                </h1>
                                <p className="mt-4 max-w-2xl text-base font-medium leading-relaxed text-slate-600 md:text-lg">
                                    Mostra questo numero alla cassa per pagare e ricevere il tuo ordine. Il riepilogo resta visibile qui sotto, cosi&apos; puoi ricontrollare tutto con calma.
                                </p>
                            </div>

                            <div className="rounded-[34px] border-2 border-dashed border-[#d9e6f8] bg-[#f7fbff] px-6 py-7 text-center">
                                <span className="block text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                                    Il tuo numero ordine
                                </span>
                                <span className="font-brand-display mt-3 block text-7xl font-black tracking-[-0.08em] text-[var(--brand-blue-700)] md:text-8xl">
                                    {mockOrder.code}
                                </span>
                                <p className="mt-4 text-sm font-bold leading-relaxed text-slate-500">
                                    Questo resta il focus principale della schermata.
                                </p>
                            </div>
                        </div>
                    </section>

                    <div className="mt-6 space-y-6">
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

                            <div className="mt-5 flex flex-wrap gap-3">
                                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600">
                                    <User className="h-4 w-4 text-[var(--brand-blue-700)]" />
                                    {mockOrder.customerName}
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600">
                                    <MapPinned className="h-4 w-4 text-[var(--brand-blue-700)]" />
                                    Tavolo {mockOrder.table}
                                </div>
                            </div>

                            <div className="mt-6 space-y-4">
                                {mockOrder.items.map((item) => (
                                    <div
                                        key={item.name}
                                        className="rounded-[26px] border border-[#d9e6f8] bg-[#fcfdff] p-4"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <p className="text-lg font-black text-[var(--brand-ink)]">
                                                    {item.quantity} x {item.name}
                                                </p>
                                                {item.options.length > 0 ? (
                                                    <p className="mt-2 text-sm font-medium text-slate-500">
                                                        {item.options.map((option) => `+ ${option}`).join(" • ")}
                                                    </p>
                                                ) : (
                                                    <p className="mt-2 text-sm font-medium text-slate-400">
                                                        Nessuna opzione aggiuntiva
                                                    </p>
                                                )}
                                            </div>
                                            <p className="shrink-0 text-lg font-black text-[var(--brand-blue-700)]">
                                                {formatCurrency(item.total)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 rounded-[28px] border border-[#d9e6f8] bg-[linear-gradient(135deg,#f7fbff_0%,#eef6ff_100%)] px-5 py-4">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                                            Totale ordine
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-slate-500">
                                            Sempre leggibile anche dopo l&apos;invio
                                        </p>
                                    </div>
                                    <p className="font-brand-display text-4xl font-black tracking-tight text-[var(--brand-blue-700)]">
                                        {formatCurrency(mockOrder.totalAmount)}
                                    </p>
                                </div>
                            </div>
                        </section>

                        {showPhotoOption ? (
                            <section id="menu-success-preview-photo" className="scroll-mt-6 space-y-4">
                                <div className="rounded-[30px] border border-[#d9e6f8] bg-white/95 p-5 shadow-[var(--brand-shadow-soft)]">
                                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#8b6800]">
                                        Foto facoltativa
                                    </p>
                                    <h2 className="font-brand-display mt-2 text-3xl font-black tracking-tight text-[var(--brand-ink)]">
                                        Aggiungi una foto all&apos;ordine
                                    </h2>
                                    <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600">
                                        Qui sotto trovi il composer reale: serve per valutare come si integra con la schermata finale.
                                    </p>
                                </div>

                                <EasterEggComposer
                                    title="Foto dell'ordine"
                                    submitLabel="Simula allega foto"
                                    submittingLabel="Simulazione invio..."
                                    inputLabel="Selfie o foto"
                                    helpText="Questa e' una demo locale della UI: puoi caricare una foto e vedere il comportamento del blocco nella schermata finale."
                                    emptyStateTitle="Scatta la tua foto"
                                    emptyStateDescription="Carica un'immagine per testare spazi, proporzioni e peso visivo del composer."
                                    captureMode="user"
                                    testIdPrefix="menu-success-preview"
                                    onSubmitRaster={simulatePhotoAttach}
                                />
                            </section>
                        ) : null}
                    </div>

                    <div className="mt-8 flex justify-center">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-14 min-w-[260px] rounded-2xl border-[#d9e6f8] bg-white/90 px-6 text-base font-black text-[var(--brand-ink)] shadow-[var(--brand-shadow-soft)] hover:bg-white"
                        >
                            <ShoppingBag className="h-5 w-5 text-[var(--brand-blue-700)]" />
                            Fai un altro ordine
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
