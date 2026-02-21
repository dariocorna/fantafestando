"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { CheckCircle2, ShoppingBag, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"
import { Suspense } from "react"

function SuccessContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const code = searchParams.get('code')

    return (
        <div className="min-h-screen bg-white p-8 flex flex-col items-center justify-center text-center">
            <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-8"
            >
                <CheckCircle2 size={48} />
            </motion.div>

            <h1 className="text-4xl font-black text-slate-800 mb-2">Ordine Inviato!</h1>
            <p className="text-slate-500 font-medium mb-12">
                Il tuo ordine è stato ricevuto. Prendi nota del tuo codice:
            </p>

            <div className="bg-slate-50 p-12 rounded-[40px] border-2 border-dashed border-slate-200 mb-12 w-full max-w-sm">
                <span className="text-slate-400 font-black uppercase tracking-widest text-sm">Codice Ritiro</span>
                <div className="text-6xl font-black text-slate-900 mt-2 tracking-tighter">
                    {code || "----"}
                </div>
            </div>

            <div className="space-y-4 w-full max-w-sm">
                <div className="bg-blue-50 p-6 rounded-3xl text-blue-700 text-sm font-bold flex items-start gap-4 text-left">
                    <div className="bg-blue-200 p-2 rounded-xl text-blue-800">
                        <ShoppingBag size={20} />
                    </div>
                    Comunicalo alla cassa quando verrai chiamato o se richiesto per il ritiro.
                </div>

                <Button
                    variant="outline"
                    className="w-full h-16 rounded-2xl font-bold border-2"
                    onClick={() => router.push('/menu')}
                >
                    Torna al Menu
                </Button>
            </div>
        </div>
    )
}

export default function SuccessPage() {
    return (
        <Suspense fallback={<div>Caricamento...</div>}>
            <SuccessContent />
        </Suspense>
    )
}
