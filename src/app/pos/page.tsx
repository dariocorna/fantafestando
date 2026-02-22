"use client"

import { useState, useEffect } from "react"
import { ShoppingCart, User, CreditCard, Banknote, Trash2, CheckCircle2, Loader2, Hash, Monitor, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NumPad } from "./components/NumPad"
import { createOrder, triggerSumUpPayment, loadPendingOrderByCode, completePendingOrderPayment } from "./actions"

interface ICategory {
    _id: string
    name: string
}

interface IProduct {
    _id: string
    name: string
    basePrice: number
    categoryId: string
}

interface IEvent {
    _id: string
    name: string
    settings?: {
        askTable?: boolean
        askName?: boolean
    }
}

interface IPeripheralRef {
    _id: string
    name: string
    type: "SUMUP" | "CASH_BOX" | "OTHER"
}

interface IPosDevice {
    _id: string
    name: string
    printerId?: string | { _id: string; name: string; ip: string }
    paymentTerminalId?: string | IPeripheralRef
    cashBoxId?: string | IPeripheralRef
}

interface CartItem {
    productId: string
    name: string
    price: number
    quantity: number
    variants: string[]
}

interface LoadedPendingOrder {
    id: string
    code: string
    totalAmount: number
    customer?: {
        name?: string
        table?: string
    }
    items: Array<{
        snapshotName: string
        quantity: number
    }>
}

function getPeripheralRef(value: IPosDevice["paymentTerminalId"] | IPosDevice["cashBoxId"]) {
    if (!value || typeof value !== "object") return null
    return value
}

export default function PosPage() {
    const [activeCategory, setActiveCategory] = useState<string | null>(null)
    const [cart, setCart] = useState<CartItem[]>([])
    const [categories, setCategories] = useState<ICategory[]>([])
    const [products, setProducts] = useState<IProduct[]>([])
    const [activeEvent, setActiveEvent] = useState<IEvent | null>(null)
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD">("CASH")
    const [posDevices, setPosDevices] = useState<IPosDevice[]>([])
    const [selectedPosDeviceId, setSelectedPosDeviceId] = useState<string | null>(null)
    const [isPosSelectorOpen, setIsPosSelectorOpen] = useState(false)

    const [isCodeDialogOpen, setIsCodeDialogOpen] = useState(false)
    const [orderCode, setOrderCode] = useState("")
    const [isCodeLoading, setIsCodeLoading] = useState(false)
    const [loadedPendingOrder, setLoadedPendingOrder] = useState<LoadedPendingOrder | null>(null)

    // Info Cliente
    const [customerName, setCustomerName] = useState("")
    const [tableNumber, setTableNumber] = useState("")

    // Caricamento iniziale: evento attivo e menu
    useEffect(() => {
        const loadInitialData = async () => {
            const res = await fetch('/api/pos/init')
            const data = await res.json()
            if (data.event) {
                setActiveEvent(data.event)
                setCategories(data.categories)
                setProducts(data.products)
                setPosDevices(data.posDevices)
                if (data.categories.length > 0) setActiveCategory(data.categories[0]._id)

                // Check localStorage for POS Device
                const savedPosId = localStorage.getItem('osgfest_pos_id')
                const isSavedPosValid = savedPosId && data.posDevices.some((d: IPosDevice) => d._id === savedPosId)
                if (isSavedPosValid) {
                    setSelectedPosDeviceId(savedPosId)
                } else {
                    setIsPosSelectorOpen(true)
                }
            }
        }
        loadInitialData()
    }, [])

    const selectPosDevice = (id: string) => {
        setSelectedPosDeviceId(id)
        localStorage.setItem('osgfest_pos_id', id)
        setIsPosSelectorOpen(false)
    }

    const selectedPosDevice = posDevices.find((d: IPosDevice) => d._id === selectedPosDeviceId)
    const selectedPaymentTerminal = getPeripheralRef(selectedPosDevice?.paymentTerminalId)
    const selectedCashBox = getPeripheralRef(selectedPosDevice?.cashBoxId)

    const cashAvailable = Boolean(selectedCashBox)
    const cardAvailable = Boolean(selectedPaymentTerminal)

    const effectivePaymentMethod: "CASH" | "CARD" =
        paymentMethod === "CASH" && !cashAvailable && cardAvailable
            ? "CARD"
            : paymentMethod === "CARD" && !cardAvailable && cashAvailable
                ? "CASH"
                : paymentMethod

    const total = cart.reduce((acc: number, item: CartItem) => acc + (item.price * item.quantity), 0)
    const effectiveTotal = loadedPendingOrder ? loadedPendingOrder.totalAmount : total

    const addToCart = (product: IProduct) => {
        if (loadedPendingOrder) {
            alert("Hai già caricato un ordine da codice. Completa o annulla quell'ordine prima di aggiungerne uno nuovo.")
            return
        }

        setCart((prev: CartItem[]) => {
            const existing = prev.find((i: CartItem) => i.productId === product._id)
            if (existing) {
                return prev.map((i: CartItem) => i.productId === product._id ? { ...i, quantity: i.quantity + 1 } : i)
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
        setCart((prev: CartItem[]) => prev.filter((i: CartItem) => i.productId !== productId))
    }

    const resetPendingOrder = () => {
        setLoadedPendingOrder(null)
        setOrderCode("")
    }

    const handleLoadOrderByCode = async () => {
        if (!activeEvent?._id) {
            alert("Evento non disponibile")
            return
        }

        setIsCodeLoading(true)
        const result = await loadPendingOrderByCode({
            eventId: activeEvent._id,
            code: orderCode
        })
        setIsCodeLoading(false)

        if (!result.success || !result.order) {
            alert(result.error || "Ordine non trovato")
            return
        }

        setLoadedPendingOrder(result.order)
        setCustomerName(result.order.customer?.name || "")
        setTableNumber(result.order.customer?.table || "")
        setCart([])
        setIsCodeDialogOpen(false)
    }

    const handleCheckout = async () => {
        if (!activeEvent?._id) {
            alert("Evento non disponibile")
            return
        }

        if (!selectedPosDeviceId) {
            alert("Seleziona prima una cassa")
            return
        }

        if (!cashAvailable && !cardAvailable) {
            alert("La cassa selezionata non ha metodi di pagamento configurati")
            return
        }

        if (effectivePaymentMethod === "CASH" && !cashAvailable) {
            alert("La cassa selezionata non supporta i pagamenti contanti")
            return
        }

        if (effectivePaymentMethod === "CARD" && !cardAvailable) {
            alert("La cassa selezionata non supporta i pagamenti elettronici")
            return
        }

        setIsProcessing(true)

        if (loadedPendingOrder) {
            const completionResult = await completePendingOrderPayment({
                eventId: activeEvent._id,
                orderId: loadedPendingOrder.id,
                paymentMethod: effectivePaymentMethod,
                posDeviceId: selectedPosDeviceId
            })

            if (completionResult.success) {
                resetPendingOrder()
                setIsCheckoutOpen(false)
                alert("Ordine completato correttamente")
            } else {
                alert("Errore durante la chiusura ordine: " + completionResult.error)
            }

            setIsProcessing(false)
            return
        }

        let sumupCheckoutId: string | undefined = undefined

        if (effectivePaymentMethod === "CARD") {
            // Avvia pagamento su terminale
            const sumupResult = await triggerSumUpPayment(total, activeEvent._id, selectedPosDeviceId)
            if (!sumupResult.success) {
                alert("Errore SumUp: " + sumupResult.error)
                setIsProcessing(false)
                return
            }
            sumupCheckoutId = sumupResult.checkoutId
            // L'ordine verrà creato in stato PENDING e confermato via webhook.
        }

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
                selectedOptions: []
            })),
            paymentMethod: effectivePaymentMethod,
            sumupCheckoutId,
            posDeviceId: selectedPosDeviceId
        }

        const result = await createOrder(orderData)
        if (result.success) {
            setCart([])
            setCustomerName("")
            setTableNumber("")
            setPaymentMethod(cashAvailable ? "CASH" : "CARD")
            setIsCheckoutOpen(false)
        } else {
            alert("Errore durante la creazione dell'ordine: " + result.error)
        }
        setIsProcessing(false)
    }

    const checkoutDisabled = isProcessing
        || !selectedPosDeviceId
        || (!loadedPendingOrder && cart.length === 0)
        || (!cashAvailable && !cardAvailable)
        || (Boolean(activeEvent?.settings?.askTable) && !loadedPendingOrder && !tableNumber)

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950">
            {/* Sinistra: Selezione Prodotti (70%) */}
            <div className="flex flex-col flex-1 h-full border-r bg-white dark:bg-slate-900">
                {/* Tab Categorie */}
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

                {/* Griglia Prodotti */}
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

            {/* Destra: Riepilogo & Carrello (30%) */}
            <div className="w-[400px] h-full flex flex-col bg-slate-50 dark:bg-slate-900 shrink-0 border-l border-slate-200 dark:border-slate-800">
                {/* Info Intestazione */}
                <div className="p-6 border-b bg-white dark:bg-slate-800">
                    <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">
                        {activeEvent?.name || "Cassa Osgfest"}
                    </h2>
                    <button
                        onClick={() => setIsPosSelectorOpen(true)}
                        className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1 mt-1 hover:underline"
                    >
                        <Monitor size={12} />
                        {selectedPosDevice ? `Postazione: ${selectedPosDevice.name}` : "Seleziona Cassa"}
                    </button>
                    <button
                        onClick={() => setIsCodeDialogOpen(true)}
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mt-1 hover:underline"
                    >
                        <Search size={12} />
                        Carica ordine da codice
                    </button>
                    <div className="grid grid-cols-2 gap-2 mt-4">
                        <div className="bg-white dark:bg-slate-700 border p-2 rounded-xl flex items-center gap-2">
                            <User size={18} className="text-slate-400" />
                            <input
                                className="bg-transparent border-none focus:outline-none text-sm font-bold w-full"
                                placeholder="Nome..."
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                            />
                        </div>
                        <div className="bg-white dark:bg-slate-700 border p-2 rounded-xl flex items-center gap-2">
                            <Hash size={18} className="text-slate-400" />
                            <span className="text-sm font-bold truncate">
                                {tableNumber ? `Tavolo ${tableNumber}` : "Tavolo..."}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Elementi Carrello */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {loadedPendingOrder ? (
                        <div className="p-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <p className="text-xs uppercase font-bold tracking-widest text-indigo-500">Ordine WebApp Caricato</p>
                                    <p className="text-lg font-black text-indigo-700">Codice {loadedPendingOrder.code}</p>
                                </div>
                                <button
                                    className="text-indigo-500 hover:text-indigo-700"
                                    onClick={resetPendingOrder}
                                    title="Rimuovi ordine caricato"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="space-y-2">
                                {loadedPendingOrder.items.map((item, index) => (
                                    <div key={`${item.snapshotName}-${index}`} className="flex justify-between text-sm font-semibold text-slate-700">
                                        <span>{item.quantity}x {item.snapshotName}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="text-right text-lg font-black text-indigo-700">
                                {loadedPendingOrder.totalAmount.toFixed(2)} €
                            </div>
                        </div>
                    ) : cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-50 space-y-4">
                            <ShoppingCart size={64} />
                            <p className="font-bold">Il carrello è vuoto</p>
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

                {/* Footer / Pulsante Pagamento */}
                <div className="p-6 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 space-y-4">
                    <div className="flex justify-between items-center mb-2 px-2">
                        <span className="text-sm text-slate-500 font-bold uppercase tracking-widest">Totale da Pagare</span>
                        <span className="text-4xl font-black text-blue-600 dark:text-blue-400 leading-none">{effectiveTotal.toFixed(2)} €</span>
                    </div>

                    <button
                        onClick={() => setIsCheckoutOpen(true)}
                        disabled={(!loadedPendingOrder && cart.length === 0) || !selectedPosDeviceId}
                        className="w-full py-8 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-3xl font-black text-2xl shadow-xl shadow-blue-200 dark:shadow-none active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                    >
                        <CheckCircle2 size={32} />
                        {loadedPendingOrder ? "CHIUDI ORDINE" : "PAGA ORA"}
                    </button>
                </div>
            </div>

            {/* Modal di Checkout */}
            <Dialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen}>
                <DialogContent className="max-w-[500px] rounded-3xl p-0 overflow-hidden border-none text-slate-800 dark:text-slate-100">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Checkout ordine POS</DialogTitle>
                    </DialogHeader>
                    <div className="bg-blue-600 p-8 text-white text-center">
                        <span className="text-blue-200 text-sm font-bold uppercase tracking-widest">Importo Dovuto</span>
                        <h2 className="text-6xl font-black mt-2">{effectiveTotal.toFixed(2)} €</h2>
                        {loadedPendingOrder && (
                            <p className="mt-2 text-sm font-semibold text-blue-100">Codice ordine: {loadedPendingOrder.code}</p>
                        )}
                    </div>

                    <div className="p-8 space-y-6">
                        {activeEvent?.settings?.askTable && !loadedPendingOrder && (
                            <div className="space-y-4">
                                <Label className="text-lg font-bold">Numero Tavolo?</Label>
                                <div className="text-center py-4 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                                    <span className="text-5xl font-black text-blue-600">{tableNumber || "---"}</span>
                                </div>
                                <NumPad value={tableNumber} onChange={setTableNumber} />
                            </div>
                        )}

                        <div className="space-y-3">
                            <Label className="text-lg font-bold">Metodo di Pagamento</Label>
                            {(cashAvailable || cardAvailable) ? (
                                <div className="flex gap-3">
                                    {cashAvailable && (
                                        <button
                                            onClick={() => setPaymentMethod("CASH")}
                                            className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${effectivePaymentMethod === "CASH" ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200"}`}
                                        >
                                            <Banknote size={32} />
                                            <span className="font-bold">CONTANTI</span>
                                        </button>
                                    )}
                                    {cardAvailable && (
                                        <button
                                            onClick={() => setPaymentMethod("CARD")}
                                            className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${effectivePaymentMethod === "CARD" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200"}`}
                                        >
                                            <CreditCard size={32} />
                                            <span className="font-bold">CARTA / POS</span>
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                                    La postazione selezionata non ha metodi di pagamento configurati. Associa terminale e/o cassetta in impostazioni hardware.
                                </p>
                            )}
                        </div>

                        <div className="flex gap-4 pt-4">
                            <Button
                                variant="outline"
                                className="flex-1 py-8 text-xl font-bold rounded-2xl"
                                onClick={() => setIsCheckoutOpen(false)}
                            >
                                ANNULLA
                            </Button>
                            <Button
                                className="flex-1 py-8 text-xl font-bold rounded-2xl bg-green-600 hover:bg-green-700"
                                onClick={handleCheckout}
                                disabled={checkoutDisabled}
                            >
                                {isProcessing ? <Loader2 className="animate-spin" /> : (loadedPendingOrder ? "CHIUDI ORDINE" : "CONFERMA")}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Carica Ordine da Codice */}
            <Dialog open={isCodeDialogOpen} onOpenChange={setIsCodeDialogOpen}>
                <DialogContent className="max-w-[400px] rounded-3xl p-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-center">Carica ordine da codice</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <Label htmlFor="order-code" className="text-sm font-bold">Codice ordine (4 caratteri)</Label>
                        <Input
                            id="order-code"
                            value={orderCode}
                            onChange={(e) => setOrderCode(e.target.value.toUpperCase())}
                            placeholder="Es: A1B2"
                            maxLength={8}
                        />
                        <Button
                            className="w-full"
                            onClick={handleLoadOrderByCode}
                            disabled={isCodeLoading || !orderCode.trim()}
                        >
                            {isCodeLoading ? <Loader2 className="animate-spin" /> : "Carica Ordine"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Selezione Punto Cassa */}
            <Dialog open={isPosSelectorOpen} onOpenChange={setIsPosSelectorOpen}>
                <DialogContent className="max-w-[400px] rounded-3xl p-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-center">In quale cassa sei?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {posDevices.length === 0 ? (
                            <p className="text-center text-muted-foreground">Loggati come admin e configura almeno un Punto Cassa nelle impostazioni hardware.</p>
                        ) : (
                            posDevices.map((device) => {
                                const isSelected = device._id === selectedPosDeviceId
                                return (
                                    <button
                                        key={device._id}
                                        onClick={() => selectPosDevice(device._id)}
                                        className={`w-full p-6 rounded-2xl border-2 text-left transition-all flex items-center justify-between group ${isSelected ? 'border-blue-600 bg-blue-50' : 'border-slate-100 hover:border-blue-200'
                                            }`}
                                    >
                                        <div>
                                            <p className="font-black text-lg">{device.name}</p>
                                            <p className="text-sm text-slate-500">Stampante: {typeof device.printerId === 'object' && device.printerId ? device.printerId.name : 'Nessuna'}</p>
                                        </div>
                                        <Monitor className={`transition-colors ${isSelected ? 'text-blue-600' : 'text-slate-300 group-hover:text-blue-400'}`} />
                                    </button>
                                )
                            })
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
