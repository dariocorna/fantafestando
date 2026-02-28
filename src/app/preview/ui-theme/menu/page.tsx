import { ArrowRight, Plus } from "lucide-react";
import { BrandFestiveStrip } from "@/components/brand/brand-festive-strip";
import { BrandLogoLockup } from "@/components/brand/brand-logo-lockup";
import { BrandSectionHeader } from "@/components/brand/brand-section-header";

const previewItems = [
    { name: "Hamburger OSG", description: "Carne, cheddar e salsa festa", price: "8.50 €" },
    { name: "Patatine croccanti", description: "Porzione media", price: "4.00 €" },
    { name: "Bibita artigianale", description: "Lattina 33cl", price: "3.00 €" },
];

export default function MenuThemePreviewPage() {
    return (
        <div className="brand-surface-menu min-h-screen pb-24">
            <div className="sticky top-0 z-10 border-b border-[#d9e6f8] bg-white/95 px-4 py-4 backdrop-blur">
                <div className="mx-auto max-w-2xl">
                    <BrandFestiveStrip compact />
                    <BrandLogoLockup
                        title="Preview Menu"
                        subtitle="Tema logo 2026"
                        className="mt-2"
                        data-testid="preview-brand-menu-header"
                    />
                    <p className="mt-3 text-sm font-semibold text-[var(--brand-blue-700)]">
                        Anteprima visuale: stile cliente mobile-first con accenti festa.
                    </p>
                </div>
            </div>

            <div className="mx-auto mt-6 max-w-2xl space-y-6 px-4">
                <BrandSectionHeader
                    title="Panini e sfizi"
                    subtitle="Card prodotto con gerarchia chiara e CTA primaria."
                />
                <div className="space-y-3">
                    {previewItems.map((item) => (
                        <div key={item.name} className="rounded-3xl border border-[#d9e6f8] bg-white p-4 shadow-[var(--brand-shadow-soft)]">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className="font-brand-display text-lg font-bold text-[var(--brand-ink)]">{item.name}</h3>
                                    <p className="mt-1 text-sm font-medium text-slate-600">{item.description}</p>
                                    <p className="mt-3 text-lg font-extrabold text-[var(--brand-blue-700)]">{item.price}</p>
                                </div>
                                <button className="brand-chip inline-flex h-11 w-11 items-center justify-center" type="button">
                                    <Plus size={20} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="fixed inset-x-0 bottom-0 p-4">
                <button
                    className="brand-cta-primary mx-auto flex w-full max-w-2xl items-center justify-between rounded-3xl px-5 py-4 font-black"
                    type="button"
                    data-testid="preview-brand-menu-cta"
                >
                    <span>Vedi carrello (3)</span>
                    <span className="inline-flex items-center gap-2">15.50 € <ArrowRight size={18} /></span>
                </button>
            </div>
        </div>
    );
}

