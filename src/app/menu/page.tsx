"use client"

import { useState, useEffect } from "react"
import {
    ArrowRight,
    Info,
    X,
    Plus,
    Minus
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion, AnimatePresence } from "framer-motion"
import { useRouter } from "next/navigation"
import { getCategoryTheme } from "@/lib/category-colors"
import { BrandSectionHeader } from "@/components/brand/brand-section-header"

interface Product {
    _id: string
    name: string
    description?: string
    basePrice: number
    categoryId: string
    variants?: { optionName: string; priceVariation: number }[]
}

interface Category {
    _id: string
    name: string
    uiColor?: string
}

interface CartItem extends Product {
    quantity: number
}

interface ActiveEventSummary {
    _id: string
    name: string
    settings?: {
        menuHeaderLogoUrl?: string
    }
}

export default function CustomerMenu() {
    const [categories, setCategories] = useState<Category[]>([])
    const [products, setProducts] = useState<Product[]>([])
    const [activeEvent, setActiveEvent] = useState<ActiveEventSummary | null>(null)
    const [activeTab, setActiveTab] = useState("")
    const [cart, setCart] = useState<CartItem[]>([])
    const [isCartOpen, setIsCartOpen] = useState(false)
    const router = useRouter()

    useEffect(() => {
        const fetchData = async () => {
            const res = await fetch('/api/pos/init', { cache: "no-store" })
            const data = await res.json()
            if (data.event) {
                setActiveEvent(data.event)
                setCategories(data.categories)
                setProducts(data.products)
                if (data.categories.length > 0) setActiveTab(data.categories[0]._id)
            }
        }
        fetchData()
    }, [])

    const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0)
    const totalPrice = cart.reduce((acc, item) => acc + (item.basePrice * item.quantity), 0)

    const addToCart = (product: Product) => {
        setCart(prev => {
            const exists = prev.find(i => i._id === product._id)
            if (exists) {
                return prev.map(i => i._id === product._id ? { ...i, quantity: i.quantity + 1 } : i)
            }
            return [...prev, { ...product, quantity: 1 }]
        })
    }

    const removeFromCart = (productId: string) => {
        setCart(prev => {
            const exists = prev.find(i => i._id === productId)
            if (exists && exists.quantity > 1) {
                return prev.map(i => i._id === productId ? { ...i, quantity: i.quantity - 1 } : i)
            }
            return prev.filter(i => i._id !== productId)
        })
    }

    return (
        <div className="brand-surface-menu min-h-screen pb-32" data-testid="menu-brand-shell">
            <div className="border-b border-[#d9e6f8] bg-white/95 px-4 pb-3 pt-2 md:px-6">
                <div className="mx-auto max-w-3xl">
                    <div className={activeEvent?.settings?.menuHeaderLogoUrl ? "mt-1" : "mt-1 rounded-3xl border border-[#d9e6f8] bg-white p-3"}>
                        {activeEvent?.settings?.menuHeaderLogoUrl ? (
                            <div className="space-y-2">
                                <div
                                    className="overflow-hidden"
                                    style={{
                                        aspectRatio: "10 / 4",
                                        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)",
                                        maskImage: "linear-gradient(to bottom, transparent 0%, black 16%, black 84%, transparent 100%)",
                                    }}
                                    data-testid="menu-header-custom-logo"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={activeEvent.settings.menuHeaderLogoUrl}
                                        alt={`Logo header ${activeEvent.name}`}
                                        className="h-full w-full object-contain"
                                    />
                                </div>
                                <p className="flex items-center gap-1 text-xs font-semibold text-[var(--brand-blue-700)] md:text-sm">
                                    <Info size={14} /> Tocca i prodotti per aggiungerli
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                <p className="brand-chip inline-flex px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em]">
                                    Oratorio in Festa
                                </p>
                                <h1 className="font-brand-display truncate text-2xl font-extrabold tracking-tight text-[var(--brand-blue-700)] md:text-3xl">
                                    {activeEvent?.name || "OSG Fest"}
                                </h1>
                                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-[var(--brand-blue-700)] md:text-sm">
                                    <Info size={14} /> Tocca i prodotti per aggiungerli
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="sticky top-0 z-30 border-y border-[#d9e6f8] bg-white/95 px-4 py-2 backdrop-blur md:px-6">
                <div className="mx-auto max-w-3xl">
                    <div
                        data-testid="menu-category-nav"
                        className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap"
                    >
                        {categories.map(cat => {
                            const catTheme = getCategoryTheme(cat.uiColor)
                            const isActive = activeTab === cat._id

                            return (
                                <button
                                    key={cat._id}
                                    onClick={() => {
                                        setActiveTab(cat._id)
                                        document.getElementById(cat._id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                    }}
                                    className="w-full rounded-xl border px-2 py-1.5 text-center text-xs font-bold leading-tight transition-all sm:w-auto sm:rounded-full sm:px-4 sm:py-2 sm:text-sm"
                                    style={isActive
                                        ? {
                                            backgroundColor: catTheme.base,
                                            color: catTheme.onBase,
                                            borderColor: catTheme.base,
                                        }
                                        : {
                                            backgroundColor: catTheme.softBg,
                                            color: catTheme.base,
                                            borderColor: catTheme.border
                                        }}
                                >
                                    {cat.name}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>

            <div className="mx-auto mt-6 max-w-3xl space-y-10 px-4">
                {categories.map(cat => {
                    const catTheme = getCategoryTheme(cat.uiColor)

                    return (
                        <section key={cat._id} id={cat._id} className="space-y-4">
                            <BrandSectionHeader title={cat.name} />
                            <div className="grid gap-4">
                                {products
                                    .filter(p => p.categoryId === cat._id)
                                    .map(product => {
                                        const cartQuantity = cart.find(i => i._id === product._id)?.quantity || 0
                                        return (
                                            <div
                                                key={product._id}
                                                className="flex items-center justify-between rounded-3xl border border-[#d9e6f8] bg-white p-4 transition-transform active:scale-[0.99]"
                                            >
                                                <div className="flex-1">
                                                    <h3 className="font-brand-display text-lg font-bold text-[var(--brand-ink)]">{product.name}</h3>
                                                    {product.description?.trim() ? (
                                                        <p className="mt-1 pr-4 text-sm text-slate-600 line-clamp-2">
                                                            {product.description}
                                                        </p>
                                                    ) : null}
                                                    <div className="mt-3 text-lg font-black" style={{ color: catTheme.base }}>
                                                        {product.basePrice.toFixed(2)} €
                                                    </div>
                                                </div>

                                                <div className="ml-3 flex flex-col items-center gap-2">
                                                    {cartQuantity > 0 ? (
                                                        <div className="flex items-center gap-2 rounded-full bg-slate-100 p-1">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); removeFromCart(product._id); }}
                                                                className="flex h-8 w-8 items-center justify-center rounded-full bg-white"
                                                                style={{ color: catTheme.base }}
                                                            >
                                                                <Minus size={18} />
                                                            </button>
                                                            <span className="w-4 text-center font-black text-slate-800">{cartQuantity}</span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); addToCart(product); }}
                                                                className="flex h-8 w-8 items-center justify-center rounded-full shadow-md"
                                                                style={{
                                                                    backgroundColor: catTheme.base,
                                                                    color: catTheme.onBase,
                                                                }}
                                                            >
                                                                <Plus size={18} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => addToCart(product)}
                                                            className="flex h-11 w-11 items-center justify-center rounded-2xl border transition-colors"
                                                            style={{
                                                                backgroundColor: catTheme.softBg,
                                                                color: catTheme.base,
                                                                borderColor: catTheme.border
                                                            }}
                                                        >
                                                            <Plus size={22} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                            </div>
                        </section>
                    )
                })}
            </div>

            <footer className="mt-12 border-t border-[#d9e6f8] bg-white/90 px-4 py-3 text-xs text-slate-600">
                <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
                    <span>Copyright 2026 OSGFest</span>
                    <a
                        href="mailto:osgfest@gmail.com"
                        className="font-semibold text-[var(--brand-blue-700)] underline-offset-2 hover:underline"
                    >
                        osgfest@gmail.com
                    </a>
                </div>
            </footer>

            <AnimatePresence>
                {cart.length > 0 && (
                    <motion.div
                        initial={{ y: 100 }}
                        animate={{ y: 0 }}
                        exit={{ y: 100 }}
                        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 p-4"
                    >
                        <button
                            onClick={() => setIsCartOpen(true)}
                            className="brand-cta-primary pointer-events-auto mx-auto flex w-full max-w-3xl items-center justify-between rounded-3xl p-4 text-left font-black shadow-none"
                            data-testid="menu-cart-cta"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 text-sm">
                                    {totalItems}
                                </div>
                                <span className="text-lg">Vedi Carrello</span>
                            </div>
                            <div className="flex items-center gap-2 text-xl">
                                <span>{totalPrice.toFixed(2)} €</span>
                                <ArrowRight size={22} />
                            </div>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isCartOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 p-4"
                    >
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[36px] border border-[#d9e6f8] bg-white p-7"
                        >
                            <div className="mb-7 flex items-center justify-between">
                                <h2 className="font-brand-display text-3xl font-extrabold text-[var(--brand-ink)]">Il tuo ordine</h2>
                                <button onClick={() => setIsCartOpen(false)} className="rounded-full bg-slate-100 p-2 text-slate-400">
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="space-y-5">
                                {cart.map(item => (
                                    <div key={item._id} className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fff4cc] font-black text-[#bf7f00]">
                                                {item.quantity}x
                                            </div>
                                            <span className="text-lg font-bold text-slate-800">{item.name}</span>
                                        </div>
                                        <span className="font-black text-slate-800">{(item.basePrice * item.quantity).toFixed(2)} €</span>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-9 space-y-4 border-t border-dashed pt-6">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Totale</span>
                                    <span className="text-4xl font-black text-[var(--brand-ink)]">{totalPrice.toFixed(2)} €</span>
                                </div>

                                <Button
                                    className="brand-cta-primary h-16 w-full justify-between rounded-2xl px-6 text-lg font-black shadow-none hover:brightness-105"
                                    onClick={() => {
                                        localStorage.setItem("osg_cart", JSON.stringify(cart));
                                        localStorage.setItem("osg_eventId", activeEvent?._id || "");
                                        router.push("/menu/checkout");
                                    }}
                                >
                                    PROSEGUI
                                    <ArrowRight />
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
