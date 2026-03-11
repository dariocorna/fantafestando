"use client"

import { useState, useEffect } from "react"
import { ShoppingCart, User, Banknote, Trash2, CheckCircle2, Loader2, Hash, Monitor, Search, X, RefreshCw, Clock3, Wallet, Check } from "lucide-react"
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
    closeCashSession,
    getCashSessionClosurePreview,
    retryFailedOrderPrintJobs
} from "./actions"
import { categoryColorWithAlpha, getCategoryTheme } from "@/lib/category-colors"
import { isTableValueValid, normalizeTableValue } from "@/lib/table-presets"
import { getStockLabel, getStockStatus, type StockShortage } from "@/lib/inventory"
import { resolveQuickDiscountPresetsFromSettings, type QuickDiscountPreset } from "@/lib/quick-discount-presets"
import { normalizePosCatalogLayout } from "@/lib/pos-catalog-layout"

interface ICategory {
    _id: string
    name: string
    uiColor?: string
}

interface IProduct {
    _id: string
    name: string
    shortName?: string
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
        posCatalogLayout?: "COMPACT_COLUMNS" | "MODERN_TABS"
        quickDiscountPresets?: Array<{
            label: string
            type: "PERCENT" | "FIXED"
            value: number
        }>
        quickStaffDiscountEnabled?: boolean
        quickStaffDiscountLabel?: string
        quickStaffDiscountType?: "PERCENT" | "FIXED"
        quickStaffDiscountValue?: number
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
    printerId?: string | { _id: string; name: string; ip: string; port?: number; isVirtual?: boolean; emulatorSlot?: number }
    paymentTerminalId?: string | IPeripheralRef
    cashBoxId?: string | IPeripheralRef
}

interface CartItem {
    lineId: string
    productId: string
    name: string
    price: number
    quantity: number
    variants: string[]
    isDiscount?: boolean
    discountPreset?: {
        label: string
        type: "PERCENT" | "FIXED"
        value: number
        baseAmount: number
    }
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

interface CloseCashSessionPreviewState {
    sessionId: string
    openedAt: string
    openingFloatAmount: number
    paidOrdersCount: number
    cashSalesAmount: number
    cardSalesAmount: number
    otherSalesAmount: number
    expectedCashAmount: number
}

interface FeedbackModalState {
    open: boolean
    tone: "error" | "success" | "info"
    title: string
    message: string
    action?: {
        type: "RETRY_FAILED_PRINTS"
        eventId: string
        orderId: string
    }
}

interface PrintDispatchSummaryState {
    attempted: number
    succeeded: number
    failed: number
    allSuccessful: boolean
}

function getCurrentEpochMs() {
    return Date.now()
}

function getPeripheralRef(value: IPosDevice["paymentTerminalId"] | IPosDevice["cashBoxId"]) {
    if (!value || typeof value !== "object") return null
    return value
}

export default function PosPage() {
    const [cart, setCart] = useState<CartItem[]>([])
    const [categories, setCategories] = useState<ICategory[]>([])
    const [activeCategory, setActiveCategory] = useState<string | null>(null)
    const [products, setProducts] = useState<IProduct[]>([])
    const [activeEvent, setActiveEvent] = useState<IEvent | null>(null)
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
    const [isDiscountsExpanded, setIsDiscountsExpanded] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
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
    const [recentPendingOrdersReferenceTime, setRecentPendingOrdersReferenceTime] = useState<number | null>(null)
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
    const [closeCashSessionPreview, setCloseCashSessionPreview] = useState<CloseCashSessionPreviewState | null>(null)
    const [isCloseCashSessionPreviewLoading, setIsCloseCashSessionPreviewLoading] = useState(false)
    const [feedbackModal, setFeedbackModal] = useState<FeedbackModalState>({
        open: false,
        tone: "info",
        title: "",
        message: ""
    })
    const [isRetryingFailedPrints, setIsRetryingFailedPrints] = useState(false)
    const [retryPrintsFeedback, setRetryPrintsFeedback] = useState<string | null>(null)

    // Info Cliente
    const [customerName, setCustomerName] = useState("")
    const [tableNumber, setTableNumber] = useState("")

    const loadCashSessionStatusFor = async (eventId: string, posDeviceId: string) => {
        setIsCashSessionLoading(true)
        const result = await getCashSessionStatus({ eventId, posDeviceId })
        if (result.success) {
            setCashSession(result.session)
            if (!result.session) {
                setCloseCashSessionPreview(null)
            }
        } else {
            setCashSession(null)
            setCloseCashSessionPreview(null)
        }
        setIsCashSessionLoading(false)
    }

    // Caricamento iniziale: evento attivo e menu
    useEffect(() => {
        const loadInitialData = async () => {
            const res = await fetch('/api/pos/init?channel=pos', { cache: "no-store" })
            const data = await res.json()
            if (data.event) {
                setActiveEvent(data.event)
                setCategories(data.categories)
                setActiveCategory(data.categories?.[0]?._id ?? null)
                setProducts(data.products)
                setPosDevices(data.posDevices)

                // Check localStorage for POS Device
                const savedPosId = localStorage.getItem('fantafestando_pos_id')
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
        localStorage.setItem('fantafestando_pos_id', id)
        setIsPosSelectorOpen(false)
        setLastClosedSummary(null)
        setCloseCashSessionPreview(null)
        if (activeEventId) {
            void loadCashSessionStatusFor(activeEventId, id)
        }
    }

    const selectedPosDevice = posDevices.find((d: IPosDevice) => d._id === selectedPosDeviceId)
    const selectedPaymentTerminal = getPeripheralRef(selectedPosDevice?.paymentTerminalId)
    const selectedCashBox = getPeripheralRef(selectedPosDevice?.cashBoxId)
    const activeEventId = activeEvent?._id

    const cashAvailable = Boolean(selectedCashBox)
    const cardAvailable = Boolean(selectedPaymentTerminal)

    const effectivePaymentMethod: "CASH" | "CARD" =
        paymentMethod === "CASH" && !cashAvailable && cardAvailable
            ? "CARD"
            : paymentMethod === "CARD" && !cardAvailable && cashAvailable
                ? "CASH"
                : paymentMethod

    const quickDiscountPresets = resolveQuickDiscountPresetsFromSettings(activeEvent?.settings)
    const productCartItems = cart.filter((item) => !item.isDiscount)
    const discountCartItems = cart.filter((item) => item.isDiscount)
    const subtotal = Number(
        productCartItems.reduce((acc: number, item: CartItem) => acc + (item.price * item.quantity), 0).toFixed(2)
    )
    const totalDiscountRequested = Number(
        Math.max(0, discountCartItems.reduce((acc: number, item: CartItem) => acc + (item.price * item.quantity), 0) * -1).toFixed(2)
    )
    const totalDiscountApplied = Number(Math.min(subtotal, totalDiscountRequested).toFixed(2))
    const effectiveTotal = Number(Math.max(0, subtotal - totalDiscountApplied).toFixed(2))
    const discountLabels = discountCartItems
        .map((item) => item.discountPreset?.label?.trim())
        .filter((label): label is string => Boolean(label))
    const orderDiscountPayload = totalDiscountApplied > 0
        ? {
            type: "FIXED" as const,
            value: totalDiscountApplied,
            label: discountLabels.length > 0 ? `Sconti: ${discountLabels.join(", ")}` : "Sconti carrello"
        }
        : undefined
    const discountBaseAmount = effectiveTotal

    const computePresetDiscountAmount = (preset: QuickDiscountPreset, baseAmount: number): number => {
        const normalizedBase = Number(Math.max(0, baseAmount).toFixed(2))
        if (normalizedBase <= 0) return 0

        if (preset.type === "PERCENT") {
            return Number((normalizedBase * (preset.value / 100)).toFixed(2))
        }

        return Number(Math.min(normalizedBase, preset.value).toFixed(2))
    }
    const normalizedTableValue = normalizeTableValue(tableNumber)
    const tableValueValid = isTableValueValid(tableNumber)
    const predefinedTables = activeEvent?.predefinedTables || []
    const categoryColumnsCount = Math.max(categories.length, 1)
    const isModernCatalogLayout = normalizePosCatalogLayout(activeEvent?.settings?.posCatalogLayout) === "MODERN_TABS"
    const selectedModernCategoryId = activeCategory && categories.some((category) => category._id === activeCategory)
        ? activeCategory
        : (categories[0]?._id ?? null)
    const productsByCategory = categories.reduce<Record<string, IProduct[]>>((acc, category) => {
        acc[category._id] = products.filter((product) => product.categoryId === category._id)
        return acc
    }, {})
    const selectedModernCategory = selectedModernCategoryId
        ? categories.find((category) => category._id === selectedModernCategoryId) || null
        : null
    const selectedModernCategoryProducts = selectedModernCategoryId
        ? productsByCategory[selectedModernCategoryId] || []
        : []
    const selectedModernCategoryTheme = getCategoryTheme(selectedModernCategory?.uiColor)
    const resolveProductDisplayName = (product: IProduct) => product.shortName?.trim() || product.name
    const getAdaptiveProductRowMinHeight = (productsCount: number): string => {
        const safeCount = Math.max(productsCount, 1)
        const gapPx = 6 // space-y-1.5
        const reservedVerticalPx = isDiscountsExpanded ? 170 : 120

        // Viewport-based adaptive sizing per column:
        // - grows on tall screens
        // - shrinks automatically on smaller heights
        // - never explodes or collapses thanks to clamp bounds.
        return `clamp(38px, calc((100dvh - ${reservedVerticalPx}px - ${(safeCount - 1) * gapPx}px) / ${safeCount}), 96px)`
    }

    const addToCart = (product: IProduct) => {
        setCart((prev: CartItem[]) => {
            const existing = prev.find((i: CartItem) => !i.isDiscount && i.productId === product._id)
            if (existing) {
                return prev.map((i: CartItem) => i.lineId === existing.lineId ? { ...i, quantity: i.quantity + 1 } : i)
            }
            return [...prev, {
                lineId: product._id,
                productId: product._id,
                name: resolveProductDisplayName(product),
                price: product.basePrice,
                quantity: 1,
                variants: []
            }]
        })
    }

    const addDiscountPresetToCart = (preset: QuickDiscountPreset) => {
        if (productCartItems.length === 0) {
            showFeedbackModal("Aggiungi prima almeno un prodotto al carrello")
            return
        }

        const discountAmount = computePresetDiscountAmount(preset, discountBaseAmount)
        if (discountAmount <= 0) {
            showFeedbackModal("Nessun importo disponibile da scontare")
            return
        }

        setCart((prev: CartItem[]) => ([
            ...prev,
            (() => {
                const nextDiscountSequence = prev.reduce((max, item) => {
                    if (!item.isDiscount) return max
                    const match = item.lineId.match(/^discount-line-(\d+)$/)
                    return match ? Math.max(max, Number(match[1])) : max
                }, 0) + 1
                const lineId = `discount-line-${nextDiscountSequence}`

                return {
                    lineId,
                    productId: lineId,
                    name: `Sconto ${preset.label}`,
                    price: Number((discountAmount * -1).toFixed(2)),
                    quantity: 1,
                    variants: [],
                    isDiscount: true,
                    discountPreset: {
                        label: preset.label,
                        type: preset.type,
                        value: preset.value,
                        baseAmount: discountBaseAmount
                    }
                }
            })()
        ]))
    }

    const removeFromCart = (lineId: string) => {
        setCart((prev: CartItem[]) => prev.filter((i: CartItem) => i.lineId !== lineId))
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
        const loadedAt = getCurrentEpochMs()
        if (result.success) {
            setRecentPendingOrders(result.orders)
            setRecentPendingOrdersReferenceTime(loadedAt)
        } else {
            setRecentPendingOrders([])
            setRecentPendingOrdersReferenceTime(loadedAt)
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
        title?: string,
        action?: FeedbackModalState["action"]
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
            message,
            action
        })
        setRetryPrintsFeedback(null)
        setIsRetryingFailedPrints(false)
    }

    const buildPrintFailureMessage = (summary?: PrintDispatchSummaryState) => {
        if (!summary || summary.failed === 0) return null
        return `Pagamento registrato, ma la stampa ha errori: ${summary.succeeded}/${summary.attempted} job inviati, ${summary.failed} falliti. Controlla il Monitor Stampa.`
    }

    const handleRetryFailedPrintsFromModal = async () => {
        const action = feedbackModal.action
        if (!action || action.type !== "RETRY_FAILED_PRINTS") return

        setIsRetryingFailedPrints(true)
        setRetryPrintsFeedback(null)
        const result = await retryFailedOrderPrintJobs({
            eventId: action.eventId,
            orderId: action.orderId
        })
        setIsRetryingFailedPrints(false)

        if (!result.success) {
            setRetryPrintsFeedback(result.error || "Reinvio non riuscito")
            return
        }

        if (result.attempted === 0) {
            setRetryPrintsFeedback("Nessun job fallito da reinviare per questo ordine.")
            return
        }

        if (result.failed > 0) {
            setRetryPrintsFeedback(`Reinvio completato parzialmente: ${result.retried}/${result.attempted} inviati.`)
            return
        }

        setRetryPrintsFeedback(`Reinvio completato: ${result.retried}/${result.attempted} job inviati.`)
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

    const handleOpenCloseCashDialog = async () => {
        if (!activeEventId || !selectedPosDeviceId) {
            showFeedbackModal("Seleziona prima una cassa")
            return
        }

        if (!cashSession) {
            showFeedbackModal("Nessuna sessione cassa aperta")
            return
        }

        setClosingCountedCashAmountInput("")
        setClosingNotes("")
        setCloseCashSessionPreview(null)
        setIsCloseCashSessionPreviewLoading(true)

        const previewResult = await getCashSessionClosurePreview({
            eventId: activeEventId,
            posDeviceId: selectedPosDeviceId
        })

        setIsCloseCashSessionPreviewLoading(false)

        if (!previewResult.success) {
            showFeedbackModal(previewResult.error || "Errore durante il calcolo del contante atteso")
            return
        }

        setCloseCashSessionPreview(previewResult.preview)
        setIsCloseCashDialogOpen(true)
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
        setCloseCashSessionPreview(null)
        setClosingCountedCashAmountInput("")
        setClosingNotes("")
        setLastClosedSummary(result.summary)
        setIsCloseCashDialogOpen(false)
    }

    const handleCheckoutDialogOpenChange = (open: boolean) => {
        if (isProcessing) return
        setIsCheckoutOpen(open)
        if (!open) {
            setStockShortages([])
        }
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
        setCart(result.order.items.map((item, index) => ({
            lineId: `${item.productId}-${index}`,
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
        if (productCartItems.length === 0) {
            showFeedbackModal("Aggiungi almeno un prodotto prima di procedere al pagamento")
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
                totalAmount: effectiveTotal,
                orderDiscount: orderDiscountPayload,
                lineDiscounts: [],
                cart: productCartItems.map((item) => ({
                    productId: item.productId,
                    snapshotName: item.name,
                    quantity: item.quantity,
                    selectedOptions: []
                }))
            })

            if (completionResult.success) {
                setRecentPendingOrders((prev) => prev.filter((order) => order.id !== completedPendingOrderId))
                resetCheckoutForm()
                resetPendingOrder()
                setIsCheckoutOpen(false)
                setStockShortages([])
                const printFailureMessage = buildPrintFailureMessage(completionResult.printSummary)
                if (printFailureMessage) {
                    showFeedbackModal(printFailureMessage, "error", "Errore stampa", {
                        type: "RETRY_FAILED_PRINTS",
                        eventId: activeEvent._id,
                        orderId: completionResult.orderId
                    })
                }
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
            totalAmount: effectiveTotal,
            orderDiscount: orderDiscountPayload,
            lineDiscounts: [],
            cart: productCartItems.map(item => ({
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
            resetCheckoutForm()
            setIsCheckoutOpen(false)
            setStockShortages([])
            const printFailureMessage = buildPrintFailureMessage(result.printSummary)
            if (printFailureMessage) {
                showFeedbackModal(printFailureMessage, "error", "Errore stampa", {
                    type: "RETRY_FAILED_PRINTS",
                    eventId: activeEvent._id,
                    orderId: result.orderId
                })
            }
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
        || productCartItems.length === 0
        || (!cashAvailable && !cardAvailable)
        || (Boolean(activeEvent?.settings?.askTable) && !tableValueValid)

    return (
        <div className="brand-surface-pos flex h-screen w-screen overflow-hidden" data-testid="pos-brand-shell">
            {/* Sinistra: Selezione Prodotti (70%) */}
            <div className="flex h-full flex-1 flex-col border-r border-[#d9e6f8] bg-white">
                <div className="shrink-0 border-b border-[#d9e6f8] bg-[#f7fbff] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h3 className="text-xs font-black uppercase tracking-[0.08em] text-[var(--brand-blue-700)]">
                                Catalogo completo
                            </h3>
                            <p className="text-[11px] font-semibold text-slate-500">
                                {categories.length} categorie • {products.length} prodotti
                            </p>
                        </div>
                        <button
                            id="discounts-tab-trigger"
                            onClick={() => setIsDiscountsExpanded((prev) => !prev)}
                            className={`rounded-md border px-2.5 py-1.5 text-[11px] font-black uppercase tracking-[0.05em] transition-colors ${isDiscountsExpanded
                                ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                }`}
                        >
                            Sconti
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 text-slate-800">
                    <div className="space-y-2">
                        {isDiscountsExpanded ? (
                            <section
                                id="pos-discount-presets"
                                className="border border-[#d9e6f8] bg-white p-2"
                                data-testid="pos-discount-presets"
                            >
                                {quickDiscountPresets.length === 0 ? (
                                    <div className="border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center">
                                        <p className="text-sm font-black text-slate-700">Nessun preset sconto configurato</p>
                                        <p className="mt-1 text-xs font-semibold text-slate-500">
                                            Configura i preset da Admin &gt; Impostazioni.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {quickDiscountPresets.map((preset, index) => {
                                            const previewAmount = computePresetDiscountAmount(preset, discountBaseAmount)
                                            return (
                                                <button
                                                    key={`discount-preset-card-${preset.label}-${preset.type}-${preset.value}-${index}`}
                                                    id={`discount-preset-card-${index}`}
                                                    onClick={() => addDiscountPresetToCart(preset)}
                                                    disabled={productCartItems.length === 0}
                                                    className="inline-flex h-10 min-w-[200px] items-center gap-1.5 border border-emerald-200 bg-emerald-50 px-2 py-1 text-left transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    <span className="max-w-[120px] truncate text-xs font-black leading-tight text-emerald-800">
                                                        {preset.label}
                                                    </span>
                                                    <span className="inline-flex w-fit border border-emerald-200 bg-white px-1 py-0.5 text-[10px] font-bold text-emerald-700">
                                                        {preset.type === "PERCENT" ? `${preset.value}%` : `${preset.value.toFixed(2)} €`}
                                                    </span>
                                                    <span className="ml-auto whitespace-nowrap text-xs font-black text-emerald-700">
                                                        -{previewAmount.toFixed(2)} €
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </section>
                        ) : null}

                        <section data-testid="pos-all-categories-catalog">
                            {isModernCatalogLayout ? (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap gap-1 border-b border-[#d9e6f8] pb-2">
                                        {categories.map((cat) => {
                                            const catTheme = getCategoryTheme(cat.uiColor)
                                            const isActive = selectedModernCategoryId === cat._id
                                            return (
                                                <button
                                                    key={cat._id}
                                                    type="button"
                                                    onClick={() => setActiveCategory(cat._id)}
                                                    className="inline-flex min-h-11 items-center gap-1.5 border px-3.5 py-2 text-sm font-black uppercase tracking-[0.04em] transition-all"
                                                    style={isActive
                                                        ? {
                                                            backgroundColor: catTheme.base,
                                                            color: catTheme.onBase,
                                                            borderColor: catTheme.base,
                                                        }
                                                        : {
                                                            backgroundColor: categoryColorWithAlpha(cat.uiColor, 0.16),
                                                            color: catTheme.base,
                                                            borderColor: catTheme.border,
                                                        }}
                                                >
                                                    {isActive ? <Check size={14} /> : null}
                                                    <span className="max-w-[170px] truncate">{cat.name}</span>
                                                </button>
                                            )
                                        })}
                                    </div>

                                    {!selectedModernCategory ? (
                                        <div className="border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-semibold text-slate-500">
                                            Nessuna categoria disponibile.
                                        </div>
                                    ) : selectedModernCategoryProducts.length === 0 ? (
                                        <div className="border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-semibold text-slate-500">
                                            Nessun prodotto nella categoria selezionata.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div
                                                className="flex items-center justify-between border px-3 py-2"
                                                style={{
                                                    borderColor: selectedModernCategoryTheme.border,
                                                    backgroundColor: categoryColorWithAlpha(selectedModernCategory.uiColor, 0.16),
                                                }}
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                                                        Categoria attiva
                                                    </p>
                                                    <p
                                                        className="truncate text-sm font-black uppercase tracking-[0.04em]"
                                                        style={{ color: selectedModernCategoryTheme.base }}
                                                    >
                                                        {selectedModernCategory.name}
                                                    </p>
                                                </div>
                                                <span
                                                    className="shrink-0 border px-2 py-1 text-xs font-black"
                                                    style={{
                                                        color: selectedModernCategoryTheme.base,
                                                        borderColor: selectedModernCategoryTheme.border,
                                                        backgroundColor: "white",
                                                    }}
                                                >
                                                    {selectedModernCategoryProducts.length} prodotti
                                                </span>
                                            </div>

                                            <div className="grid content-start gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                                                {selectedModernCategoryProducts.map((p, productIndex) => {
                                                    const stockStatus = p.stockStatus || getStockStatus(p.stockQuantity ?? null, Boolean(p.isSoldOut))
                                                    const stockLabel = getStockLabel(p.stockQuantity ?? null, Boolean(p.isSoldOut))
                                                    const showStockPill = stockStatus === "LOW" || stockStatus === "OUT"
                                                    const stripedBackground = productIndex % 2 === 0
                                                        ? categoryColorWithAlpha(selectedModernCategory.uiColor, 0.24)
                                                        : categoryColorWithAlpha(selectedModernCategory.uiColor, 0.14)
                                                    const cardBorderColor = stockStatus === "OUT" ? "#dc2626" : selectedModernCategoryTheme.base

                                                    return (
                                                        <button
                                                            key={p._id}
                                                            onClick={() => addToCart(p)}
                                                            data-testid={`pos-product-${p._id}`}
                                                            className="group relative flex min-h-[136px] flex-col overflow-hidden border-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(15,23,42,0.12)] active:translate-y-0"
                                                            style={{ borderColor: cardBorderColor }}
                                                        >
                                                            <div
                                                                className="flex flex-1 flex-col gap-2 px-2.5 py-2.5"
                                                                style={{
                                                                    backgroundColor: stockStatus === "OUT"
                                                                        ? "rgba(254, 226, 226, 0.88)"
                                                                        : stripedBackground,
                                                                }}
                                                            >
                                                                <p className="line-clamp-3 text-[1.02rem] font-black uppercase leading-tight text-slate-900">
                                                                    {resolveProductDisplayName(p)}
                                                                </p>
                                                                <div className="mt-auto flex items-end justify-between gap-2">
                                                                    {showStockPill ? (
                                                                        <span
                                                                            className={`inline-flex w-fit rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${stockStatus === "OUT"
                                                                                ? "bg-red-100 text-red-700"
                                                                                : "bg-amber-100 text-amber-700"
                                                                                }`}
                                                                        >
                                                                            {stockLabel}
                                                                        </span>
                                                                    ) : (
                                                                        <span />
                                                                    )}
                                                                    <span
                                                                        className="inline-flex min-w-[96px] justify-center border px-2 py-1 text-lg font-black leading-none"
                                                                        style={{
                                                                            color: cardBorderColor,
                                                                            borderColor: cardBorderColor,
                                                                            backgroundColor: "rgba(255, 255, 255, 0.88)",
                                                                        }}
                                                                    >
                                                                        {p.basePrice.toFixed(2)} €
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div
                                    className="grid content-start gap-1"
                                    style={{ gridTemplateColumns: `repeat(${categoryColumnsCount}, minmax(0, 1fr))` }}
                                >
                                    {categories.map((cat) => {
                                        const catTheme = getCategoryTheme(cat.uiColor)
                                        const categoryProducts = productsByCategory[cat._id] || []
                                        const categoryRowMinHeight = getAdaptiveProductRowMinHeight(categoryProducts.length)

                                        return (
                                            <article
                                                key={cat._id}
                                                className="min-w-0"
                                                style={{ backgroundColor: categoryColorWithAlpha(cat.uiColor, 0.12) }}
                                            >
                                                <header
                                                    className="mb-1 flex items-center justify-between border-b px-0 py-0.5"
                                                    style={{
                                                        backgroundColor: catTheme.softBg,
                                                        borderColor: catTheme.border,
                                                    }}
                                                >
                                                    <h4
                                                        className="truncate text-sm font-black uppercase tracking-[0.04em]"
                                                        style={{ color: catTheme.base }}
                                                    >
                                                        {cat.name}
                                                    </h4>
                                                    <span
                                                        className="rounded-sm border px-1.5 py-0.5 text-[10px] font-black"
                                                        style={{
                                                            color: catTheme.base,
                                                            borderColor: catTheme.border,
                                                            backgroundColor: "white",
                                                        }}
                                                    >
                                                        {categoryProducts.length}
                                                    </span>
                                                </header>

                                                {categoryProducts.length === 0 ? (
                                                    <div className="border border-dashed border-slate-200 bg-slate-50 px-1 py-2 text-center text-xs font-semibold text-slate-500">
                                                        Nessun prodotto in categoria
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1.5">
                                                        {categoryProducts.map((p, productIndex) => {
                                                            const stockStatus = p.stockStatus || getStockStatus(p.stockQuantity ?? null, Boolean(p.isSoldOut))
                                                            const stockLabel = getStockLabel(p.stockQuantity ?? null, Boolean(p.isSoldOut))
                                                            const showStockPill = stockStatus === "LOW" || stockStatus === "OUT"
                                                            const stripedBackground = productIndex % 2 === 0
                                                                ? categoryColorWithAlpha(cat.uiColor, 0.62)
                                                                : categoryColorWithAlpha(cat.uiColor, 0.18)
                                                            const strongInset = categoryColorWithAlpha(cat.uiColor, 0.5)

                                                            return (
                                                                <button
                                                                    key={p._id}
                                                                    onClick={() => addToCart(p)}
                                                                    data-testid={`pos-product-${p._id}`}
                                                                    className="flex w-full flex-col items-center justify-center border px-1.5 py-1 text-center transition-all hover:brightness-90 active:scale-[0.99]"
                                                                    style={{
                                                                        borderColor: stockStatus === "OUT" ? "#dc2626" : catTheme.base,
                                                                        borderWidth: "2px",
                                                                        minHeight: categoryRowMinHeight,
                                                                        backgroundColor: stockStatus === "OUT"
                                                                            ? "rgba(239, 68, 68, 0.24)"
                                                                            : stripedBackground,
                                                                        boxShadow: stockStatus === "OUT"
                                                                            ? "inset 0 0 0 1px rgba(185, 28, 28, 0.5)"
                                                                            : `inset 0 0 0 1px ${strongInset}`,
                                                                    }}
                                                                >
                                                                    <p className="mx-auto w-full max-w-[96%] truncate text-center text-[clamp(14px,0.95vw,20px)] font-black uppercase leading-tight text-slate-800">
                                                                        {resolveProductDisplayName(p)}
                                                                    </p>
                                                                    {showStockPill ? (
                                                                        <span
                                                                            className={`mx-auto inline-flex w-fit rounded-sm px-1 py-0.5 text-[10px] font-bold ${stockStatus === "OUT"
                                                                                ? "bg-red-100 text-red-700"
                                                                                : "bg-amber-100 text-amber-700"
                                                                                }`}
                                                                        >
                                                                            {stockLabel}
                                                                        </span>
                                                                    ) : null}
                                                                </button>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </article>
                                        )
                                    })}
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            </div>

            {/* Destra: Riepilogo & Carrello (30%) */}
            <div
                className="h-full shrink-0 border-l border-[#d9e6f8] bg-[#f7fbff] flex flex-col"
                style={{ width: "clamp(280px, 23vw, 380px)" }}
            >
                {/* Info Intestazione */}
                <div className="border-b border-[#d9e6f8] bg-white p-4">
                    <h2 className="text-lg font-black uppercase tracking-tight text-[var(--brand-ink)]">
                        {activeEvent?.name || "Cassa FantaFestando"}
                    </h2>
                    <button
                        onClick={() => setIsPosSelectorOpen(true)}
                        className="mt-1 flex items-center gap-1 text-xs font-bold text-[var(--brand-blue-700)] hover:underline"
                    >
                        <Monitor size={12} />
                        {selectedPosDevice ? `Postazione: ${selectedPosDevice.name}` : "Seleziona Cassa"}
                    </button>
                    <button
                        onClick={() => handleCodeDialogOpenChange(true)}
                        className="mt-2 inline-flex items-center gap-2 rounded-md border border-[#d9e6f8] bg-[#eef5ff] px-2.5 py-1.5 text-xs font-bold text-[var(--brand-blue-700)] transition-colors hover:bg-[#e4efff]"
                    >
                        <Search size={14} />
                        Carica ordine da codice
                    </button>
                    <div className={`mt-3 rounded-md border p-2.5 ${cashSession ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className={`text-[10px] font-black uppercase tracking-widest ${cashSession ? "text-emerald-700" : "text-rose-700"}`}>
                                    Stato Cassa
                                </p>
                                {isCashSessionLoading ? (
                                    <p className="text-xs font-semibold text-slate-500">Caricamento sessione...</p>
                                ) : cashSession ? (
                                    <p className="text-xs font-semibold text-emerald-700">
                                        Aperta alle {formatSessionDateTime(cashSession.openedAt)} · Fondo {formatEuro(cashSession.openingFloatAmount)}
                                    </p>
                                ) : (
                                    <p className="text-xs font-semibold text-rose-700">Chiusa. Apri la cassa per iniziare gli incassi.</p>
                                )}
                            </div>
                            {cashSession ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="border-emerald-300 bg-white font-black text-emerald-700"
                                    onClick={() => void handleOpenCloseCashDialog()}
                                    disabled={isCashSessionLoading || isCashSessionActionLoading || isCloseCashSessionPreviewLoading || isProcessing}
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
                        <div className="mt-3 rounded-md border border-slate-200 bg-white p-2.5 text-xs font-semibold text-slate-600">
                            <p className="font-black uppercase tracking-widest text-slate-500">Ultima chiusura</p>
                            <p className="mt-1">Chiusa alle {formatSessionDateTime(lastClosedSummary.closedAt)}</p>
                            <p>Atteso: {formatEuro(lastClosedSummary.expectedCashAmount)} · Contato: {formatEuro(lastClosedSummary.closingCountedCashAmount)}</p>
                            <p className={lastClosedSummary.varianceAmount === 0 ? "text-emerald-700" : "text-amber-700"}>
                                Differenza: {formatEuro(lastClosedSummary.varianceAmount)}
                            </p>
                        </div>
                    ) : null}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2 rounded-md border bg-white p-2">
                            <User size={18} className="text-slate-400" />
                            <input
                                className="bg-transparent border-none focus:outline-none text-sm font-bold w-full"
                                placeholder="Nome..."
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-2 rounded-md border bg-white p-2">
                            <Hash size={18} className="text-slate-400" />
                            <span className="text-sm font-bold truncate">
                                {normalizedTableValue ? `Tavolo ${normalizedTableValue}` : "Tavolo..."}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Elementi Carrello */}
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                    {loadedPendingOrder ? (
                        <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <p className="text-xs uppercase font-bold tracking-widest text-indigo-500">Ordine WebApp Caricato</p>
                                    <p className="text-base font-black text-indigo-700">Codice {loadedPendingOrder.code}</p>
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
                        <div className="flex h-full flex-col items-center justify-center space-y-3 text-slate-400 opacity-50">
                            <ShoppingCart size={52} />
                            <p className="font-bold">Il carrello è vuoto</p>
                        </div>
                    ) : (
                        cart.map((item) => {
                            const lineTotal = Number((item.quantity * item.price).toFixed(2))
                            return (
                                <div key={item.lineId} className="flex items-center justify-between rounded-md border bg-white p-2.5">
                                    <div className="flex flex-col">
                                        <span className={`text-sm font-bold ${item.isDiscount ? "text-emerald-700" : "text-slate-800 dark:text-slate-100"}`}>{item.name}</span>
                                        {item.isDiscount ? (
                                            <span className="text-[11px] font-semibold text-emerald-600">
                                                {item.discountPreset?.type === "PERCENT"
                                                    ? `${item.discountPreset.value}% su ${item.discountPreset.baseAmount.toFixed(2)} €`
                                                    : `Sconto fisso ${item.discountPreset?.value.toFixed(2)} €`}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-slate-500">{item.quantity} x {item.price.toFixed(2)} €</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="text-right">
                                            <span className={`text-sm font-black ${item.isDiscount ? "text-emerald-700" : ""}`}>{lineTotal.toFixed(2)} €</span>
                                        </div>
                                        <button onClick={() => removeFromCart(item.lineId)} className="p-1.5 text-red-500">
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>

                {/* Footer / Pulsante Pagamento */}
                <div className="space-y-3 border-t border-[#d9e6f8] bg-white p-4">
                    <div className="mb-1 flex items-center justify-between px-1">
                        <span className="text-sm text-slate-500 font-bold uppercase tracking-widest">Totale da Pagare</span>
                        <span className="text-3xl font-black leading-none text-[var(--brand-blue-700)]">{effectiveTotal.toFixed(2)} €</span>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-600">
                        <p>Subtotale prodotti: {subtotal.toFixed(2)} €</p>
                        <p>Sconti applicati: -{totalDiscountApplied.toFixed(2)} €</p>
                    </div>

                    <button
                        onClick={() => setIsCheckoutOpen(true)}
                        disabled={productCartItems.length === 0 || !selectedPosDeviceId || !cashSession || isProcessing || isCashSessionLoading}
                        className="brand-cta-primary flex w-full items-center justify-center gap-2 rounded-md py-4 text-lg font-black transition-all active:scale-[0.98] hover:brightness-105 disabled:bg-slate-200 disabled:text-slate-400"
                        data-testid="pos-pay-cta"
                    >
                        <CheckCircle2 size={22} />
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
                <DialogContent className="max-h-[96dvh] max-w-[560px] overflow-y-auto rounded-2xl border-none p-0 text-slate-800 dark:text-slate-100">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Checkout ordine POS</DialogTitle>
                    </DialogHeader>
                    <div className="bg-blue-600 px-4 py-4 text-center text-white sm:px-6 sm:py-5">
                        <span className="text-xs font-bold uppercase tracking-widest text-blue-200">Importo Dovuto</span>
                        <h2 className="mt-1 text-5xl font-black sm:text-6xl">{effectiveTotal.toFixed(2)} €</h2>
                        {loadedPendingOrder && (
                            <p className="mt-1 text-xs font-semibold text-blue-100">Codice ordine: {loadedPendingOrder.code}</p>
                        )}
                    </div>

                    <div className="space-y-4 p-4 sm:space-y-5 sm:p-5">
                        <>
                            {activeEvent?.settings?.askName && (
                                <div className="space-y-2">
                                    <Label htmlFor="checkout-customer-name" className="text-base font-bold">Nome Cliente</Label>
                                    <Input
                                        id="checkout-customer-name"
                                        value={customerName}
                                        onChange={(e) => setCustomerName(e.target.value)}
                                        placeholder="Inserisci nome cliente"
                                        className="h-11 rounded-lg text-base font-semibold"
                                    />
                                </div>
                            )}

                            {activeEvent?.settings?.askTable && (
                                <div className="space-y-3">
                                    <Label className="text-base font-bold">Tavolo</Label>
                                    <div className="rounded-lg bg-slate-100 py-1.5 text-center dark:bg-slate-800">
                                        <span className="text-3xl font-black text-blue-600 sm:text-4xl">{normalizedTableValue || "---"}</span>
                                    </div>
                                    {predefinedTables.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {predefinedTables.map((table) => {
                                                const isActive = normalizeTableValue(table) === normalizedTableValue
                                                return (
                                                    <button
                                                        key={table}
                                                        type="button"
                                                        onClick={() => setTableNumber(table)}
                                                        className={`rounded-md border-2 px-2.5 py-1.5 text-xs font-black transition-colors ${isActive ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}
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
                                        className="h-10 rounded-md border-2 font-semibold"
                                    />
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                            Tavolo selezionato: <span className="text-slate-800">{normalizedTableValue || "---"}</span>
                                        </p>
                                        <Button type="button" variant="outline" className="rounded-md px-3 py-1.5 text-sm font-bold" onClick={clearTableSelection}>
                                            RESET
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label className="text-base font-bold">Metodo di Pagamento</Label>
                                {(cashAvailable || cardAvailable) ? (
                                    <div className="flex gap-2">
                                        {cashAvailable && (
                                            <button
                                                onClick={() => setPaymentMethod("CASH")}
                                                className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border-2 p-3 transition-all ${effectivePaymentMethod === "CASH" ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200"}`}
                                            >
                                                <Banknote size={26} />
                                                <span className="text-sm font-bold">CONTANTI</span>
                                            </button>
                                        )}
                                        {cardAvailable && (
                                            <button
                                                onClick={() => setPaymentMethod("CARD")}
                                                className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border-2 p-3 transition-all ${effectivePaymentMethod === "CARD" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200"}`}
                                            >
                                                <Wallet size={26} />
                                                <span className="text-sm font-bold">CARTA / POS</span>
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm font-semibold text-amber-800">
                                        La postazione selezionata non ha metodi di pagamento configurati. Associa terminale e/o cassetta in impostazioni hardware.
                                    </p>
                                )}
                            </div>

                            <div className="flex gap-2 pt-2">
                                <Button
                                    variant="outline"
                                    className="flex-1 rounded-lg py-6 text-xl font-bold"
                                    onClick={() => handleCheckoutDialogOpenChange(false)}
                                    disabled={isProcessing}
                                >
                                    ANNULLA
                                </Button>
                                <Button
                                    className="flex-1 rounded-lg bg-green-600 py-6 text-xl font-bold hover:bg-green-700"
                                    onClick={() => void handleCheckout()}
                                    disabled={checkoutDisabled}
                                >
                                    {isProcessing ? <Loader2 className="animate-spin" /> : "CONFERMA"}
                                </Button>
                            </div>
                            {stockShortages.length > 0 ? (
                                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
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
                            <p className="mt-1 font-semibold">Aperta alle {formatSessionDateTime(closeCashSessionPreview?.openedAt || cashSession?.openedAt)}</p>
                            <p className="font-semibold">Fondo iniziale: {formatEuro(closeCashSessionPreview?.openingFloatAmount ?? cashSession?.openingFloatAmount ?? 0)}</p>
                        </div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                            <p className="text-xs font-black uppercase tracking-widest text-emerald-700">Contante atteso</p>
                            {isCloseCashSessionPreviewLoading ? (
                                <p className="mt-1 font-semibold text-emerald-700">Calcolo in corso...</p>
                            ) : closeCashSessionPreview ? (
                                <>
                                    <p className="mt-1 text-xl font-black text-emerald-700">
                                        {formatEuro(closeCashSessionPreview.expectedCashAmount)}
                                    </p>
                                    <p className="text-xs font-semibold text-emerald-700">
                                        Fondo + incassi in contanti (esclusi pagamenti elettronici)
                                    </p>
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-emerald-800">
                                        <p>Incasso contanti: {formatEuro(closeCashSessionPreview.cashSalesAmount)}</p>
                                        <p>Incasso elettronico: {formatEuro(closeCashSessionPreview.cardSalesAmount)}</p>
                                        <p>Incasso altro: {formatEuro(closeCashSessionPreview.otherSalesAmount)}</p>
                                        <p>Ordini saldati: {closeCashSessionPreview.paidOrdersCount}</p>
                                    </div>
                                </>
                            ) : (
                                <p className="mt-1 font-semibold text-emerald-700">Nessun dato disponibile.</p>
                            )}
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
                                disabled={isCashSessionActionLoading || isCloseCashSessionPreviewLoading}
                            >
                                ANNULLA
                            </Button>
                            <Button
                                type="button"
                                className="flex-1 rounded-xl bg-emerald-600 py-6 text-base font-black hover:bg-emerald-700"
                                onClick={() => void handleCloseCashSession()}
                                disabled={isCashSessionActionLoading || isCloseCashSessionPreviewLoading}
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
                onOpenChange={(open) => {
                    setFeedbackModal((prev) => ({ ...prev, open }))
                    if (!open) {
                        setRetryPrintsFeedback(null)
                        setIsRetryingFailedPrints(false)
                    }
                }}
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
                        <div className="flex items-center justify-end gap-3">
                            {feedbackModal.action?.type === "RETRY_FAILED_PRINTS" ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="rounded-xl px-6 font-bold"
                                    onClick={() => void handleRetryFailedPrintsFromModal()}
                                    disabled={isRetryingFailedPrints}
                                >
                                    {isRetryingFailedPrints ? "Reinvio..." : "Riprova stampa"}
                                </Button>
                            ) : null}
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
                        {retryPrintsFeedback ? (
                            <p className="text-sm font-semibold text-slate-600">{retryPrintsFeedback}</p>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Carica Ordine da Codice */}
            <Dialog open={isCodeDialogOpen} onOpenChange={handleCodeDialogOpenChange}>
                <DialogContent className="max-w-[680px] rounded-3xl p-0 overflow-hidden">
                    <DialogHeader className="border-b bg-slate-50 px-6 py-4 dark:bg-slate-900">
                        <DialogTitle className="flex items-center gap-3 text-xl font-black">
                            <Search className="h-5 w-5 text-indigo-600" />
                            Carica ordine da codice
                        </DialogTitle>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            Inserisci il numero ordine oppure seleziona uno degli ordini pendenti.
                        </p>
                    </DialogHeader>
                    <div className="space-y-4 p-5">
                        {/* Barra ricerca compatta */}
                        <div className="flex items-center gap-2">
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
                                className="h-11 flex-1 rounded-xl border-2 text-center text-xl font-black tracking-wide"
                            />
                            <Button
                                className="h-11 rounded-xl px-5 font-black bg-indigo-600 hover:bg-indigo-700"
                                onClick={() => void handleLoadOrderByCode()}
                                disabled={isCodeLoading || !orderCode.trim()}
                            >
                                {isCodeLoading ? <Loader2 className="animate-spin" size={18} /> : "Carica"}
                            </Button>
                            <Button
                                variant="outline"
                                className="h-11 rounded-xl px-3 font-bold"
                                onClick={() => void loadRecentPendingOrdersForDialog()}
                                disabled={isRecentOrdersLoading || isCodeLoading}
                            >
                                {isRecentOrdersLoading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                            </Button>
                        </div>

                        {/* Lista ordini pendenti — griglia 2 colonne */}
                        <div>
                            <h3 className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                <Clock3 size={12} />
                                Ultimi ordini pendenti
                            </h3>
                            {isRecentOrdersLoading ? (
                                <div className="flex h-20 items-center justify-center rounded-xl border border-dashed text-slate-400">
                                    <Loader2 className="animate-spin" />
                                </div>
                            ) : recentPendingOrders.length === 0 ? (
                                <div className="rounded-xl border border-dashed p-4 text-center text-sm font-semibold text-slate-500">
                                    Nessun ordine pendente disponibile.
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    {(() => {
                                        const oneHourAgo = (recentPendingOrdersReferenceTime ?? 0) - 60 * 60 * 1000
                                        const recentOrders = recentPendingOrders
                                            .filter(o => o.createdAt && new Date(o.createdAt).getTime() >= oneHourAgo)
                                            .sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime())
                                        const olderOrders = recentPendingOrders
                                            .filter(o => !o.createdAt || new Date(o.createdAt).getTime() < oneHourAgo)
                                            .sort((a, b) => {
                                                if (!a.createdAt) return 1
                                                if (!b.createdAt) return -1
                                                return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                                            })
                                        const sorted = [...recentOrders, ...olderOrders]
                                        return sorted.map((order) => {
                                            const isOlderThanOneHour = !order.createdAt || new Date(order.createdAt).getTime() < oneHourAgo
                                            return (
                                                <button
                                                    key={order.id}
                                                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-indigo-50 hover:border-indigo-200 dark:hover:bg-indigo-950/40 ${isOlderThanOneHour ? "bg-slate-50 border-slate-200 opacity-70 dark:bg-slate-900" : "bg-white border-slate-200 dark:bg-slate-800"}`}
                                                    onClick={() => void handleLoadOrderByCode(order.code)}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-bold uppercase text-slate-400">Ordine</span>
                                                            <span className="text-xl font-black text-indigo-700 dark:text-indigo-300">{order.code}</span>
                                                        </div>
                                                        <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                                                            {order.totalAmount.toFixed(2)} €
                                                        </span>
                                                    </div>
                                                    <div className="mt-0.5 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                                                        <span className="truncate">{order.customer?.name || "Cliente non indicato"}{order.customer?.table ? ` · T.${order.customer.table}` : ""}</span>
                                                        <span className="ml-1 shrink-0">{formatRecentOrderTime(order.createdAt)}</span>
                                                    </div>
                                                </button>
                                            )
                                        })
                                    })()}
                                </div>
                            )}
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
