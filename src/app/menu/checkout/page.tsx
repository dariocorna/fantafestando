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
import { type StockShortage } from "@/lib/inventory"
import { BrandFestiveStrip } from "@/components/brand/brand-festive-strip"
import { BrandSectionHeader } from "@/components/brand/brand-section-header"

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
    const [checkoutShortages, setCheckoutShortages] = useState<StockShortage[]>([])
    const [eventSettings, setEventSettings] = useState<EventCheckoutConfig | null>(null)
    const normalizedTableValue = normalizeTableValue(tableNumber)
    const tableValueValid = isTableValueValid(tableNumber)
    const predefinedTables = eventSettings?.predefinedTables || []

    useEffect(() => {
        if (eventId) {
            fetch("/api/pos/init", { cache: "no-store" }).then(res => res.json()).then(data => {
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
        setCheckoutShortages([])

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
            if ("stockShortages" in result && Array.isArray(result.stockShortages)) {
                setCheckoutShortages(result.stockShortages)
            } else {
                setCheckoutShortages([])
            }
            setIsSubmitting(false)
        }
    }

    if (cart.length === 0) {
        return (
            <div className="brand-surface-menu min-h-screen flex flex-col items-center justify-center p-6 text-center">
                <ShoppingBag size={64} className="mb-4 text-slate-300" />
                <h2 className="font-brand-display text-2xl font-black text-[var(--brand-ink)]">Carrello vuoto</h2>
                <Button className="brand-cta-primary mt-6 rounded-2xl" onClick={() => router.push('/menu')}>Torna al Menu</Button>
            </div>
        )
    }

    return (
        <div className="brand-surface-menu min-h-screen p-5 md:p-6">
            <div className="mx-auto max-w-3xl">
                <header className="mb-5 rounded-3xl border border-[#d9e6f8] bg-white p-4 shadow-[var(--brand-shadow-soft)]">
                    <BrandFestiveStrip compact />
                    <div className="mt-2 flex items-center gap-3">
                        <button onClick={() => router.back()} className="rounded-2xl bg-[#eef5ff] p-3 text-[var(--brand-blue-700)]">
                            <ChevronLeft size={22} />
                        </button>
                        <h1 className="font-brand-display text-2xl font-extrabold text-[var(--brand-ink)]">Checkout</h1>
                    </div>
                </header>

                <div className="space-y-6 pb-32">
                    <section className="rounded-[30px] border border-[#d9e6f8] bg-white p-6 shadow-[var(--brand-shadow-soft)]">
                        <BrandSectionHeader title="Riepilogo Ordine" />
                        <div className="mt-4 space-y-4">
                            {cart.map(item => (
                                <div key={item._id} className="flex items-center justify-between">
                                    <div className="font-bold text-slate-700">
                                        <span className="mr-2 text-[var(--brand-blue-500)]">{item.quantity}x</span>
                                        {item.name}
                                    </div>
                                    <span className="font-black">{(item.basePrice * item.quantity).toFixed(2)} €</span>
                                </div>
                            ))}
                            <div className="flex items-center justify-between border-t border-dashed pt-4">
                                <span className="font-black text-slate-800">Totale</span>
                                <span className="text-2xl font-black text-[var(--brand-blue-700)]">{totalPrice.toFixed(2)} €</span>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-[30px] border border-[#d9e6f8] bg-white p-6 shadow-[var(--brand-shadow-soft)]">
                        <BrandSectionHeader title="Informazioni Consegna" />

                        <div className="mt-5 space-y-5">
                            {eventSettings?.askName && (
                                <div className="space-y-3">
                                    <Label className="ml-1 text-slate-600 font-bold">Il tuo nome</Label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                                        <Input
                                            className="h-14 rounded-2xl border border-[#d9e6f8] bg-[#f8fbff] pl-12 text-lg font-bold"
                                            placeholder="Es: Mario Rossi"
                                            value={customerName}
                                            onChange={(e) => {
                                                setCustomerName(e.target.value)
                                                if (checkoutError) setCheckoutError(null)
                                                if (checkoutShortages.length > 0) setCheckoutShortages([])
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {eventSettings?.askTable && (
                                <div className="space-y-3">
                                    <Label className="ml-1 text-slate-600 font-bold">Tavolo</Label>
                                    <div className="space-y-4 rounded-2xl border border-[#d9e6f8] bg-[#f8fbff] p-4">
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
                                                                if (checkoutShortages.length > 0) setCheckoutShortages([])
                                                            }}
                                                            className={`rounded-xl border-2 px-3 py-2 text-sm font-black transition-colors ${isActive ? "border-[var(--brand-blue-700)] bg-[var(--brand-blue-700)] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-[var(--brand-blue-500)]"}`}
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
                                                className="h-14 rounded-2xl border border-[#d9e6f8] bg-white pl-12 text-lg font-bold"
                                                placeholder="Es: B02 oppure VIP TERRAZZA"
                                                value={tableNumber}
                                                onChange={(e) => {
                                                    setTableNumber(e.target.value)
                                                    if (checkoutError) setCheckoutError(null)
                                                    if (checkoutShortages.length > 0) setCheckoutShortages([])
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
                                                    if (checkoutShortages.length > 0) setCheckoutShortages([])
                                                }}
                                            >
                                                RESET
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(!eventSettings?.askName && !eventSettings?.askTable) && (
                                <p className="py-4 text-center font-medium italic text-slate-500">
                                    Nessun dato aggiuntivo richiesto. Procedi pure!
                                </p>
                            )}
                        </div>
                    </section>
                </div>
            </div>

            <div className="fixed inset-x-0 bottom-0 p-4">
                {checkoutError ? (
                    <div
                        role="alert"
                        className="mx-auto mb-3 w-full max-w-3xl rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
                    >
                        <p>{checkoutError}</p>
                        {checkoutShortages.length > 0 ? (
                            <ul className="mt-2 space-y-1 text-xs font-bold">
                                {checkoutShortages.map((shortage) => (
                                    <li key={`${shortage.productId}-${shortage.requestedQuantity}`}>
                                        {shortage.productName}: richiesti {shortage.requestedQuantity}, disponibili {shortage.availableQuantity}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}
                <Button
                    disabled={isSubmitting}
                    onClick={handleSubmit}
                    className="brand-cta-primary mx-auto flex h-16 w-full max-w-3xl items-center justify-center gap-3 rounded-2xl text-lg font-black hover:brightness-105"
                >
                    {isSubmitting ? (
                        <Loader2 className="animate-spin" size={28} />
                    ) : (
                        <>
                            INVIA ORDINE
                            <ArrowRight size={24} />
                        </>
                    )}
                </Button>
            </div>
        </div>
    )
}
