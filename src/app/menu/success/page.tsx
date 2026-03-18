"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { CheckCircle2, Loader2, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"
import { BrandFestiveStrip } from "@/components/brand/brand-festive-strip"
import { MenuOrderEasterEgg } from "@/components/menu-order-easter-egg"
import { MenuOrderSummaryCard } from "@/components/menu-order-summary-card"
import { readRecentOrderSummary } from "@/app/menu/recent-order-storage"
import { readPendingEasterEggUpload } from "@/app/menu/easter-egg-upload-storage"
import { type PublicOrderSummary } from "@/lib/public-order-summary"

function SuccessContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const code = searchParams.get("code")
    const orderId = searchParams.get("orderId")
    const [summary, setSummary] = useState<PublicOrderSummary | null>(() => (
        orderId ? readRecentOrderSummary(orderId) : null
    ))
    const [summaryFetchFailed, setSummaryFetchFailed] = useState(false)
    const hasEasterEgg = useMemo(
        () => (orderId ? Boolean(readPendingEasterEggUpload(orderId)) : false),
        [orderId],
    )
    const shouldFetchSummary = Boolean(orderId && code && !summary)
    const isLoadingSummary = shouldFetchSummary && !summaryFetchFailed

    useEffect(() => {
        if (!orderId || !code || summary) return

        let isCancelled = false

        fetch(`/api/public/orders/${orderId}/summary?code=${encodeURIComponent(code)}`, {
            cache: "no-store"
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Summary request failed with status ${response.status}`)
                }
                const payload = await response.json().catch(() => ({} as { summary?: PublicOrderSummary }))
                if (!payload.summary) {
                    throw new Error("Summary payload missing")
                }
                return payload.summary
            })
            .then((nextSummary) => {
                if (isCancelled) return
                setSummaryFetchFailed(false)
                setSummary(nextSummary)
            })
            .catch((error) => {
                if (isCancelled) return
                console.error("Failed to load public order summary", error)
                setSummaryFetchFailed(true)
            })

        return () => {
            isCancelled = true
        }
    }, [code, orderId, summary])

    return (
        <div className="brand-surface-menu min-h-screen pb-16">
            <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
                <div className="mx-auto max-w-5xl">
                    <motion.section
                        initial={{ scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", damping: 14 }}
                        className="overflow-hidden rounded-[42px] border border-[#d9e6f8] bg-white/95 p-6 shadow-[var(--brand-shadow-strong)] md:p-8"
                    >
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
                                    {code || "---"}
                                </span>
                                <p className="mt-4 text-sm font-bold leading-relaxed text-slate-500">
                                    Questo resta il focus principale della schermata.
                                </p>
                            </div>
                        </div>
                    </motion.section>

                    <div className="mt-6 space-y-6">
                        <div>
                            {summary ? (
                                <MenuOrderSummaryCard summary={summary} />
                            ) : (
                                <div className="rounded-[34px] border border-[#d9e6f8] bg-white/95 p-6 shadow-[var(--brand-shadow-soft)]">
                                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--brand-blue-700)]">
                                        Riepilogo ordine
                                    </p>
                                    <div className="mt-4 flex items-center gap-3 text-sm font-semibold text-slate-500">
                                        <Loader2 className={`h-4 w-4 ${isLoadingSummary ? "animate-spin" : ""}`} />
                                        {isLoadingSummary ? "Caricamento riepilogo..." : "Riepilogo non disponibile al momento."}
                                    </div>
                                </div>
                            )}
                        </div>

                        {hasEasterEgg ? (
                            <section id="menu-success-photo" className="scroll-mt-6">
                                <MenuOrderEasterEgg orderId={orderId} />
                            </section>
                        ) : null}
                    </div>

                    <div className="mt-8 flex justify-center">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-14 min-w-[260px] rounded-2xl border-[#d9e6f8] bg-white/90 px-6 text-base font-black text-[var(--brand-ink)] shadow-[var(--brand-shadow-soft)] hover:bg-white"
                            onClick={() => router.push('/menu')}
                        >
                            <ShoppingBag className="h-5 w-5 text-[var(--brand-blue-700)]" />
                            Fai un altro ordine
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default function SuccessPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>}>
            <SuccessContent />
        </Suspense>
    )
}
