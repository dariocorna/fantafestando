import { BrandLogoLockup } from "@/components/brand/brand-logo-lockup";
import { BrandSectionHeader } from "@/components/brand/brand-section-header";

const kpis = [
    { label: "Incasso", value: "2.430 €" },
    { label: "Ordini", value: "164" },
    { label: "Ticket medio", value: "14.82 €" },
];

export default function AdminThemePreviewPage() {
    return (
        <div className="brand-surface-admin min-h-screen p-4 md:p-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <header className="rounded-2xl border border-[#d9e6f8] bg-white px-4 py-3 shadow-sm">
                    <BrandLogoLockup
                        title="Preview Admin"
                        subtitle="Shell funzionale con tocchi brand"
                        compact
                        variant="admin"
                        data-testid="preview-brand-admin-header"
                    />
                </header>

                <main className="grid gap-6 lg:grid-cols-[240px_1fr]">
                    <aside className="rounded-2xl border border-[#d9e6f8] bg-white p-4 shadow-sm">
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--brand-blue-700)]">Navigazione</p>
                        <ul className="mt-3 space-y-2 text-sm font-semibold text-slate-700">
                            <li className="rounded-lg bg-[#eef5ff] px-3 py-2 text-[var(--brand-blue-700)]">Dashboard</li>
                            <li className="rounded-lg px-3 py-2">Catalogo</li>
                            <li className="rounded-lg px-3 py-2">Ordini</li>
                            <li className="rounded-lg px-3 py-2">Impostazioni</li>
                        </ul>
                    </aside>

                    <section className="space-y-4">
                        <BrandSectionHeader title="Panoramica evento" subtitle="Sobrio, denso e leggibile per uso operativo." />
                        <div className="grid gap-3 sm:grid-cols-3">
                            {kpis.map((kpi) => (
                                <article key={kpi.label} className="rounded-xl border border-[#d9e6f8] bg-white p-4 shadow-sm">
                                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">{kpi.label}</p>
                                    <p className="mt-1 text-2xl font-black text-[var(--brand-ink)]">{kpi.value}</p>
                                </article>
                            ))}
                        </div>
                    </section>
                </main>
            </div>
        </div>
    );
}

