"use client"

import { Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
    CheckCircle2,
    ShoppingBag,
    Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"
import { BrandFestiveStrip } from "@/components/brand/brand-festive-strip"
import { MenuOrderEasterEgg } from "@/components/menu-order-easter-egg"

function SuccessContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const code = searchParams.get("code")
    const orderId = searchParams.get("orderId")

    return (
        <div className="brand-surface-menu min-h-screen flex flex-col items-center justify-center p-6 text-center">
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 12 }}
                className="w-full max-w-md rounded-[42px] border border-[#d9e6f8] bg-white p-8 shadow-[var(--brand-shadow-strong)]"
            >
                <BrandFestiveStrip compact />
                <div className="mx-auto mt-5 flex h-24 w-24 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <CheckCircle2 size={48} />
                </div>

                <h1 className="font-brand-display mb-2 mt-6 text-3xl font-black text-[var(--brand-ink)]">Ordine inviato!</h1>
                <p className="mb-6 font-medium text-slate-600">
                    Mostra questo numero progressivo alla cassa per pagare e ricevere il tuo ordine.
                </p>

                <div className="mb-6 rounded-3xl border-2 border-dashed border-[#d9e6f8] bg-[#f7fbff] py-7">
                    <span className="block text-xs font-black uppercase tracking-widest text-slate-500">Il tuo numero ordine</span>
                    <span className="font-brand-display text-6xl font-black tracking-tighter text-[var(--brand-blue-700)]">{code || "---"}</span>
                </div>

                <p className="px-2 text-xs font-bold leading-relaxed text-slate-500">
                    La tua comanda è già stata inoltrata ai reparti: completa il pagamento in cassa mostrando questo codice.
                </p>
            </motion.div>

            <div className="mt-10 w-full max-w-md">
                <Button
                    className="brand-cta-primary h-14 w-full rounded-2xl text-base font-black hover:brightness-105"
                    onClick={() => router.push('/menu')}
                >
                    <ShoppingBag size={20} />
                    FAI UN ALTRO ORDINE
                </Button>
            </div>

            <MenuOrderEasterEgg orderId={orderId} />
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
