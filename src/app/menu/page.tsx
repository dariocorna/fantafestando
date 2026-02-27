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
import Image from "next/image"

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

export default function CustomerMenu() {
    const [categories, setCategories] = useState<Category[]>([])
    const [products, setProducts] = useState<Product[]>([])
    const [activeEvent, setActiveEvent] = useState<{ _id: string; name: string } | null>(null)
    const [activeTab, setActiveTab] = useState("")
    const [cart, setCart] = useState<CartItem[]>([])
    const [isCartOpen, setIsCartOpen] = useState(false)
    const router = useRouter()

    useEffect(() => {
        const fetchData = async () => {
            const res = await fetch('/api/pos/init')
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
        <div className="min-h-screen bg-gradient-to-b from-[#dbeafe] via-[#eef4fb] to-[#f8fafc] pb-32">
            {/* Header / Hero */}
            <div className="sticky top-0 z-40 border-b border-sky-100 bg-white/90 px-4 pb-5 pt-4 shadow-sm backdrop-blur md:px-6">
                <div className="mx-auto max-w-2xl">
                    <div className="mb-4 rounded-3xl border border-sky-100 bg-gradient-to-r from-white to-[#eef7ff] p-3 shadow-sm">
                        <div className="flex items-center gap-3">
                            <Image
                                src="/icons/icon-96x96.png"
                                alt="Logo Oratorio in Festa"
                                width={56}
                                height={56}
                                className="h-14 w-14 rounded-2xl bg-white p-1 shadow-sm"
                                priority
                            />
                            <div className="min-w-0">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#1e5fb8]">
                                    Oratorio in Festa
                                </p>
                                <h1 className="truncate text-xl font-black tracking-tight text-[#184f9e] md:text-2xl">
                                    {activeEvent?.name || "Menu OSGFest"}
                                </h1>
                                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-[#2f6bb5] md:text-sm">
                                    <Info size={14} /> Tocca i prodotti per aggiungerli
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Horizontal Category Scroller */}
                    <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 md:-mx-6 md:px-6">
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
                                className="px-6 py-2 rounded-full font-bold text-sm whitespace-nowrap transition-all border"
                                style={isActive
                                    ? {
                                        backgroundColor: catTheme.base,
                                        color: catTheme.onBase,
                                        borderColor: catTheme.base,
                                        boxShadow: `0 10px 24px ${catTheme.shadow}`
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

            {/* Menu Sections */}
            <div className="max-w-2xl mx-auto p-4 space-y-12 mt-6">
                {categories.map(cat => {
                    const catTheme = getCategoryTheme(cat.uiColor)

                    return (
                        <section key={cat._id} id={cat._id} className="space-y-4">
                            <h2 className="text-xl font-black text-slate-800 px-2 uppercase tracking-widest flex items-center gap-2">
                                <span className="w-2 h-8 rounded-full" style={{ backgroundColor: catTheme.base }}></span>
                                {cat.name}
                            </h2>
                            <div className="grid gap-4">
                                {products
                                    .filter(p => p.categoryId === cat._id)
                                    .map(product => {
                                        const cartQuantity = cart.find(i => i._id === product._id)?.quantity || 0
                                        return (
                                            <div
                                                key={product._id}
                                                className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex justify-between items-center active:scale-[0.98] transition-transform"
                                            >
                                                <div className="flex-1">
                                                    <h3 className="font-bold text-lg text-slate-800">{product.name}</h3>
                                                    <p className="text-slate-500 text-sm line-clamp-2 mt-1 pr-4">
                                                        {product.description || "Delizioso piatto tipico preparato con ingredienti freschi."}
                                                    </p>
                                                    <div className="mt-3 font-black text-lg" style={{ color: catTheme.base }}>
                                                        {product.basePrice.toFixed(2)} €
                                                    </div>
                                                </div>

                                                <div className="flex flex-col items-center gap-2">
                                                    {cartQuantity > 0 ? (
                                                        <div className="flex items-center bg-slate-100 rounded-full p-1 gap-2">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); removeFromCart(product._id); }}
                                                                className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm"
                                                                style={{ color: catTheme.base }}
                                                            >
                                                                <Minus size={18} />
                                                            </button>
                                                            <span className="font-black text-slate-800 w-4 text-center">{cartQuantity}</span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); addToCart(product); }}
                                                                className="w-8 h-8 rounded-full flex items-center justify-center shadow-md"
                                                                style={{
                                                                    backgroundColor: catTheme.base,
                                                                    color: catTheme.onBase,
                                                                    boxShadow: `0 6px 14px ${catTheme.shadow}`
                                                                }}
                                                            >
                                                                <Plus size={18} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => addToCart(product)}
                                                            className="w-12 h-12 rounded-2xl border flex items-center justify-center transition-colors"
                                                            style={{
                                                                backgroundColor: catTheme.softBg,
                                                                color: catTheme.base,
                                                                borderColor: catTheme.border
                                                            }}
                                                        >
                                                            <Plus size={24} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })
                                }
                            </div>
                        </section>
                    )
                })}
            </div>

            {/* Sticky Basket Bar */}
            <AnimatePresence>
                {cart.length > 0 && (
                    <motion.div
                        initial={{ y: 100 }}
                        animate={{ y: 0 }}
                        exit={{ y: 100 }}
                        className="fixed bottom-0 left-0 right-0 p-6 z-50 pointer-events-none"
                    >
                        <button
                            onClick={() => setIsCartOpen(true)}
                            className="w-full max-w-lg mx-auto bg-gradient-to-r from-[#1e5fb8] to-[#249fe8] p-4 rounded-3xl shadow-xl shadow-blue-200 text-white flex items-center justify-between pointer-events-auto active:scale-95 transition-transform"
                        >
                            <div className="flex items-center gap-3">
                                <div className="bg-white/20 w-10 h-10 rounded-2xl flex items-center justify-center font-black">
                                    {totalItems}
                                </div>
                                <span className="font-black text-lg">Vedi Carrello</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="font-black text-xl">{totalPrice.toFixed(2)} €</span>
                                <ArrowRight size={24} />
                            </div>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Cart Drawer Placeholder */}
            <AnimatePresence>
                {isCartOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 z-[60] p-4 flex items-end justify-center"
                    >
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            className="bg-white w-full max-w-lg rounded-[40px] p-8 max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex justify-between items-center mb-8">
                                <h2 className="text-3xl font-black text-slate-800">Il Tuo Ordine</h2>
                                <button onClick={() => setIsCartOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-400">
                                    <X size={24} />
                                </button>
                            </div>

                            <div className="space-y-6">
                                {cart.map(item => (
                                    <div key={item._id} className="flex justify-between items-center">
                                        <div className="flex items-center gap-4">
                                            <div className="bg-[#fff4cc] text-[#bf7f00] w-8 h-8 rounded-lg flex items-center justify-center font-black">
                                                {item.quantity}x
                                            </div>
                                            <span className="font-bold text-lg text-slate-800">{item.name}</span>
                                        </div>
                                        <span className="font-black text-slate-800">{(item.basePrice * item.quantity).toFixed(2)} €</span>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-12 pt-8 border-t border-dashed space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-400 font-bold uppercase tracking-widest">Totale</span>
                                    <span className="text-4xl font-black text-slate-800">{totalPrice.toFixed(2)} €</span>
                                </div>

                                <Button
                                    className="w-full h-20 rounded-3xl bg-slate-900 text-white font-black text-xl hover:bg-slate-800 flex items-center justify-between px-8"
                                    onClick={() => {
                                        localStorage.setItem("osg_cart", JSON.stringify(cart));
                                        localStorage.setItem("osg_eventId", activeEvent?._id || "");
                                        router.push("/menu/checkout");
                                    }}
                                >
                                    PROSEGUI
                                    <div className="bg-white/20 p-2 rounded-xl">
                                        <ArrowRight />
                                    </div>
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
