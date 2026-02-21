"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
    CheckCircle2,
    ShoppingBag,
    ArrowRight,
    Loader2,
    Printer,
    Home
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"

function SuccessContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const code = searchParams.get("code")

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 12 }}
                className="bg-white p-10 rounded-[48px] shadow-xl shadow-slate-200 border border-slate-100 max-w-sm w-full"
            >
                <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8">
                    <CheckCircle2 size={48} />
                </div>

                <h1 className="text-3xl font-black text-slate-800 mb-2">Ordine Inviato!</h1>
                <p className="text-slate-500 font-medium mb-8">
                    Mostra questo codice alla cassa per pagare e ricevere il tuo ordine.
                </p>

                <div className="bg-slate-50 py-8 rounded-3xl border-2 border-dashed border-slate-200 mb-8">
                    <span className="text-slate-400 font-black uppercase tracking-widest text-xs block mb-2">Il Tuo Codice</span>
                    <span className="text-6xl font-black text-blue-600 tracking-tighter">{code || "---"}</span>
                </div>

                <div className="space-y-4">
                    <p className="text-xs text-slate-400 font-bold leading-relaxed px-4">
                        Il tuo ordine verrà preparato non appena avrai confermato il pagamento in cassa.
                    </p>
                </div>
            </motion.div>

            <div className="mt-12 w-full max-w-sm space-y-4">
                <Button
                    variant="outline"
                    className="w-full h-16 rounded-2xl font-bold bg-white text-slate-600 border-slate-200 flex items-center justify-center gap-2"
                    onClick={() => router.push('/menu')}
                >
                    <ShoppingBag size={20} />
                    FAI UN ALTRO ORDINE
                </Button>
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
