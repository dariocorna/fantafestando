"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
    ChevronLeft,
    User,
    Hash,
    Loader2,
    ShoppingBag,
    ArrowRight
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createPublicOrder } from "../actions"
import { isTableValueValid, normalizeTableValue } from "@/lib/table-presets"

interface Product {
    _id: string
    name: string
    basePrice: number
}

interface CartItem extends Product {
    quantity: number
}

interface EventCheckoutConfig {
    askName?: boolean
    askTable?: boolean
    predefinedTables?: string[]
}

export default function CheckoutPage() {
    const router = useRouter()
    const [cart] = useState<CartItem[]>(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("osg_cart")
            return saved ? JSON.parse(saved) : []
        }
        return []
    })
    const [eventId] = useState(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("osg_eventId") || ""
        }
        return ""
    })
    const [customerName, setCustomerName] = useState("")
    const [tableNumber, setTableNumber] = useState("")
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [checkoutError, setCheckoutError] = useState<string | null>(null)
    const [eventSettings, setEventSettings] = useState<EventCheckoutConfig | null>(null)
    const normalizedTableValue = normalizeTableValue(tableNumber)
    const tableValueValid = isTableValueValid(tableNumber)
    const predefinedTables = eventSettings?.predefinedTables || []

    useEffect(() => {
        if (eventId) {
            // Fetch event settings to know if we need name/table
            fetch("/api/pos/init").then(res => res.json()).then(data => {
                if (data.event) {
                    setEventSettings({
                        askName: data.event.settings?.askName ?? false,
                        askTable: data.event.settings?.askTable ?? false,
                        predefinedTables: Array.isArray(data.event.predefinedTables) ? data.event.predefinedTables : []
                    })
                }
            })
        }
    }, [eventId])

    const totalPrice = cart.reduce((acc, item) => acc + (item.basePrice * item.quantity), 0)

    const handleSubmit = async () => {
        setCheckoutError(null)

        if (eventSettings?.askName && !customerName.trim()) {
            setCheckoutError("Inserisci il tuo nome")
            return
        }
        if (eventSettings?.askTable && !tableValueValid) {
            setCheckoutError("Inserisci il tavolo oppure selezionalo dalla lista")
            return
        }

        setIsSubmitting(true)
        const result = await createPublicOrder({
            eventId,
            customer: {
                name: customerName || undefined,
                table: normalizedTableValue || undefined
            },
            totalAmount: totalPrice,
            cart: cart.map(item => ({
                productId: item._id,
                snapshotName: item.name,
                quantity: item.quantity,
                selectedOptions: []
            }))
        })

        if (result.success) {
            localStorage.removeItem("osg_cart")
            router.push(`/menu/success?code=${result.shortCode}`)
        } else {
            setCheckoutError(result.error || "Non è stato possibile inviare l'ordine. Riprova.")
            setIsSubmitting(false)
        }
    }

    if (cart.length === 0) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
                <ShoppingBag size={64} className="text-slate-200 mb-4" />
                <h2 className="text-2xl font-black text-slate-800">Carrello vuoto</h2>
                <Button className="mt-6 rounded-2xl" onClick={() => router.push('/menu')}>Torna al Menu</Button>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6 flex flex-col">
            <header className="flex items-center gap-4 mb-8">
                <button onClick={() => router.back()} className="p-3 bg-white rounded-2xl shadow-sm">
                    <ChevronLeft size={24} />
                </button>
                <h1 className="text-2xl font-black text-slate-800">Checkout</h1>
            </header>

            <div className="flex-1 max-w-xl mx-auto w-full space-y-8 pb-32">
                {/* Summary Section */}
                <div className="bg-white rounded-[32px] p-6 shadow-sm border border-slate-100">
                    <h2 className="font-black text-slate-400 uppercase tracking-widest text-xs mb-4">Riepilogo Ordine</h2>
                    <div className="space-y-4">
                        {cart.map(item => (
                            <div key={item._id} className="flex justify-between items-center">
                                <div className="font-bold text-slate-700">
                                    <span className="text-orange-500 mr-2">{item.quantity}x</span>
                                    {item.name}
                                </div>
                                <span className="font-black">{(item.basePrice * item.quantity).toFixed(2)} €</span>
                            </div>
                        ))}
                        <div className="pt-4 border-t border-dashed flex justify-between items-center">
                            <span className="font-black text-slate-800">Totale</span>
                            <span className="text-2xl font-black text-orange-600">{totalPrice.toFixed(2)} €</span>
                        </div>
                    </div>
                </div>

                {/* Customer Info Section */}
                <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100 space-y-6">
                    <h2 className="font-black text-slate-400 uppercase tracking-widest text-xs">Informazioni Consegna</h2>

                    {eventSettings?.askName && (
                        <div className="space-y-3">
                            <Label className="text-slate-500 font-bold ml-1">Il tuo nome</Label>
                            <div className="relative">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                                <Input
                                    className="h-14 pl-12 rounded-2xl bg-slate-50 border-none font-bold text-lg"
                                    placeholder="Es: Mario Rossi"
                                    value={customerName}
                                    onChange={(e) => {
                                        setCustomerName(e.target.value)
                                        if (checkoutError) setCheckoutError(null)
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {eventSettings?.askTable && (
                        <div className="space-y-3">
                            <Label className="text-slate-500 font-bold ml-1">Tavolo</Label>
                            <div className="rounded-2xl bg-slate-50 p-4 space-y-4">
                                {predefinedTables.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {predefinedTables.map((table) => {
                                            const isActive = normalizeTableValue(table) === normalizedTableValue
                                            return (
                                                <button
                                                    key={table}
                                                    type="button"
                                                    onClick={() => {
                                                        setTableNumber(table)
                                                        if (checkoutError) setCheckoutError(null)
                                                    }}
                                                    className={`rounded-xl border-2 px-3 py-2 text-sm font-black transition-colors ${isActive ? "border-orange-600 bg-orange-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-orange-300"}`}
                                                >
                                                    {table}
                                                </button>
                                            )
                                        })}
                                    </div>
                                ) : null}
                                <div className="relative">
                                    <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                                    <Input
                                        className="h-14 pl-12 rounded-2xl bg-white border border-slate-200 font-bold text-lg"
                                        placeholder="Es: B02 oppure VIP TERRAZZA"
                                        value={tableNumber}
                                        onChange={(e) => {
                                            setTableNumber(e.target.value)
                                            if (checkoutError) setCheckoutError(null)
                                        }}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                        Tavolo selezionato: <span className="text-slate-800">{normalizedTableValue || "---"}</span>
                                    </p>
                                    <button
                                        type="button"
                                        className="text-xs font-black text-slate-500 hover:text-slate-800"
                                        onClick={() => {
                                            setTableNumber("")
                                            if (checkoutError) setCheckoutError(null)
                                        }}
                                    >
                                        RESET
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {(!eventSettings?.askName && !eventSettings?.askTable) && (
                        <p className="text-slate-400 font-medium italic text-center py-4">
                            Nessun dato aggiuntivo richiesto. Procedi pure!
                        </p>
                    )}
                </div>
            </div>

            {/* Submit Button */}
            <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent">
                {checkoutError ? (
                    <div
                        role="alert"
                        className="w-full max-w-xl mx-auto mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
                    >
                        {checkoutError}
                    </div>
                ) : null}
                <Button
                    disabled={isSubmitting}
                    onClick={handleSubmit}
                    className="w-full max-w-xl mx-auto h-20 rounded-3xl bg-orange-600 hover:bg-orange-700 text-white font-black text-xl shadow-xl shadow-orange-100 flex items-center justify-center gap-3 transition-all active:scale-95"
                >
                    {isSubmitting ? (
                        <Loader2 className="animate-spin" size={32} />
                    ) : (
                        <>
                            INVIA ORDINE
                            <ArrowRight size={28} />
                        </>
                    )}
                </Button>
            </div>
        </div>
    )
}
