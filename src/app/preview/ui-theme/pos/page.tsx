import { BrandLogoLockup } from "@/components/brand/brand-logo-lockup";

export default function PosThemePreviewPage() {
    return (
        <div className="brand-surface-pos min-h-screen p-4 md:p-6">
            <div className="mx-auto flex max-w-[1280px] gap-4">
                <section className="min-h-[640px] flex-1 rounded-2xl border border-[#d9e6f8] bg-white shadow-sm">
                    <header className="border-b border-[#d9e6f8] p-4">
                        <BrandLogoLockup
                            title="Preview POS"
                            subtitle="Layout operativo per schermi larghi"
                            compact
                            variant="pos"
                            data-testid="preview-brand-pos-header"
                        />
                    </header>
                    <div className="grid grid-cols-4 gap-3 p-4">
                        {Array.from({ length: 12 }).map((_, index) => (
                            <button
                                key={index}
                                type="button"
                                className="h-28 rounded-xl border border-[#d9e6f8] bg-[#f7fbff] p-3 text-left shadow-sm transition hover:-translate-y-0.5"
                            >
                                <p className="text-sm font-bold text-[var(--brand-ink)]">Prodotto {index + 1}</p>
                                <p className="mt-5 text-xl font-black text-[var(--brand-blue-700)]">6.50 €</p>
                            </button>
                        ))}
                    </div>
                </section>

                <aside className="w-[360px] rounded-2xl border border-[#d9e6f8] bg-white p-4 shadow-sm">
                    <p className="text-xs font-black uppercase tracking-widest text-[var(--brand-blue-700)]">Carrello</p>
                    <div className="mt-3 space-y-2">
                        <div className="rounded-lg bg-[#f7fbff] p-3">
                            <p className="font-bold text-slate-800">2x Hamburger OSG</p>
                            <p className="text-sm text-slate-500">17.00 €</p>
                        </div>
                        <div className="rounded-lg bg-[#f7fbff] p-3">
                            <p className="font-bold text-slate-800">1x Bibita</p>
                            <p className="text-sm text-slate-500">3.00 €</p>
                        </div>
                    </div>
                    <div className="mt-6 border-t border-dashed pt-4">
                        <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Totale</p>
                        <p className="text-4xl font-black text-[var(--brand-blue-700)]">20.00 €</p>
                    </div>
                    <button
                        type="button"
                        className="brand-cta-primary mt-6 w-full rounded-2xl py-4 text-xl font-black"
                        data-testid="preview-brand-pos-cta"
                    >
                        PAGA ORA
                    </button>
                </aside>
            </div>
        </div>
    );
}

