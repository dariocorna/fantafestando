"use client"

import { useState, useEffect } from "react"
import { ShoppingCart, User, CreditCard, Banknote, Trash2, CheckCircle2, Loader2, Hash, Monitor, Search, X, RefreshCw, Clock3, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    createOrder,
    loadPendingOrderByCode,
    completePendingOrderPayment,
    listRecentPendingOrders,
    getCashSessionStatus,
    openCashSession,
    closeCashSession
} from "./actions"
import { getCategoryTheme } from "@/lib/category-colors"
import { isTableValueValid, normalizeTableValue } from "@/lib/table-presets"
import { getStockLabel, getStockStatus, type StockShortage } from "@/lib/inventory"

interface ICategory {
    _id: string
    name: string
    uiColor?: string
}

interface IProduct {
    _id: string
    name: string
    basePrice: number
    categoryId: string
    stockQuantity?: number | null
    isSoldOut?: boolean
    stockStatus?: "UNLIMITED" | "OK" | "LOW" | "OUT"
}

interface IEvent {
    _id: string
    name: string
    settings?: {
        askTable?: boolean
        askName?: boolean
    }
    predefinedTables?: string[]
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
        productId: string
        snapshotName: string
        quantity: number
        unitPrice: number
    }>
}

interface RecentPendingOrder {
    id: string
    code: string
    totalAmount: number
    customer?: {
        name?: string
        table?: string
    }
    createdAt?: string
}

interface OpenCashSessionState {
    id: string
    openedAt: string
    openingFloatAmount: number
    openingNotes?: string
}

interface ClosedCashSessionSummaryState {
    sessionId: string
    openingFloatAmount: number
    closingCountedCashAmount: number
    paidOrdersCount: number
    cashSalesAmount: number
    cardSalesAmount: number
    otherSalesAmount: number
    expectedCashAmount: number
    varianceAmount: number
    closedAt: string
}

interface FeedbackModalState {
    open: boolean
    tone: "error" | "success" | "info"
    title: string
    message: string
}

function getPeripheralRef(value: IPosDevice["paymentTerminalId"] | IPosDevice["cashBoxId"]) {
    if (!value || typeof value !== "object") return null
    return value
}

const MOCK_PRINT_STEPS: Array<{ progress: number, label: string, delayMs: number }> = [
    { progress: 18, label: "Preparazione comanda...", delayMs: 220 },
    { progress: 44, label: "Invio alla stampante...", delayMs: 320 },
    { progress: 72, label: "Stampa in corso...", delayMs: 360 },
    { progress: 100, label: "Stampa completata", delayMs: 260 }
]

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export default function PosPage() {
    const [activeCategory, setActiveCategory] = useState<string | null>(null)
    const [cart, setCart] = useState<CartItem[]>([])
    const [categories, setCategories] = useState<ICategory[]>([])
    const [products, setProducts] = useState<IProduct[]>([])
    const [activeEvent, setActiveEvent] = useState<IEvent | null>(null)
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [isPrintMockActive, setIsPrintMockActive] = useState(false)
    const [printProgress, setPrintProgress] = useState(0)
    const [printStatusLabel, setPrintStatusLabel] = useState("Preparazione comanda...")
    const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD">("CASH")
    const [posDevices, setPosDevices] = useState<IPosDevice[]>([])
    const [selectedPosDeviceId, setSelectedPosDeviceId] = useState<string | null>(null)
    const [isPosSelectorOpen, setIsPosSelectorOpen] = useState(false)

    const [isCodeDialogOpen, setIsCodeDialogOpen] = useState(false)
    const [orderCode, setOrderCode] = useState("")
    const [isCodeLoading, setIsCodeLoading] = useState(false)
    const [loadedPendingOrder, setLoadedPendingOrder] = useState<LoadedPendingOrder | null>(null)
    const [recentPendingOrders, setRecentPendingOrders] = useState<RecentPendingOrder[]>([])
    const [isRecentOrdersLoading, setIsRecentOrdersLoading] = useState(false)
    const [stockShortages, setStockShortages] = useState<StockShortage[]>([])
    const [cashSession, setCashSession] = useState<OpenCashSessionState | null>(null)
    const [isCashSessionLoading, setIsCashSessionLoading] = useState(false)
    const [isCashSessionActionLoading, setIsCashSessionActionLoading] = useState(false)
    const [isOpenCashDialogOpen, setIsOpenCashDialogOpen] = useState(false)
    const [isCloseCashDialogOpen, setIsCloseCashDialogOpen] = useState(false)
    const [openingFloatAmountInput, setOpeningFloatAmountInput] = useState("")
    const [openingNotes, setOpeningNotes] = useState("")
    const [closingCountedCashAmountInput, setClosingCountedCashAmountInput] = useState("")
    const [closingNotes, setClosingNotes] = useState("")
    const [lastClosedSummary, setLastClosedSummary] = useState<ClosedCashSessionSummaryState | null>(null)
    const [feedbackModal, setFeedbackModal] = useState<FeedbackModalState>({
        open: false,
        tone: "info",
        title: "",
        message: ""
    })

    // Info Cliente
    const [customerName, setCustomerName] = useState("")
    const [tableNumber, setTableNumber] = useState("")

    const loadCashSessionStatusFor = async (eventId: string, posDeviceId: string) => {
        setIsCashSessionLoading(true)
        const result = await getCashSessionStatus({ eventId, posDeviceId })
        if (result.success) {
            setCashSession(result.session)
        } else {
            setCashSession(null)
        }
        setIsCashSessionLoading(false)
    }

    // Caricamento iniziale: evento attivo e menu
    useEffect(() => {
        const loadInitialData = async () => {
            const res = await fetch('/api/pos/init?channel=pos')
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
                    await loadCashSessionStatusFor(data.event._id, savedPosId)
                } else {
                    setCashSession(null)
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
        setLastClosedSummary(null)
        if (activeEventId) {
            void loadCashSessionStatusFor(activeEventId, id)
        }
    }

    const selectedPosDevice = posDevices.find((d: IPosDevice) => d._id === selectedPosDeviceId)
    const selectedPaymentTerminal = getPeripheralRef(selectedPosDevice?.paymentTerminalId)
    const selectedCashBox = getPeripheralRef(selectedPosDevice?.cashBoxId)
    const activeCategoryTheme = getCategoryTheme(categories.find((c) => c._id === activeCategory)?.uiColor)
    const activeEventId = activeEvent?._id

    const cashAvailable = Boolean(selectedCashBox)
    const cardAvailable = Boolean(selectedPaymentTerminal)

    const effectivePaymentMethod: "CASH" | "CARD" =
        paymentMethod === "CASH" && !cashAvailable && cardAvailable
            ? "CARD"
            : paymentMethod === "CARD" && !cardAvailable && cashAvailable
                ? "CASH"
                : paymentMethod

    const total = cart.reduce((acc: number, item: CartItem) => acc + (item.price * item.quantity), 0)
    const effectiveTotal = total
    const normalizedTableValue = normalizeTableValue(tableNumber)
    const tableValueValid = isTableValueValid(tableNumber)
    const predefinedTables = activeEvent?.predefinedTables || []

    const addToCart = (product: IProduct) => {
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

    const resetCheckoutForm = () => {
        setCart([])
        setCustomerName("")
        setTableNumber("")
        setPaymentMethod(cashAvailable ? "CASH" : "CARD")
    }

    const loadRecentPendingOrdersForDialog = async () => {
        if (!activeEventId) return

        setIsRecentOrdersLoading(true)
        const result = await listRecentPendingOrders({ eventId: activeEventId, limit: 10 })
        if (result.success) {
            setRecentPendingOrders(result.orders)
        } else {
            setRecentPendingOrders([])
        }
        setIsRecentOrdersLoading(false)
    }

    const formatRecentOrderTime = (createdAt?: string) => {
        if (!createdAt) return ""
        return new Intl.DateTimeFormat("it-IT", {
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(createdAt))
    }

    const formatEuro = (value: number) => `${value.toFixed(2)} €`
    const formatSessionDateTime = (value?: string) => {
        if (!value) return "-"
        return new Intl.DateTimeFormat("it-IT", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(value))
    }

    const parseAmountInput = (rawValue: string): number | null => {
        const normalized = rawValue.trim().replace(",", ".")
        if (!normalized) return 0
        const parsed = Number(normalized)
        if (!Number.isFinite(parsed) || parsed < 0) return null
        return Number(parsed.toFixed(2))
    }

    const showFeedbackModal = (
        message: string,
        tone: FeedbackModalState["tone"] = "error",
        title?: string
    ) => {
        const fallbackTitle =
            tone === "success"
                ? "Operazione completata"
                : tone === "error"
                    ? "Attenzione"
                    : "Informazione"

        setFeedbackModal({
            open: true,
            tone,
            title: title || fallbackTitle,
            message
        })
    }

    const handleCodeDialogOpenChange = (open: boolean) => {
        setIsCodeDialogOpen(open)
        if (open) {
            void loadRecentPendingOrdersForDialog()
        }
    }

    const handleOpenCashSession = async () => {
        if (!activeEventId || !selectedPosDeviceId) {
            showFeedbackModal("Seleziona prima una cassa")
            return
        }

        const openingFloatAmount = parseAmountInput(openingFloatAmountInput)
        if (openingFloatAmount === null) {
            showFeedbackModal("Inserisci un fondo cassa valido (>= 0)")
            return
        }

        setIsCashSessionActionLoading(true)
        const result = await openCashSession({
            eventId: activeEventId,
            posDeviceId: selectedPosDeviceId,
            openingFloatAmount,
            openingNotes
        })
        setIsCashSessionActionLoading(false)

        if (!result.success) {
            showFeedbackModal(result.error || "Errore durante apertura cassa")
            return
        }

        setCashSession(result.session)
        setOpeningFloatAmountInput("")
        setOpeningNotes("")
        setLastClosedSummary(null)
        setIsOpenCashDialogOpen(false)
    }

    const handleCloseCashSession = async () => {
        if (!activeEventId || !selectedPosDeviceId) {
            showFeedbackModal("Seleziona prima una cassa")
            return
        }

        if (!cashSession) {
            showFeedbackModal("Nessuna sessione cassa aperta")
            return
        }

        const closingCountedCashAmount = parseAmountInput(closingCountedCashAmountInput)
        if (closingCountedCashAmount === null) {
            showFeedbackModal("Inserisci il contante contato in formato valido")
            return
        }

        setIsCashSessionActionLoading(true)
        const result = await closeCashSession({
            eventId: activeEventId,
            posDeviceId: selectedPosDeviceId,
            closingCountedCashAmount,
            closingNotes
        })
        setIsCashSessionActionLoading(false)

        if (!result.success) {
            showFeedbackModal(result.error || "Errore durante chiusura cassa")
            return
        }

        setCashSession(null)
        setClosingCountedCashAmountInput("")
        setClosingNotes("")
        setLastClosedSummary(result.summary)
        setIsCloseCashDialogOpen(false)
    }

    const handleCheckoutDialogOpenChange = (open: boolean) => {
        if (isProcessing || isPrintMockActive) return
        setIsCheckoutOpen(open)
        if (!open) {
            setStockShortages([])
        }
    }

    const runMockPrintFlow = async () => {
        setIsPrintMockActive(true)
        setPrintProgress(0)
        setPrintStatusLabel("Preparazione comanda...")

        for (const step of MOCK_PRINT_STEPS) {
            await wait(step.delayMs)
            setPrintProgress(step.progress)
            setPrintStatusLabel(step.label)
        }

        await wait(220)
        setIsPrintMockActive(false)
        setPrintProgress(0)
        setPrintStatusLabel("Preparazione comanda...")
    }

    const clearTableSelection = () => {
        setTableNumber("")
    }

    const handleLoadOrderByCode = async (rawCode?: string) => {
        if (!activeEvent?._id) {
            showFeedbackModal("Evento non disponibile")
            return
        }

        const codeToLoad = (rawCode ?? orderCode).trim().toUpperCase()
        if (!codeToLoad) {
            showFeedbackModal("Inserisci un numero ordine valido")
            return
        }

        setOrderCode(codeToLoad)
        setIsCodeLoading(true)
        const result = await loadPendingOrderByCode({
            eventId: activeEvent._id,
            code: codeToLoad
        })
        setIsCodeLoading(false)

        if (!result.success || !result.order) {
            showFeedbackModal(result.error || "Ordine non trovato")
            return
        }

        setLoadedPendingOrder(result.order)
        setCustomerName(result.order.customer?.name || "")
        setTableNumber(normalizeTableValue(result.order.customer?.table || ""))
        setCart(result.order.items.map((item) => ({
            productId: item.productId,
            name: item.snapshotName,
            price: item.unitPrice,
            quantity: item.quantity,
            variants: []
        })))
        setRecentPendingOrders((prev) => prev.filter((order) => order.id !== result.order?.id))
        setIsCodeDialogOpen(false)
    }

    const handleCheckout = async (allowStockOverride = false) => {
        if (!activeEvent?._id) {
            showFeedbackModal("Evento non disponibile")
            return
        }

        if (!selectedPosDeviceId) {
            showFeedbackModal("Seleziona prima una cassa")
            return
        }

        if (!cashSession) {
            showFeedbackModal("Cassa chiusa. Apri una sessione cassa prima di incassare.")
            return
        }

        if (!cashAvailable && !cardAvailable) {
            showFeedbackModal("La cassa selezionata non ha metodi di pagamento configurati")
            return
        }

        if (effectivePaymentMethod === "CASH" && !cashAvailable) {
            showFeedbackModal("La cassa selezionata non supporta i pagamenti contanti")
            return
        }

        if (effectivePaymentMethod === "CARD" && !cardAvailable) {
            showFeedbackModal("La cassa selezionata non supporta i pagamenti elettronici")
            return
        }

        if (activeEvent?.settings?.askTable && !tableValueValid) {
            showFeedbackModal("Inserisci il tavolo oppure selezionalo dalla lista")
            return
        }

        setIsProcessing(true)

        if (loadedPendingOrder) {
            const completedPendingOrderId = loadedPendingOrder.id
            const completionResult = await completePendingOrderPayment({
                eventId: activeEvent._id,
                orderId: loadedPendingOrder.id,
                paymentMethod: effectivePaymentMethod,
                posDeviceId: selectedPosDeviceId,
                allowStockOverride,
                customer: {
                    name: customerName || undefined,
                    table: normalizedTableValue || undefined
                },
                totalAmount: total,
                cart: cart.map((item) => ({
                    productId: item.productId,
                    snapshotName: item.name,
                    quantity: item.quantity,
                    selectedOptions: []
                }))
            })

            if (completionResult.success) {
                await runMockPrintFlow()
                setRecentPendingOrders((prev) => prev.filter((order) => order.id !== completedPendingOrderId))
                resetCheckoutForm()
                resetPendingOrder()
                setIsCheckoutOpen(false)
                setStockShortages([])
                showFeedbackModal(
                    "Ordine completato correttamente",
                    "success",
                    "Pagamento registrato"
                )
            } else {
                if (completionResult.stockShortages?.length) {
                    setStockShortages(completionResult.stockShortages)
                } else if (completionResult.cashSessionRequired) {
                    setIsCheckoutOpen(false)
                    setCashSession(null)
                    setIsOpenCashDialogOpen(true)
                } else {
                    showFeedbackModal(`Errore durante la chiusura ordine: ${completionResult.error}`)
                }
            }

            setIsProcessing(false)
            return
        }

        const orderData = {
            eventId: activeEvent._id,
            customer: {
                name: customerName || undefined,
                table: normalizedTableValue || undefined
            },
            totalAmount: total,
            cart: cart.map(item => ({
                productId: item.productId,
                snapshotName: item.name,
                quantity: item.quantity,
                selectedOptions: []
            })),
            paymentMethod: effectivePaymentMethod,
            posDeviceId: selectedPosDeviceId,
            allowStockOverride
        }

        const result = await createOrder(orderData)
        if (result.success) {
            await runMockPrintFlow()
            resetCheckoutForm()
            setIsCheckoutOpen(false)
            setStockShortages([])
        } else {
            if (result.stockShortages?.length) {
                setStockShortages(result.stockShortages)
            } else if (result.cashSessionRequired) {
                setIsCheckoutOpen(false)
                setCashSession(null)
                setIsOpenCashDialogOpen(true)
            } else {
                showFeedbackModal(`Errore durante la creazione dell'ordine: ${result.error}`)
            }
        }
        setIsProcessing(false)
    }

    const checkoutDisabled = isProcessing
        || isCashSessionLoading
        || !selectedPosDeviceId
        || !cashSession
        || cart.length === 0
        || (!cashAvailable && !cardAvailable)
        || (Boolean(activeEvent?.settings?.askTable) && !tableValueValid)

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950">
            {/* Sinistra: Selezione Prodotti (70%) */}
            <div className="flex flex-col flex-1 h-full border-r bg-white dark:bg-slate-900">
                {/* Tab Categorie */}
                <div className="flex overflow-x-auto gap-2 p-4 bg-slate-50 dark:bg-slate-800 border-b scrollbar-hide shrink-0">
                    {categories.map(cat => {
                        const catTheme = getCategoryTheme(cat.uiColor)
                        const isActive = activeCategory === cat._id

                        return (
                            <button
                                key={cat._id}
                                onClick={() => setActiveCategory(cat._id)}
                                className={`px-8 py-6 rounded-xl font-bold text-lg whitespace-nowrap transition-all shadow-sm border ${isActive ? "scale-105" : ""}`}
                                style={isActive
                                    ? {
                                        backgroundColor: catTheme.base,
                                        color: catTheme.onBase,
                                        borderColor: catTheme.base,
                                        boxShadow: `0 0 0 4px ${catTheme.softBg}`
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

                {/* Griglia Prodotti */}
                <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 content-start text-slate-800 dark:text-slate-100">
                    {products
                        .filter(p => p.categoryId === activeCategory)
                        .map(p => {
                            const stockStatus = p.stockStatus || getStockStatus(p.stockQuantity ?? null, Boolean(p.isSoldOut))
                            const stockLabel = getStockLabel(p.stockQuantity ?? null, Boolean(p.isSoldOut))

                            return (
                                <button
                                    key={p._id}
                                    onClick={() => addToCart(p)}
                                    className="flex flex-col h-40 p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md active:scale-95 transition-all text-left"
                                    style={{ borderColor: stockStatus === "OUT" ? "#ef4444" : activeCategoryTheme.border }}
                                >
                                    <span className="font-bold text-lg leading-tight mb-2 line-clamp-2">{p.name}</span>
                                    <span
                                        className={`inline-flex w-fit rounded-full px-2 py-1 text-[10px] font-bold ${stockStatus === "OUT"
                                            ? "bg-red-100 text-red-700"
                                            : stockStatus === "LOW"
                                                ? "bg-amber-100 text-amber-700"
                                                : "bg-slate-100 text-slate-700"
                                            }`}
                                    >
                                        {stockLabel}
                                    </span>
                                    <span className="mt-auto font-black text-xl" style={{ color: activeCategoryTheme.base }}>
                                        {p.basePrice.toFixed(2)} €
                                    </span>
                                </button>
                            )
                        })
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
                        onClick={() => handleCodeDialogOpenChange(true)}
                        className="mt-2 inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                    >
                        <Search size={14} />
                        Carica ordine da codice
                    </button>
                    <div className={`mt-3 rounded-xl border p-3 ${cashSession ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className={`text-xs font-black uppercase tracking-widest ${cashSession ? "text-emerald-700" : "text-rose-700"}`}>
                                    Stato Cassa
                                </p>
                                {isCashSessionLoading ? (
                                    <p className="text-sm font-semibold text-slate-500">Caricamento sessione...</p>
                                ) : cashSession ? (
                                    <p className="text-sm font-semibold text-emerald-700">
                                        Aperta alle {formatSessionDateTime(cashSession.openedAt)} · Fondo {formatEuro(cashSession.openingFloatAmount)}
                                    </p>
                                ) : (
                                    <p className="text-sm font-semibold text-rose-700">Chiusa. Apri la cassa per iniziare gli incassi.</p>
                                )}
                            </div>
                            {cashSession ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-emerald-300 bg-white font-black text-emerald-700"
                                    onClick={() => {
                                        setClosingCountedCashAmountInput("")
                                        setClosingNotes("")
                                        setIsCloseCashDialogOpen(true)
                                    }}
                                    disabled={isCashSessionLoading || isCashSessionActionLoading || isProcessing || isPrintMockActive}
                                >
                                    <Wallet size={14} />
                                    Chiudi Cassa
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    size="sm"
                                    className="bg-rose-600 font-black text-white hover:bg-rose-700"
                                    onClick={() => setIsOpenCashDialogOpen(true)}
                                    disabled={isCashSessionLoading || isCashSessionActionLoading}
                                >
                                    <Wallet size={14} />
                                    Apri Cassa
                                </Button>
                            )}
                        </div>
                    </div>
                    {lastClosedSummary ? (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-600">
                            <p className="font-black uppercase tracking-widest text-slate-500">Ultima chiusura</p>
                            <p className="mt-1">Chiusa alle {formatSessionDateTime(lastClosedSummary.closedAt)}</p>
                            <p>Atteso: {formatEuro(lastClosedSummary.expectedCashAmount)} · Contato: {formatEuro(lastClosedSummary.closingCountedCashAmount)}</p>
                            <p className={lastClosedSummary.varianceAmount === 0 ? "text-emerald-700" : "text-amber-700"}>
                                Differenza: {formatEuro(lastClosedSummary.varianceAmount)}
                            </p>
                        </div>
                    ) : null}
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
                                {normalizedTableValue ? `Tavolo ${normalizedTableValue}` : "Tavolo..."}
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
                                    <p className="text-xs font-semibold text-indigo-600 mt-1">
                                        Carrello precompilato: puoi aggiungere/rimuovere prodotti prima della chiusura.
                                    </p>
                                </div>
                                <button
                                    className="text-indigo-500 hover:text-indigo-700"
                                    onClick={resetPendingOrder}
                                    title="Rimuovi ordine caricato"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {cart.length === 0 ? (
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
                        disabled={cart.length === 0 || !selectedPosDeviceId || !cashSession || isProcessing || isPrintMockActive || isCashSessionLoading}
                        className="w-full py-8 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-3xl font-black text-2xl shadow-xl shadow-blue-200 dark:shadow-none active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                    >
                        <CheckCircle2 size={32} />
                        PAGA ORA
                    </button>
                    {!cashSession ? (
                        <p className="text-center text-xs font-black uppercase tracking-widest text-rose-600">
                            Incasso bloccato: cassa non aperta
                        </p>
                    ) : null}
                </div>
            </div>

            {/* Modal di Checkout */}
            <Dialog open={isCheckoutOpen} onOpenChange={handleCheckoutDialogOpenChange}>
                <DialogContent className="max-h-[90vh] max-w-[500px] overflow-y-auto rounded-3xl border-none p-0 text-slate-800 dark:text-slate-100">
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
                        {isPrintMockActive ? (
                            <div className="space-y-5">
                                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-6">
                                    <p className="text-xs font-black uppercase tracking-widest text-blue-600">Fase Stampa (Mock)</p>
                                    <p className="mt-1 text-2xl font-black text-blue-700">Stampa in corso...</p>
                                    <p className="mt-2 text-sm font-semibold text-blue-600">{printStatusLabel}</p>
                                    <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-blue-100">
                                        <div
                                            className="h-full rounded-full bg-blue-600 transition-all duration-300 ease-out"
                                            style={{ width: `${printProgress}%` }}
                                        />
                                    </div>
                                    <p className="mt-2 text-right text-sm font-black text-blue-700">{printProgress}%</p>
                                </div>
                                <p className="text-center text-sm font-semibold text-slate-500">
                                    Simulazione stampa attiva: integrazione stampante reale in arrivo.
                                </p>
                            </div>
                        ) : (
                            <>
                                {activeEvent?.settings?.askName && (
                                    <div className="space-y-3">
                                        <Label htmlFor="checkout-customer-name" className="text-lg font-bold">Nome Cliente</Label>
                                        <Input
                                            id="checkout-customer-name"
                                            value={customerName}
                                            onChange={(e) => setCustomerName(e.target.value)}
                                            placeholder="Inserisci nome cliente"
                                            className="h-14 rounded-2xl text-lg font-semibold"
                                        />
                                    </div>
                                )}

                                {activeEvent?.settings?.askTable && (
                                    <div className="space-y-4">
                                        <Label className="text-lg font-bold">Tavolo</Label>
                                        <div className="text-center py-4 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                                            <span className="text-5xl font-black text-blue-600">{normalizedTableValue || "---"}</span>
                                        </div>
                                        {predefinedTables.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {predefinedTables.map((table) => {
                                                    const isActive = normalizeTableValue(table) === normalizedTableValue
                                                    return (
                                                        <button
                                                            key={table}
                                                            type="button"
                                                            onClick={() => setTableNumber(table)}
                                                            className={`rounded-xl border-2 px-3 py-2 text-sm font-black transition-colors ${isActive ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}
                                                        >
                                                            {table}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        ) : null}
                                        <Input
                                            value={tableNumber}
                                            onChange={(e) => setTableNumber(e.target.value)}
                                            placeholder="Es: B02 oppure VIP TERRAZZA"
                                            className="h-12 rounded-xl border-2 font-semibold"
                                        />
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                                Tavolo selezionato: <span className="text-slate-800">{normalizedTableValue || "---"}</span>
                                            </p>
                                            <Button type="button" variant="outline" className="rounded-xl font-bold" onClick={clearTableSelection}>
                                                RESET
                                            </Button>
                                        </div>
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
                                        onClick={() => handleCheckoutDialogOpenChange(false)}
                                        disabled={isProcessing || isPrintMockActive}
                                    >
                                        ANNULLA
                                    </Button>
                                    <Button
                                        className="flex-1 py-8 text-xl font-bold rounded-2xl bg-green-600 hover:bg-green-700"
                                        onClick={() => void handleCheckout()}
                                        disabled={checkoutDisabled}
                                    >
                                        {isProcessing ? <Loader2 className="animate-spin" /> : "CONFERMA"}
                                    </Button>
                                </div>
                                {stockShortages.length > 0 ? (
                                    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-3">
                                        <p className="text-sm font-black text-amber-800">
                                            Scorte insufficienti rilevate. Conferma per procedere comunque.
                                        </p>
                                        <ul className="space-y-1">
                                            {stockShortages.map((shortage) => (
                                                <li key={shortage.productId} className="text-xs font-semibold text-amber-700">
                                                    {shortage.productName}: richiesti {shortage.requestedQuantity}, disponibili {shortage.availableQuantity}
                                                </li>
                                            ))}
                                        </ul>
                                        <div className="flex justify-end">
                                            <Button
                                                type="button"
                                                className="rounded-xl bg-amber-600 hover:bg-amber-700"
                                                onClick={() => void handleCheckout(true)}
                                                disabled={isProcessing}
                                            >
                                                Prosegui comunque
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Apertura Cassa */}
            <Dialog open={isOpenCashDialogOpen} onOpenChange={setIsOpenCashDialogOpen}>
                <DialogContent className="max-w-[480px] rounded-3xl p-0 overflow-hidden">
                    <DialogHeader className="border-b bg-rose-50 px-8 py-6">
                        <DialogTitle className="flex items-center gap-3 text-2xl font-black text-rose-700">
                            <Wallet className="h-6 w-6" />
                            Apertura Cassa
                        </DialogTitle>
                        <p className="text-sm font-semibold text-rose-600">
                            Inserisci il fondo cassa iniziale prima di iniziare gli incassi.
                        </p>
                    </DialogHeader>
                    <div className="space-y-5 p-8">
                        <div className="space-y-2">
                            <Label htmlFor="opening-float-amount" className="text-sm font-bold uppercase tracking-widest text-slate-500">
                                Fondo iniziale (€)
                            </Label>
                            <Input
                                id="opening-float-amount"
                                value={openingFloatAmountInput}
                                onChange={(e) => setOpeningFloatAmountInput(e.target.value)}
                                placeholder="Es: 50.00"
                                inputMode="decimal"
                                className="h-14 rounded-2xl border-2 text-2xl font-black text-center"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="opening-notes" className="text-sm font-bold uppercase tracking-widest text-slate-500">
                                Note apertura (opzionale)
                            </Label>
                            <Input
                                id="opening-notes"
                                value={openingNotes}
                                onChange={(e) => setOpeningNotes(e.target.value)}
                                placeholder="Es: Fondo da cassaforte principale"
                                className="h-12 rounded-xl"
                            />
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="flex-1 rounded-xl py-6 text-base font-bold"
                                onClick={() => setIsOpenCashDialogOpen(false)}
                                disabled={isCashSessionActionLoading}
                            >
                                ANNULLA
                            </Button>
                            <Button
                                type="button"
                                className="flex-1 rounded-xl bg-rose-600 py-6 text-base font-black hover:bg-rose-700"
                                onClick={() => void handleOpenCashSession()}
                                disabled={isCashSessionActionLoading}
                            >
                                {isCashSessionActionLoading ? <Loader2 className="animate-spin" /> : "APRI CASSA"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Chiusura Cassa */}
            <Dialog open={isCloseCashDialogOpen} onOpenChange={setIsCloseCashDialogOpen}>
                <DialogContent className="max-w-[560px] rounded-3xl p-0 overflow-hidden">
                    <DialogHeader className="border-b bg-emerald-50 px-8 py-6">
                        <DialogTitle className="flex items-center gap-3 text-2xl font-black text-emerald-700">
                            <Wallet className="h-6 w-6" />
                            Chiusura Cassa
                        </DialogTitle>
                        <p className="text-sm font-semibold text-emerald-600">
                            Registra il contante contato e conferma la chiusura della sessione corrente.
                        </p>
                    </DialogHeader>
                    <div className="space-y-5 p-8">
                        <div className="rounded-2xl border bg-slate-50 p-4 text-sm">
                            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Sessione attiva</p>
                            <p className="mt-1 font-semibold">Aperta alle {formatSessionDateTime(cashSession?.openedAt)}</p>
                            <p className="font-semibold">Fondo iniziale: {formatEuro(cashSession?.openingFloatAmount || 0)}</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="closing-counted-cash" className="text-sm font-bold uppercase tracking-widest text-slate-500">
                                Contante contato (€)
                            </Label>
                            <Input
                                id="closing-counted-cash"
                                value={closingCountedCashAmountInput}
                                onChange={(e) => setClosingCountedCashAmountInput(e.target.value)}
                                placeholder="Es: 185.40"
                                inputMode="decimal"
                                className="h-14 rounded-2xl border-2 text-2xl font-black text-center"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="closing-notes" className="text-sm font-bold uppercase tracking-widest text-slate-500">
                                Note chiusura (opzionale)
                            </Label>
                            <Input
                                id="closing-notes"
                                value={closingNotes}
                                onChange={(e) => setClosingNotes(e.target.value)}
                                placeholder="Es: consegnato in cassaforte"
                                className="h-12 rounded-xl"
                            />
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="flex-1 rounded-xl py-6 text-base font-bold"
                                onClick={() => setIsCloseCashDialogOpen(false)}
                                disabled={isCashSessionActionLoading}
                            >
                                ANNULLA
                            </Button>
                            <Button
                                type="button"
                                className="flex-1 rounded-xl bg-emerald-600 py-6 text-base font-black hover:bg-emerald-700"
                                onClick={() => void handleCloseCashSession()}
                                disabled={isCashSessionActionLoading}
                            >
                                {isCashSessionActionLoading ? <Loader2 className="animate-spin" /> : "CONFERMA CHIUSURA"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Feedback Operazioni */}
            <Dialog
                open={feedbackModal.open}
                onOpenChange={(open) => setFeedbackModal((prev) => ({ ...prev, open }))}
            >
                <DialogContent className="max-w-[460px] rounded-3xl p-0 overflow-hidden">
                    <DialogHeader
                        className={`border-b px-8 py-6 ${feedbackModal.tone === "success"
                            ? "bg-emerald-50"
                            : feedbackModal.tone === "error"
                                ? "bg-rose-50"
                                : "bg-slate-50"
                            }`}
                    >
                        <DialogTitle
                            className={`text-2xl font-black ${feedbackModal.tone === "success"
                                ? "text-emerald-700"
                                : feedbackModal.tone === "error"
                                    ? "text-rose-700"
                                    : "text-slate-800"
                                }`}
                        >
                            {feedbackModal.title}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 p-8">
                        <p className="text-base font-semibold text-slate-700">{feedbackModal.message}</p>
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                className={`rounded-xl px-8 font-black ${feedbackModal.tone === "success"
                                    ? "bg-emerald-600 hover:bg-emerald-700"
                                    : feedbackModal.tone === "error"
                                        ? "bg-rose-600 hover:bg-rose-700"
                                        : "bg-slate-700 hover:bg-slate-800"
                                    }`}
                                onClick={() => setFeedbackModal((prev) => ({ ...prev, open: false }))}
                            >
                                OK
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Carica Ordine da Codice */}
            <Dialog open={isCodeDialogOpen} onOpenChange={handleCodeDialogOpenChange}>
                <DialogContent className="max-w-[760px] rounded-3xl p-0 overflow-hidden">
                    <DialogHeader className="border-b bg-slate-50 px-8 py-6 dark:bg-slate-900">
                        <DialogTitle className="flex items-center gap-3 text-2xl font-black">
                            <Search className="h-6 w-6 text-indigo-600" />
                            Carica ordine da codice
                        </DialogTitle>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            Inserisci il numero ordine oppure seleziona rapidamente uno degli ultimi ordini pendenti.
                        </p>
                    </DialogHeader>
                    <div className="grid gap-6 p-8 md:grid-cols-[1.1fr_1fr]">
                        <div className="space-y-5">
                            <div className="space-y-3">
                                <Label htmlFor="order-code" className="text-sm font-bold uppercase tracking-widest text-slate-500">
                                    Codice ordine (numero progressivo)
                                </Label>
                                <Input
                                    id="order-code"
                                    value={orderCode}
                                    inputMode="numeric"
                                    onChange={(e) => setOrderCode(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault()
                                            void handleLoadOrderByCode()
                                        }
                                    }}
                                    placeholder="Es: 12"
                                    maxLength={8}
                                    className="h-20 rounded-2xl border-2 text-center text-4xl font-black tracking-wide"
                                />
                            </div>

                            <div className="flex gap-3">
                                <Button
                                    className="h-14 flex-1 rounded-2xl text-lg font-black bg-indigo-600 hover:bg-indigo-700"
                                    onClick={() => void handleLoadOrderByCode()}
                                    disabled={isCodeLoading || !orderCode.trim()}
                                >
                                    {isCodeLoading ? <Loader2 className="animate-spin" /> : "Carica Ordine"}
                                </Button>
                                <Button
                                    variant="outline"
                                    className="h-14 rounded-2xl px-5 font-bold"
                                    onClick={() => void loadRecentPendingOrdersForDialog()}
                                    disabled={isRecentOrdersLoading || isCodeLoading}
                                >
                                    {isRecentOrdersLoading ? <Loader2 className="animate-spin" /> : <RefreshCw size={16} />}
                                    Aggiorna
                                </Button>
                            </div>

                            <p className="text-xs font-semibold text-slate-500">
                                Se preferisci, tocca direttamente un ordine nella lista a destra.
                            </p>
                        </div>

                        <div className="rounded-2xl border bg-slate-50/80 p-4 dark:bg-slate-900/70">
                            <h3 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
                                <Clock3 size={14} />
                                Ultimi 10 ordini pendenti
                            </h3>
                            <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
                                {isRecentOrdersLoading ? (
                                    <div className="flex h-24 items-center justify-center rounded-xl border border-dashed text-slate-400">
                                        <Loader2 className="animate-spin" />
                                    </div>
                                ) : recentPendingOrders.length === 0 ? (
                                    <div className="rounded-xl border border-dashed p-4 text-sm font-semibold text-slate-500">
                                        Nessun ordine pendente disponibile.
                                    </div>
                                ) : (
                                    recentPendingOrders.map((order) => (
                                        <button
                                            key={order.id}
                                            className="w-full rounded-xl border bg-white p-3 text-left transition-colors hover:bg-indigo-50 hover:border-indigo-200 dark:bg-slate-800 dark:hover:bg-indigo-950/40"
                                            onClick={() => void handleLoadOrderByCode(order.code)}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Numero ordine</p>
                                                    <p className="text-2xl font-black text-indigo-700 dark:text-indigo-300">{order.code}</p>
                                                </div>
                                                <p className="text-lg font-black text-slate-700 dark:text-slate-200">
                                                    {order.totalAmount.toFixed(2)} €
                                                </p>
                                            </div>
                                            <div className="mt-1 flex items-center justify-between text-xs font-semibold text-slate-500">
                                                <span>{order.customer?.name || "Cliente non indicato"}{order.customer?.table ? ` · Tavolo ${order.customer.table}` : ""}</span>
                                                <span>{formatRecentOrderTime(order.createdAt)}</span>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
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
