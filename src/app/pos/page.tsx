"use client"

import { useState, useEffect } from "react"
import {
    ShoppingCart,
    User,
    Hash,
    Trash2,
    CheckCircle2,
    Loader2,
    X
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { NumPad } from "./components/NumPad"
import { createOrder } from "./actions"

interface CartItem {
    productId: string
    name: string
    price: number
    quantity: number
    variants: string[]
}

export default function PosPage() {
    const [activeCategory, setActiveCategory] = useState<string | null>(null)
    const [cart, setCart] = useState<CartItem[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [products, setProducts] = useState<any[]>([])
    const [activeEvent, setActiveEvent] = useState<any>(null)
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)

    // Customer Info
    const [customerName, setCustomerName] = useState("")
    const [tableNumber, setTableNumber] = useState("")

    // Initial load: active event and menu
    useEffect(() => {
        const loadInitialData = async () => {
            // Simplified fetch for now, will connect to real API later
            const res = await fetch('/api/pos/init')
            const data = await res.json()
            if (data.event) {
                setActiveEvent(data.event)
                setCategories(data.categories)
                setProducts(data.products)
                if (data.categories.length > 0) setActiveCategory(data.categories[0]._id)
            }
        }
        loadInitialData()
    }, [])

    const total = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0)

    const addToCart = (product: any) => {
        setCart(prev => {
            const existing = prev.find(i => i.productId === product._id)
            if (existing) {
                return prev.map(i => i.productId === product._id ? { ...i, quantity: i.quantity + 1 } : i)
            }
            return [...prev, {
                productId: product._id,
                name: product.name,
                price: product.basePrice,
                quantity: 1,
                variants: []
            }]
        })
    }

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(i => i.productId !== productId))
    }

    const handleCheckout = async () => {
        setIsProcessing(true)
        const orderData = {
            eventId: activeEvent._id,
            customer: {
                name: customerName || undefined,
                table: tableNumber || undefined
            },
            totalAmount: total,
            cart: cart.map(item => ({
                productId: item.productId,
                snapshotName: item.name,
                quantity: item.quantity,
                selectedOptions: [] // TODO: add variants selection
            }))
        }

        const result = await createOrder(orderData)
        if (result.success) {
            setCart([])
            setCustomerName("")
            setTableNumber("")
            setIsCheckoutOpen(false)
        } else {
            alert("Error creating order: " + result.error)
        }
        setIsProcessing(false)
    }

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950">
            {/* Left: Product Selection (70%) */}
            <div className="flex flex-col flex-1 h-full border-r bg-white dark:bg-slate-900">
                {/* Category Tabs */}
                <div className="flex overflow-x-auto gap-2 p-4 bg-slate-50 dark:bg-slate-800 border-b scrollbar-hide shrink-0">
                    {categories.map(cat => (
                        <button
                            key={cat._id}
                            onClick={() => setActiveCategory(cat._id)}
                            className={`px-8 py-6 rounded-xl font-bold text-lg whitespace-nowrap transition-all shadow-sm ${activeCategory === cat._id
                                ? 'bg-blue-600 text-white scale-105 ring-4 ring-blue-200'
                                : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200'}`}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>

                {/* Product Grid */}
                <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 content-start text-slate-800 dark:text-slate-100">
                    {products
                        .filter(p => p.categoryId === activeCategory)
                        .map(p => (
                            <button
                                key={p._id}
                                onClick={() => addToCart(p)}
                                className="flex flex-col h-40 p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md active:scale-95 transition-all text-left"
                            >
                                <span className="font-bold text-lg leading-tight mb-2 line-clamp-2">{p.name}</span>
                                <span className="mt-auto text-blue-600 dark:text-blue-400 font-black text-xl">{p.basePrice.toFixed(2)} €</span>
                            </button>
                        ))
                    }
                </div>
            </div>

            {/* Right: Summary & Cart (30%) */}
            <div className="w-[400px] h-full flex flex-col bg-slate-50 dark:bg-slate-900 shrink-0 border-l border-slate-200 dark:border-slate-800">
                {/* Header Info */}
                <div className="p-6 border-b bg-white dark:bg-slate-800">
                    <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">Current Order</h2>
                    <div className="grid grid-cols-2 gap-2 mt-4">
                        {(activeEvent?.settings?.askName || true) && (
                            <div className="bg-white dark:bg-slate-700 border p-2 rounded-xl flex items-center gap-2">
                                <User size={18} className="text-slate-400" />
                                <input
                                    className="bg-transparent border-none focus:outline-none text-sm font-bold w-full"
                                    placeholder="Name..."
                                    value={customerName}
                                    onChange={(e) => setCustomerName(e.target.value)}
                                />
                            </div>
                        )}
                        {(activeEvent?.settings?.askTable || true) && (
                            <div className="bg-white dark:bg-slate-700 border p-2 rounded-xl flex items-center gap-2">
                                <Hash size={18} className="text-slate-400" />
                                <span className="text-sm font-bold truncate">
                                    {tableNumber ? `Table ${tableNumber}` : "Table..."}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-50 space-y-4">
                            <ShoppingCart size={64} />
                            <p className="font-bold">Cart is empty</p>
                        </div>
                    ) : (
                        cart.map((item) => (
                            <div key={item.productId} className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm border">
                                <div className="flex flex-col">
                                    <span className="font-bold text-slate-800 dark:text-slate-100">{item.name}</span>
                                    <span className="text-sm text-slate-500">{item.quantity} x {item.price.toFixed(2)} €</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-black">{(item.quantity * item.price).toFixed(2)} €</span>
                                    <button onClick={() => removeFromCart(item.productId)} className="text-red-500 p-2">
                                        <Trash2 size={20} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer / Checkout Button */}
                <div className="p-6 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 space-y-4">
                    <div className="flex justify-between items-center mb-2 px-2">
                        <span className="text-sm text-slate-500 font-bold uppercase tracking-widest">Total to Pay</span>
                        <span className="text-4xl font-black text-blue-600 dark:text-blue-400 leading-none">{total.toFixed(2)} €</span>
                    </div>

                    <button
                        onClick={() => setIsCheckoutOpen(true)}
                        disabled={cart.length === 0}
                        className="w-full py-8 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-3xl font-black text-2xl shadow-xl shadow-blue-200 dark:shadow-none active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                    >
                        <CheckCircle2 size={32} />
                        PAY NOW
                    </button>
                </div>
            </div>

            {/* Checkout Modal */}
            <Dialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen}>
                <DialogContent className="max-w-[500px] rounded-3xl p-0 overflow-hidden border-none text-slate-800 dark:text-slate-100">
                    <div className="bg-blue-600 p-8 text-white text-center">
                        <span className="text-blue-200 text-sm font-bold uppercase tracking-widest">Amount Due</span>
                        <h2 className="text-6xl font-black mt-2">{total.toFixed(2)} €</h2>
                    </div>

                    <div className="p-8 space-y-6">
                        {(activeEvent?.settings?.askTable || true) && (
                            <div className="space-y-4">
                                <Label className="text-lg font-bold">Which Table?</Label>
                                <div className="text-center py-4 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                                    <span className="text-5xl font-black text-blue-600">{tableNumber || "---"}</span>
                                </div>
                                <NumPad value={tableNumber} onChange={setTableNumber} />
                            </div>
                        )}

                        <div className="flex gap-4 pt-4">
                            <Button
                                variant="outline"
                                className="flex-1 py-8 text-xl font-bold rounded-2xl"
                                onClick={() => setIsCheckoutOpen(false)}
                            >
                                CANCEL
                            </Button>
                            <Button
                                className="flex-1 py-8 text-xl font-bold rounded-2xl bg-green-600 hover:bg-green-700"
                                onClick={handleCheckout}
                                disabled={isProcessing || (activeEvent?.settings?.askTable && !tableNumber)}
                            >
                                {isProcessing ? <Loader2 className="animate-spin" /> : "COMPLETE"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
