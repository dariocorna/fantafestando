"use client"

import { useState, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react"
import { ShoppingCart, User, Banknote, Trash2, CheckCircle2, Loader2, Hash, Monitor, Search, X, RefreshCw, Clock3, Wallet, Check, Minus, Settings2, Printer, PackageOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    createOrder,
    loadPendingOrderByCode,
    completePendingOrderPayment,
    listPendingIngredientQueue,
    listRecentPendingOrders,
    getCashSessionStatus,
    openCashSession,
    closeCashSession,
    getCashSessionClosurePreview,
    retryFailedOrderPrintJobs,
    printProductIngredients
} from "./actions"
import { categoryColorWithAlpha, getCategoryTheme } from "@/lib/category-colors"
import { isTableValueValid, normalizeTableValue } from "@/lib/table-presets"
import { getStockLabel, getStockStatus, type StockShortage } from "@/lib/inventory"
import { resolveQuickDiscountPresetsFromSettings, type QuickDiscountPreset } from "@/lib/quick-discount-presets"
import { normalizePosCatalogLayout } from "@/lib/pos-catalog-layout"
import { FixedMenuConfigDialog, type FixedMenuChoiceGroupDto, type FixedMenuComponentDto } from "@/components/fixed-menu-config-dialog"
import { buildMenuConfigurationKey, type MenuSelectionInput } from "@/lib/fixed-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { buildProductQuantityMap, decrementProductQuantityInCart, replaceSingleCartUnit } from "@/lib/pos-cart"
import { buildCashReceivedSuggestions, formatCents, normalizeCashReceivedInput, toCents } from "@/lib/cash-change"
import { PosInlineStockEditor } from "@/components/pos-inline-stock-editor"

const POS_TOUCH_BREAKPOINT = 1024
const POS_PAYMENT_METHOD_STORAGE_PREFIX = "fantafestando_pos_payment_method:"

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
    volunteerPrice?: number | null
    categoryId: string
    kind?: "STANDARD" | "FIXED_MENU"
    requiresConfiguration?: boolean
    menuComponents?: FixedMenuComponentDto[]
    menuChoiceGroups?: FixedMenuChoiceGroupDto[]
    stockQuantity?: number | null
    isSoldOut?: boolean
    stockStatus?: "UNLIMITED" | "OK" | "LOW" | "OUT"
    variants?: Array<{ optionName: string; priceVariation: number; stockQuantity?: number | null }>
    recipeItems?: Array<{
        ingredientId: string
        name: string
        shortName?: string
        quantity: number
    }>
}

interface IIngredient {
    _id: string
    name: string
    shortName?: string
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
    volunteerPrice?: number | null
    quantity: number
    variants: string[]
    kind?: "STANDARD" | "FIXED_MENU"
    selectedOptions?: string[]
    menuSelections?: MenuSelectionInput[]
    customKitchenNotes?: string
    contextCustomNote?: string
    removedIngredientIds?: string[]
    addedIngredientIds?: string[]
    splitPrintPerUnit?: boolean
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
    pricingMode?: "STANDARD" | "VOLUNTEER"
    easterEggAttached?: boolean
    customer?: {
        name?: string
        table?: string
    }
    items: Array<{
        productId: string
        snapshotName: string
        quantity: number
        unitPrice: number
        volunteerPrice?: number
        customKitchenNotes?: string
        splitPrintPerUnit?: boolean
        selectedOptions?: Array<{ name: string, priceVariation: number }>
        menuSelections?: Array<{ groupId: string, productId: string }>
    }>
}

interface CartContextDraft {
    removedIngredientIds: string[]
    addedIngredientIds: string[]
    customNote: string
    splitPrintPerUnit: boolean
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

interface PendingIngredientQueueItem {
    ingredientKey: string
    label: string
    quantity: number
    orderCount: number
    legacy: boolean
    stockQuantity?: number | null
    remainingStockQuantity?: number | null
    active?: boolean
}

interface OpenCashSessionState {
    id: string
    openedAt: string
    openingFloatAmount: number
    openingNotes?: string
    isTest: boolean
    closeFailedError?: string
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
        orderId: string
        failedPrinters: FailedPrinterGroupState[]
    }
}

interface FailedPrinterGroupState {
    key: string
    name: string
    error?: string
    count: number
    jobIds: string[]
}

interface PrintDispatchSummaryState {
    attempted: number
    succeeded: number
    failed: number
    allSuccessful: boolean
    failedPrinters: FailedPrinterGroupState[]
}

function getCurrentEpochMs() {
    return Date.now()
}

function toPendingIngredientTestId(key: string) {
    return key.replace(/[^a-zA-Z0-9-]+/g, "-")
}

function getPeripheralRef(value: IPosDevice["paymentTerminalId"] | IPosDevice["cashBoxId"]) {
    if (!value || typeof value !== "object") return null
    return value
}

type ProductCardVariant = "mobile" | "modern" | "compact"

function resolveProductPriceLabel(product: IProduct, useVolunteerPrice: boolean) {
    const effectivePrice = useVolunteerPrice && typeof product.volunteerPrice === "number"
        ? product.volunteerPrice
        : product.basePrice
    return useVolunteerPrice && typeof product.volunteerPrice === "number"
        ? `Vol. ${effectivePrice.toFixed(2)} €`
        : `${effectivePrice.toFixed(2)} €`
}

interface PosProductCardProps {
    product: IProduct
    displayName: string
    quantity: number
    stockStatus: "UNLIMITED" | "OK" | "LOW" | "OUT"
    stockLabel: string
    showStockPill: boolean
    variant: ProductCardVariant
    showTouchDecrement: boolean
    useVolunteerPrice: boolean
    borderColor: string
    backgroundColor: string
    minHeight?: string
    boxShadow?: string
    onAdd: (product: IProduct) => void
    onDecrement: (product: IProduct) => void
}

function PosProductCard({
    product,
    displayName,
    quantity,
    stockStatus,
    stockLabel,
    showStockPill,
    variant,
    showTouchDecrement,
    useVolunteerPrice,
    borderColor,
    backgroundColor,
    minHeight,
    boxShadow,
    onAdd,
    onDecrement,
}: PosProductCardProps) {
    const hasQuantity = quantity > 0
    const shouldShowTouchDecrement = showTouchDecrement && hasQuantity
    const usesDesktopQuantityControl = variant !== "mobile" && shouldShowTouchDecrement
    const quantityControlInset = Math.max(56, 40 + String(quantity).length * 10)
    const priceLabel = resolveProductPriceLabel(product, useVolunteerPrice)
    const instructionsId = "pos-product-card-instructions"
    const addLabel = `${displayName}, ${priceLabel}, quantita nel carrello ${quantity}. Aggiungi una unita`
    const decrementLabel = `Rimuovi una unità di ${displayName}. Quantità nel carrello ${quantity}`
    const stockPillClass = `inline-flex w-fit rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${stockStatus === "OUT"
        ? "bg-red-100 text-red-700"
        : "bg-amber-100 text-amber-700"
        }`
    const badge = hasQuantity && !usesDesktopQuantityControl ? (
        <span
            className={`absolute right-2 top-2 z-10 inline-flex items-center justify-center rounded-xl border-2 border-white bg-[var(--brand-blue-700)] font-black leading-none text-white shadow-md tabular-nums ${variant === "compact"
                ? "h-11 min-w-12 px-2 text-lg"
                : "min-h-10 min-w-10 px-3 text-lg"
                }`}
            data-testid={`pos-product-quantity-${product._id}`}
            aria-hidden="true"
        >
            {quantity}
        </span>
    ) : null

    const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
        if (!hasQuantity) return
        event.preventDefault()
        const pointerType = (event.nativeEvent as globalThis.MouseEvent & { pointerType?: string }).pointerType
        if (pointerType === "touch") return
        onDecrement(product)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!hasQuantity) return
        if (event.key !== "Delete" && event.key !== "-") return
        event.preventDefault()
        onDecrement(product)
    }

    const decrementButton = shouldShowTouchDecrement ? (
        <button
            type="button"
            aria-label={decrementLabel}
            title={decrementLabel}
            data-testid={`pos-product-decrement-${product._id}`}
            onClick={(event) => {
                event.stopPropagation()
                onDecrement(product)
            }}
            className={variant === "mobile"
                ? "absolute bottom-3 right-3 z-20 inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-xl border-2 border-white bg-white px-2.5 text-sm font-black text-red-700 shadow-lg ring-1 ring-red-200 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                : "absolute right-2 top-2 z-20 inline-flex h-11 min-w-12 flex-col items-center justify-center rounded-xl border-2 border-white bg-red-700 px-2 font-black leading-none text-white shadow-lg ring-1 ring-red-300 transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            }
        >
            {variant === "mobile" ? (
                <>
                    <Minus size={18} strokeWidth={3} />
                    <span className="text-xs">-1</span>
                </>
            ) : (
                <>
                    <span className="text-xs leading-none">-1</span>
                    <span className="text-lg leading-none tabular-nums">{quantity}</span>
                </>
            )}
        </button>
    ) : null

    if (variant === "mobile") {
        return (
            <div className="relative">
                <button
                    type="button"
                    aria-label={addLabel}
                    aria-describedby={instructionsId}
                    onClick={() => onAdd(product)}
                    onContextMenu={handleContextMenu}
                    onKeyDown={handleKeyDown}
                    data-testid={`pos-product-${product._id}`}
                    className="flex w-full flex-col gap-3 overflow-hidden rounded-3xl border-2 px-4 py-4 text-left shadow-sm transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue-700)]"
                    style={{
                        borderColor,
                        backgroundColor,
                    }}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="line-clamp-2 min-h-10 text-lg font-black leading-tight text-slate-900">
                                {displayName}
                            </p>
                            {product.requiresConfiguration ? (
                                <span className="mt-2 inline-flex w-fit rounded-sm bg-white/85 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">
                                    Configura
                                </span>
                            ) : null}
                        </div>
                        <span
                            className="inline-flex min-w-[88px] shrink-0 justify-center rounded-xl border bg-white/90 px-3 py-2 text-lg font-black leading-none"
                            style={{
                                color: borderColor,
                                borderColor,
                            }}
                        >
                            {priceLabel}
                        </span>
                    </div>
                    <div className={`flex min-h-11 items-center justify-between gap-2 ${shouldShowTouchDecrement ? "pr-14" : ""}`}>
                        {showStockPill ? (
                            <span
                                className={`inline-flex w-fit rounded-full px-2 py-1 text-[10px] font-bold ${stockStatus === "OUT"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-amber-100 text-amber-700"
                                    }`}
                            >
                                {stockLabel}
                            </span>
                        ) : (
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                                Tocca per aggiungere
                            </span>
                        )}
                        {hasQuantity ? (
                            <span
                                className="ml-auto inline-flex min-h-10 items-center rounded-xl bg-[var(--brand-blue-700)] px-4 text-lg font-black text-white"
                                data-testid={`pos-product-quantity-${product._id}`}
                            >
                                Nel carrello: {quantity}
                            </span>
                        ) : (
                            <span className="text-sm font-bold uppercase tracking-[0.08em] text-slate-600">
                                Aggiungi
                            </span>
                        )}
                    </div>
                </button>
                {decrementButton}
            </div>
        )
    }

    if (variant === "modern") {
        return (
            <div className="relative">
                {badge}
                <button
                    type="button"
                    aria-label={addLabel}
                    aria-describedby={instructionsId}
                    onClick={() => onAdd(product)}
                    onContextMenu={handleContextMenu}
                    onKeyDown={handleKeyDown}
                    data-testid={`pos-product-${product._id}`}
                    className="group relative flex min-h-[136px] w-full flex-col overflow-hidden border-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(15,23,42,0.12)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue-700)]"
                    style={{ borderColor }}
                >
                    <div
                        className="flex flex-1 flex-col gap-2 px-2.5 py-2.5"
                        style={{ backgroundColor }}
                    >
                        <p
                            className="line-clamp-2 min-h-10 text-lg font-black leading-tight text-slate-900"
                            style={hasQuantity ? { paddingRight: quantityControlInset } : undefined}
                        >
                            {displayName}
                        </p>
                        {product.requiresConfiguration ? (
                            <span className="inline-flex w-fit rounded-sm bg-white/85 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">
                                Configura
                            </span>
                        ) : null}
                        <div className="mt-auto flex items-end justify-between gap-2">
                            {showStockPill ? (
                                <span className={stockPillClass}>
                                    {stockLabel}
                                </span>
                            ) : (
                                <span />
                            )}
                            <span
                                className="inline-flex min-w-[96px] justify-center border px-2 py-1 text-lg font-black leading-none"
                                style={{
                                    color: borderColor,
                                    borderColor,
                                    backgroundColor: "rgba(255, 255, 255, 0.88)",
                                }}
                            >
                                {priceLabel}
                            </span>
                        </div>
                    </div>
                </button>
                {decrementButton}
            </div>
        )
    }

    return (
        <div className="relative">
            {badge}
            <button
                type="button"
                aria-label={addLabel}
                aria-describedby={instructionsId}
                onClick={() => onAdd(product)}
                onContextMenu={handleContextMenu}
                onKeyDown={handleKeyDown}
                data-testid={`pos-product-${product._id}`}
                className="flex w-full flex-col items-center justify-center border px-1.5 py-1 text-center transition-all hover:brightness-90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue-700)]"
                style={{
                    borderColor,
                    borderWidth: "2px",
                    minHeight,
                    backgroundColor,
                    boxShadow,
                }}
            >
                <p
                    className="mx-auto line-clamp-2 min-h-10 w-full max-w-[96%] text-center text-[clamp(16px,1vw,20px)] font-black leading-tight text-slate-800"
                    style={hasQuantity ? { paddingRight: quantityControlInset } : undefined}
                >
                    {displayName}
                </p>
                {product.requiresConfiguration ? (
                    <span className="mx-auto inline-flex w-fit rounded-sm bg-white/85 px-1 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600">
                        Configura
                    </span>
                ) : null}
                {showStockPill ? (
                    <span className={stockPillClass}>
                        {stockLabel}
                    </span>
                ) : null}
            </button>
            {decrementButton}
        </div>
    )
}

export default function PosPage() {
    const [cart, setCart] = useState<CartItem[]>([])
    const [categories, setCategories] = useState<ICategory[]>([])
    const [activeCategory, setActiveCategory] = useState<string | null>(null)
    const [products, setProducts] = useState<IProduct[]>([])
    const [ingredients, setIngredients] = useState<IIngredient[]>([])
    const [activeEvent, setActiveEvent] = useState<IEvent | null>(null)
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
    const [isDiscountSheetOpen, setIsDiscountSheetOpen] = useState(false)
    const [isStockMode, setIsStockMode] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [isCheckoutOutcomeUnknown, setIsCheckoutOutcomeUnknown] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CARD">("CASH")
    const [cashReceivedInput, setCashReceivedInput] = useState("")
    const [isCashKeypadExpanded, setIsCashKeypadExpanded] = useState(false)
    const [posDevices, setPosDevices] = useState<IPosDevice[]>([])
    const [selectedPosDeviceId, setSelectedPosDeviceId] = useState<string | null>(null)
    const [isPosSelectorOpen, setIsPosSelectorOpen] = useState(false)

    const [isCodeDialogOpen, setIsCodeDialogOpen] = useState(false)
    const [isPendingOrdersSheetOpen, setIsPendingOrdersSheetOpen] = useState(false)
    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false)
    const [isCashStatusSheetOpen, setIsCashStatusSheetOpen] = useState(false)
    const [orderCode, setOrderCode] = useState("")
    const [pendingOrderLoadRequest, setPendingOrderLoadRequest] = useState<{ code: string } | null>(null)
    const [isCodeLoading, setIsCodeLoading] = useState(false)
    const [loadedPendingOrder, setLoadedPendingOrder] = useState<LoadedPendingOrder | null>(null)
    const [recentPendingOrders, setRecentPendingOrders] = useState<RecentPendingOrder[]>([])
    const [pendingIngredientQueue, setPendingIngredientQueue] = useState<PendingIngredientQueueItem[]>([])
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
    const [retryingPrinterKey, setRetryingPrinterKey] = useState<string | null>(null)
    const [retryPrintsFeedback, setRetryPrintsFeedback] = useState<string | null>(null)
    const [configuringProduct, setConfiguringProduct] = useState<IProduct | null>(null)
    const [contextLineId, setContextLineId] = useState<string | null>(null)
    const [contextDraft, setContextDraft] = useState<CartContextDraft>({
        removedIngredientIds: [],
        addedIngredientIds: [],
        customNote: "",
        splitPrintPerUnit: false
    })
    const [contextPrintFeedback, setContextPrintFeedback] = useState<string | null>(null)
    const [isPrintingContextIngredients, setIsPrintingContextIngredients] = useState(false)
    const contextLineSequenceRef = useRef(0)
    const [hasCoarsePointer, setHasCoarsePointer] = useState(false)
    const [cartAnnouncement, setCartAnnouncement] = useState("")
    const [isVolunteerMode, setIsVolunteerMode] = useState(false)
    const isMobilePos = useIsMobile(POS_TOUCH_BREAKPOINT)

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
                setIngredients(data.ingredients || [])
                setPosDevices(data.posDevices)

                // Check localStorage for POS Device
                const savedPosId = localStorage.getItem('fantafestando_pos_id')
                const isSavedPosValid = savedPosId && data.posDevices.some((d: IPosDevice) => d._id === savedPosId)
                if (isSavedPosValid) {
                    const savedPaymentMethod = localStorage.getItem(`${POS_PAYMENT_METHOD_STORAGE_PREFIX}${savedPosId}`)
                    if (savedPaymentMethod === "CASH" || savedPaymentMethod === "CARD") {
                        setPaymentMethod(savedPaymentMethod)
                    }
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

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return

        const query = window.matchMedia("(pointer: coarse)")
        const updatePointerMode = () => setHasCoarsePointer(query.matches)
        updatePointerMode()
        query.addEventListener("change", updatePointerMode)

        return () => query.removeEventListener("change", updatePointerMode)
    }, [])

    const selectPosDevice = (id: string) => {
        const savedPaymentMethod = localStorage.getItem(`${POS_PAYMENT_METHOD_STORAGE_PREFIX}${id}`)
        const selectedDevice = posDevices.find((device) => device._id === id)
        setPaymentMethod(
            savedPaymentMethod === "CASH" || savedPaymentMethod === "CARD"
                ? savedPaymentMethod
                : getPeripheralRef(selectedDevice?.cashBoxId) ? "CASH" : "CARD"
        )
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
    const cardAvailable = Boolean(selectedPaymentTerminal) && !(cashSession?.isTest && selectedPaymentTerminal?.type === "SUMUP")

    const effectivePaymentMethod: "CASH" | "CARD" =
        paymentMethod === "CASH" && !cashAvailable && cardAvailable
            ? "CARD"
            : paymentMethod === "CARD" && !cardAvailable && cashAvailable
                ? "CASH"
                : paymentMethod

    const quickDiscountPresets = resolveQuickDiscountPresetsFromSettings(activeEvent?.settings)
    const productCartItems = cart.filter((item) => !item.isDiscount)
    const discountCartItems = cart.filter((item) => item.isDiscount)
    const getCartItemUnitPrice = (item: CartItem) => (
        isVolunteerMode && typeof item.volunteerPrice === "number" ? item.volunteerPrice : item.price
    )
    const standardSubtotal = Number(
        productCartItems.reduce((acc: number, item: CartItem) => acc + (item.price * item.quantity), 0).toFixed(2)
    )
    const subtotal = Number(
        productCartItems.reduce((acc: number, item: CartItem) => acc + (getCartItemUnitPrice(item) * item.quantity), 0).toFixed(2)
    )
    const liveDiscountsByLineId = new Map<string, { amount: number, baseAmount: number }>()
    let remainingDiscountBase = subtotal
    discountCartItems.forEach((item) => {
        const preset = item.discountPreset
        const requestedAmount = !preset
            ? item.price * -1
            : preset.type === "PERCENT"
                ? remainingDiscountBase * (preset.value / 100)
                : preset.value
        const amount = Number(Math.min(remainingDiscountBase, Math.max(0, requestedAmount)).toFixed(2))
        liveDiscountsByLineId.set(item.lineId, { amount, baseAmount: remainingDiscountBase })
        remainingDiscountBase = Number(Math.max(0, remainingDiscountBase - amount).toFixed(2))
    })
    const computeLiveDiscountAmount = (item: CartItem) => liveDiscountsByLineId.get(item.lineId)?.amount ?? 0
    const totalDiscountRequested = Number(
        Math.max(0, discountCartItems.reduce((acc: number, item: CartItem) => acc + computeLiveDiscountAmount(item), 0)).toFixed(2)
    )
    const totalDiscountApplied = isVolunteerMode ? 0 : Number(Math.min(subtotal, totalDiscountRequested).toFixed(2))
    const effectiveTotal = Number(Math.max(0, subtotal - totalDiscountApplied).toFixed(2))
    const volunteerDiscountApplied = Number(Math.max(0, standardSubtotal - subtotal).toFixed(2))
    const orderDiscountsPayload = totalDiscountApplied > 0
        ? discountCartItems.flatMap((item) => {
            if (item.discountPreset) {
                return [{
                    type: item.discountPreset.type,
                    value: item.discountPreset.value,
                    label: item.discountPreset.label
                }]
            }
            const value = computeLiveDiscountAmount(item)
            return value > 0 ? [{ type: "FIXED" as const, value, label: item.name || "Sconto carrello" }] : []
        })
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

    const isSameDiscountPreset = (item: CartItem, preset: QuickDiscountPreset) =>
        item.isDiscount
        && item.discountPreset?.label === preset.label
        && item.discountPreset?.type === preset.type
        && item.discountPreset?.value === preset.value

    const normalizedTableValue = normalizeTableValue(tableNumber)
    const tableValueValid = isTableValueValid(tableNumber)
    const isTableRequiredInvalid = Boolean(activeEvent?.settings?.askTable) && !tableValueValid
    const hasActiveCheckoutDraft = cart.length > 0
        || Boolean(customerName.trim())
        || Boolean(normalizedTableValue)
        || Boolean(loadedPendingOrder)
    const predefinedTables = activeEvent?.predefinedTables || []
    const isModernCatalogLayout = normalizePosCatalogLayout(activeEvent?.settings?.posCatalogLayout) === "MODERN_TABS"
    const selectedModernCategoryId = activeCategory && categories.some((category) => category._id === activeCategory)
        ? activeCategory
        : (categories[0]?._id ?? null)
    const productsByCategory = categories.reduce<Record<string, IProduct[]>>((acc, category) => {
        acc[category._id] = products.filter((product) => product.categoryId === category._id)
        return acc
    }, {})
    const compactCategoryGroups = useMemo(() => {
        const maxProductsPerCombinedColumn = 8
        const shortCategoryProductLimit = 3
        const groups: ICategory[][] = []

        for (let index = 0; index < categories.length; index += 1) {
            const category = categories[index]
            const categoryProductsCount = products.filter((product) => product.categoryId === category._id).length
            const nextCategory = categories[index + 1]
            const nextCategoryProductsCount = nextCategory
                ? products.filter((product) => product.categoryId === nextCategory._id).length
                : 0

            if (
                nextCategory
                && categoryProductsCount <= shortCategoryProductLimit
                && categoryProductsCount + nextCategoryProductsCount <= maxProductsPerCombinedColumn
            ) {
                groups.push([category, nextCategory])
                index += 1
            } else {
                groups.push([category])
            }
        }

        return groups
    }, [categories, products])
    const categoryColumnsCount = Math.max(compactCategoryGroups.length, 1)
    const selectedModernCategory = selectedModernCategoryId
        ? categories.find((category) => category._id === selectedModernCategoryId) || null
        : null
    const selectedModernCategoryProducts = selectedModernCategoryId
        ? productsByCategory[selectedModernCategoryId] || []
        : []
    const selectedModernCategoryTheme = getCategoryTheme(selectedModernCategory?.uiColor)
    const productQuantityById = useMemo(() => buildProductQuantityMap(cart), [cart])
    const showTouchDecrementControls = Boolean(isMobilePos) || hasCoarsePointer
    const resolveProductDisplayName = (product: IProduct) => product.shortName?.trim() || product.name
    const resolveIngredientLabel = (ingredient: { name: string, shortName?: string }) => ingredient.shortName?.trim() || ingredient.name
    const contextItem = contextLineId ? cart.find((item) => item.lineId === contextLineId && !item.isDiscount) || null : null
    const contextProduct = contextItem ? products.find((product) => product._id === contextItem.productId) || null : null
    const contextRecipeIngredientIds = new Set((contextProduct?.recipeItems || []).map((entry) => entry.ingredientId))
    const contextExtraIngredients = ingredients.filter((ingredient) => !contextRecipeIngredientIds.has(ingredient._id))
    const getAdaptiveProductRowMinHeight = (productsCount: number): string => {
        const safeCount = Math.max(productsCount, 1)
        const gapPx = 6 // space-y-1.5
        const reservedVerticalPx = 120

        // Viewport-based adaptive sizing per column:
        // - grows on tall screens
        // - shrinks automatically on smaller heights
        // - never explodes or collapses thanks to clamp bounds.
        return `clamp(38px, calc((100dvh - ${reservedVerticalPx}px - ${(safeCount - 1) * gapPx}px) / ${safeCount}), 96px)`
    }

    const buildCartLineMergeKey = (item: CartItem) => JSON.stringify({
        productId: item.productId,
        price: item.price,
        volunteerPrice: item.volunteerPrice ?? null,
        kind: item.kind || "STANDARD",
        selectedOptions: item.selectedOptions || [],
        menuSelections: item.menuSelections || [],
        customKitchenNotes: item.customKitchenNotes || "",
        splitPrintPerUnit: Boolean(item.splitPrintPerUnit)
    })

    const buildContextKitchenNotes = (draft: CartContextDraft, product?: IProduct | null) => {
        const recipeById = new Map((product?.recipeItems || []).map((entry) => [entry.ingredientId, resolveIngredientLabel(entry)]))
        const ingredientById = new Map(ingredients.map((ingredient) => [ingredient._id, resolveIngredientLabel(ingredient)]))
        const removedNames = draft.removedIngredientIds
            .map((id) => recipeById.get(id) || ingredientById.get(id))
            .filter((name): name is string => Boolean(name))
        const addedNames = draft.addedIngredientIds
            .map((id) => ingredientById.get(id))
            .filter((name): name is string => Boolean(name))
        return [
            removedNames.length > 0 ? `Senza ${removedNames.join(", ")}` : "",
            addedNames.length > 0 ? `Aggiungi ${addedNames.join(", ")}` : "",
            draft.customNote.trim()
        ].filter(Boolean).join(" · ")
    }

    const addConfiguredToCart = (
        product: IProduct,
        options?: {
            menuSelections?: MenuSelectionInput[]
            selectedOptionLabels?: string[]
        }
    ) => {
        if (isStockMode) return
        const displayName = resolveProductDisplayName(product)
        const nextQuantity = (productQuantityById.get(product._id) ?? 0) + 1
        setCart((prev: CartItem[]) => {
            const configurationKey = buildMenuConfigurationKey(options?.menuSelections || [])
            const lineId = configurationKey ? `${product._id}:${configurationKey}` : product._id
            const existing = prev.find((i: CartItem) => !i.isDiscount && i.lineId === lineId)
            if (existing) {
                return prev.map((i: CartItem) => i.lineId === existing.lineId ? { ...i, quantity: i.quantity + 1 } : i)
            }
            return [...prev, {
                lineId,
                productId: product._id,
                name: resolveProductDisplayName(product),
                price: product.basePrice,
                volunteerPrice: product.volunteerPrice ?? null,
                quantity: 1,
                variants: [],
                kind: product.kind || "STANDARD",
                selectedOptions: options?.selectedOptionLabels || [],
                menuSelections: options?.menuSelections || [],
            }]
        })
        setCartAnnouncement(`Aggiunto ${displayName}, quantita ${nextQuantity}`)
    }

    const openCartItemContext = (item: CartItem) => {
        if (isStockMode) return
        setContextLineId(item.lineId)
        setContextPrintFeedback(null)
        setContextDraft({
            removedIngredientIds: item.removedIngredientIds || [],
            addedIngredientIds: item.addedIngredientIds || [],
            customNote: item.contextCustomNote ?? "",
            splitPrintPerUnit: Boolean(item.splitPrintPerUnit)
        })
    }

    const updateContextArray = (key: "removedIngredientIds" | "addedIngredientIds", ingredientId: string, checked: boolean) => {
        setContextDraft((prev) => ({
            ...prev,
            [key]: checked
                ? [...prev[key], ingredientId].filter((id, index, ids) => ids.indexOf(id) === index)
                : prev[key].filter((id) => id !== ingredientId)
        }))
    }

    const applyCartItemContext = () => {
        if (isStockMode || !contextItem) return
        const contextNotes = buildContextKitchenNotes(contextDraft, contextProduct)
        contextLineSequenceRef.current += 1
        const editedItem: CartItem = {
            ...contextItem,
            // Sempre un lineId dedicato: una riga personalizzata non deve poter essere ri-aggregata
            // da un successivo tap sul prodotto (addConfiguredToCart fonde per lineId).
            lineId: `${contextItem.productId}:ctx-${contextLineSequenceRef.current}`,
            quantity: 1,
            removedIngredientIds: contextDraft.removedIngredientIds,
            addedIngredientIds: contextDraft.addedIngredientIds,
            contextCustomNote: contextDraft.customNote.trim() || undefined,
            customKitchenNotes: contextNotes || undefined,
            splitPrintPerUnit: contextDraft.splitPrintPerUnit || undefined
        }

        setCart((prev) => replaceSingleCartUnit(prev, contextItem.lineId, editedItem, buildCartLineMergeKey))
        setContextLineId(null)
    }

    const handlePrintContextIngredients = async () => {
        if (!activeEventId || !selectedPosDeviceId || !contextItem) {
            setContextPrintFeedback("Seleziona una cassa prima di stampare gli ingredienti")
            return
        }

        setIsPrintingContextIngredients(true)
        const result = await printProductIngredients({
            eventId: activeEventId,
            posDeviceId: selectedPosDeviceId,
            productId: contextItem.productId,
            removedIngredientIds: contextDraft.removedIngredientIds,
            addedIngredientIds: contextDraft.addedIngredientIds,
            customNote: contextDraft.customNote
        })
        setIsPrintingContextIngredients(false)

        if (!result.success) {
            setContextPrintFeedback(result.error || "Stampa ingredienti non riuscita")
            return
        }

        setContextPrintFeedback("Ingredienti inviati alla stampante della cassa")
    }

    const addToCart = (product: IProduct) => {
        if (isStockMode) return
        if (product.requiresConfiguration) {
            setConfiguringProduct(product)
            return
        }
        addConfiguredToCart(product)
    }

    const decrementProductFromCatalog = (product: IProduct) => {
        if (isStockMode) return
        const currentQuantity = productQuantityById.get(product._id) ?? 0
        if (currentQuantity <= 0) return

        const nextQuantity = Math.max(0, currentQuantity - 1)
        const displayName = resolveProductDisplayName(product)
        setCart((prev: CartItem[]) => decrementProductQuantityInCart(
            prev,
            product._id,
            (item) => Boolean(item.customKitchenNotes) || Boolean(item.splitPrintPerUnit)
        ))
        setCartAnnouncement(`Rimosso ${displayName}, quantita ${nextQuantity}`)
    }

    const addDiscountPresetToCart = (preset: QuickDiscountPreset) => {
        if (isStockMode) return
        if (isVolunteerMode) {
            showFeedbackModal("Disattiva la modalità volontari prima di applicare altri sconti", "info")
            return
        }
        if (productCartItems.length === 0) {
            showFeedbackModal("Aggiungi prima almeno un prodotto al carrello")
            return
        }

        if (discountCartItems.some((item) => isSameDiscountPreset(item, preset))) {
            showFeedbackModal("Questo sconto è già applicato al carrello", "info")
            return
        }

        const discountAmount = computePresetDiscountAmount(preset, discountBaseAmount)
        if (discountAmount <= 0) {
            showFeedbackModal("Nessun importo disponibile da scontare")
            return
        }

        setCart((prev: CartItem[]) => {
            if (prev.some((item) => isSameDiscountPreset(item, preset))) return prev

            const nextDiscountSequence = prev.reduce((max, item) => {
                if (!item.isDiscount) return max
                const match = item.lineId.match(/^discount-line-(\d+)$/)
                return match ? Math.max(max, Number(match[1])) : max
            }, 0) + 1
            const lineId = `discount-line-${nextDiscountSequence}`

            return [
                ...prev,
                {
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
            ]
        })
    }

    const removeFromCart = (lineId: string) => {
        if (isStockMode) return
        setCart((prev: CartItem[]) => prev.filter((i: CartItem) => i.lineId !== lineId))
    }

    const increaseCartItemQuantity = (lineId: string) => {
        if (isStockMode) return
        setCart((prev: CartItem[]) => prev.map((item) => (
            item.lineId === lineId && !item.isDiscount
                ? { ...item, quantity: item.quantity + 1 }
                : item
        )))
    }

    const decreaseCartItemQuantity = (lineId: string) => {
        if (isStockMode) return
        setCart((prev: CartItem[]) => prev.map((item) => {
            if (item.lineId !== lineId || item.isDiscount) return item
            if (item.quantity <= 1) return item
            return { ...item, quantity: item.quantity - 1 }
        }))
    }

    const resetPendingOrder = () => {
        if (isStockMode) return
        setLoadedPendingOrder(null)
        setOrderCode("")
    }

    const resetCheckoutForm = (nextPaymentMethod?: "CASH" | "CARD") => {
        setCart([])
        setCustomerName("")
        setTableNumber("")
        setPaymentMethod(nextPaymentMethod ?? (cashAvailable ? "CASH" : "CARD"))
        setCashReceivedInput("")
        setIsCashKeypadExpanded(false)
        setIsVolunteerMode(false)
    }

    const loadRecentPendingOrdersForDialog = async () => {
        if (!activeEventId) return

        setIsRecentOrdersLoading(true)
        const [ordersResult, ingredientQueueResult] = await Promise.all([
            listRecentPendingOrders({ eventId: activeEventId, limit: 10 }),
            listPendingIngredientQueue({ eventId: activeEventId, limit: 12 })
        ])
        const loadedAt = getCurrentEpochMs()
        if (ordersResult.success) {
            setRecentPendingOrders(ordersResult.orders)
        } else {
            setRecentPendingOrders([])
        }
        if (ingredientQueueResult.success) {
            setPendingIngredientQueue(ingredientQueueResult.items)
        } else {
            setPendingIngredientQueue([])
        }
        setRecentPendingOrdersReferenceTime(loadedAt)
        setIsRecentOrdersLoading(false)
    }

    const openPendingOrdersSurface = () => {
        if (isStockMode) return
        setIsPendingOrdersSheetOpen(true)
        void loadRecentPendingOrdersForDialog()
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

    const cashReceivedHasValue = cashReceivedInput.trim().length > 0
    const cashReceivedAmount = cashReceivedHasValue ? parseAmountInput(cashReceivedInput) : null
    const effectiveTotalCents = toCents(effectiveTotal)
    const cashReceivedCents = cashReceivedAmount === null ? null : toCents(cashReceivedAmount)
    const cashChangeCents = cashReceivedCents !== null && cashReceivedCents >= effectiveTotalCents
        ? cashReceivedCents - effectiveTotalCents
        : null
    const cashMissingCents = cashReceivedCents !== null && cashReceivedCents < effectiveTotalCents
        ? effectiveTotalCents - cashReceivedCents
        : null
    const cashReceivedError = cashReceivedHasValue && cashReceivedAmount === null
        ? "Importo ricevuto non valido"
        : cashMissingCents !== null
            ? `Mancano ${formatCents(cashMissingCents)}`
            : null
    const cashPaymentBlocked = effectivePaymentMethod === "CASH" && Boolean(cashReceivedError)
    const cashReceivedSuggestions = buildCashReceivedSuggestions(effectiveTotal)
    const setCashReceivedFromCents = (amountCents: number) => setCashReceivedInput((amountCents / 100).toFixed(2).replace(".", ","))
    const appendCashReceivedKey = (key: string) => {
        setCashReceivedInput((current) => normalizeCashReceivedInput(`${current}${key}`))
    }

    useEffect(() => {
        if (!isCheckoutOpen || effectivePaymentMethod !== "CASH") return
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (target?.matches("input, textarea, select, [contenteditable='true']")) return
            if (/^[0-9]$/.test(event.key)) {
                event.preventDefault()
                setCashReceivedInput((current) => normalizeCashReceivedInput(`${current}${event.key}`))
            } else if (event.key === "," || event.key === ".") {
                event.preventDefault()
                setCashReceivedInput((current) => normalizeCashReceivedInput(`${current},`))
            } else if (event.key === "Backspace") {
                event.preventDefault()
                setCashReceivedInput((current) => current.slice(0, -1))
            } else if (event.key === "Delete" || event.key.toLowerCase() === "c") {
                event.preventDefault()
                setCashReceivedInput("")
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [effectivePaymentMethod, isCheckoutOpen])

    const handleStockUpdated = (updated: {
        id: string
        stockQuantity: number | null
        isSoldOut: boolean
        stockStatus: "UNLIMITED" | "OK" | "LOW" | "OUT"
        variants: Array<{ optionName: string; priceVariation: number; stockQuantity: number | null }>
    }) => {
        setProducts((current) => current.map((product) => product._id === updated.id
            ? { ...product, ...updated, _id: product._id }
            : product))
    }

    const toggleStockMode = () => {
        if (isCashSessionActionLoading || isCloseCashSessionPreviewLoading) return
        const nextStockMode = !isStockMode
        if (nextStockMode) {
            setIsCheckoutOpen(false)
            setConfiguringProduct(null)
            setContextLineId(null)
            setIsDiscountSheetOpen(false)
            setIsCodeDialogOpen(false)
            setIsPendingOrdersSheetOpen(false)
            setIsCashStatusSheetOpen(false)
            setIsOpenCashDialogOpen(false)
            setIsCloseCashDialogOpen(false)
        }
        setIsStockMode(nextStockMode)
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
        setRetryingPrinterKey(null)
    }

    const buildPrintFailureMessage = (summary?: PrintDispatchSummaryState) => {
        if (!summary || summary.failed === 0) return null
        const printers = summary.failedPrinters.map((printer) => printer.name).join(", ")
        return `Pagamento registrato, ma ${summary.failed} stampe sono fallite${printers ? ` su: ${printers}` : ""}.`
    }

    const handleRetryFailedPrintsFromModal = async (printer: FailedPrinterGroupState) => {
        const action = feedbackModal.action
        if (!action || action.type !== "RETRY_FAILED_PRINTS") return

        setRetryingPrinterKey(printer.key)
        setRetryPrintsFeedback(null)
        const result = await retryFailedOrderPrintJobs({
            orderId: action.orderId,
            jobIds: printer.jobIds
        })
        setRetryingPrinterKey(null)

        if (!result.success) {
            setRetryPrintsFeedback(result.error || "Reinvio non riuscito")
            return
        }

        if (result.attempted === 0) {
            setRetryPrintsFeedback("Nessun job fallito da reinviare per questo ordine.")
        } else if (result.retried === 0) {
            setRetryPrintsFeedback(`Reinvio non riuscito: 0/${result.attempted} job inviati.`)
        } else if (result.failed > 0) {
            setRetryPrintsFeedback(`Reinvio completato parzialmente: ${result.retried}/${result.attempted} inviati.`)
        } else {
            setRetryPrintsFeedback(`Reinvio completato: ${result.retried}/${result.attempted} job inviati.`)
        }
        setFeedbackModal((current) => {
            if (current.action?.type !== "RETRY_FAILED_PRINTS") return current
            const preservedFailedPrinters = result.failed === 0
                ? current.action.failedPrinters.filter((failedPrinter) => failedPrinter.key !== printer.key)
                : current.action.failedPrinters
            if (result.failed === 0 && result.failedPrinters.length === 0 && preservedFailedPrinters.length === 0) {
                return {
                    ...current,
                    tone: "success",
                    title: "Stampe inviate",
                    message: "Tutte le stampe fallite sono state reinviate correttamente.",
                    action: undefined
                }
            }
            const failedPrinters = result.failedPrinters.length > 0
                ? result.failedPrinters
                : preservedFailedPrinters
            if (failedPrinters.length === 0) {
                return {
                    ...current,
                    message: `${result.failed} ${result.failed === 1 ? "stampa non è stata inviata" : "stampe non sono state inviate"}. Riprova.`
                }
            }

            const remainingCount = failedPrinters.reduce((total, printer) => total + printer.count, 0)
            const remainingPrinters = failedPrinters.map((printer) => printer.name).join(", ")
            return {
                ...current,
                message: `Restano ${remainingCount} ${remainingCount === 1 ? "stampa" : "stampe"} da reinviare${remainingPrinters ? ` su: ${remainingPrinters}` : ""}.`,
                action: { ...current.action, failedPrinters }
            }
        })
    }

    const handleCodeDialogOpenChange = (open: boolean) => {
        if (open && isStockMode) return
        setIsCodeDialogOpen(open)
        if (open) {
            void loadRecentPendingOrdersForDialog()
        }
    }

    const handleOpenCashSession = async () => {
        if (isStockMode) return
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
        if (isStockMode) return
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
        if (isStockMode) return
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
        if (isProcessing || (open && isStockMode)) return
        setIsCheckoutOpen(open)
        if (!open) {
            setCashReceivedInput("")
            setIsCashKeypadExpanded(false)
            setStockShortages([])
        }
    }

    const clearTableSelection = () => {
        setTableNumber("")
    }

    const handleLoadOrderByCode = async (
        rawCode?: string,
        options?: { skipDraftConfirmation?: boolean }
    ) => {
        if (isStockMode) return
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
        if (
            !options?.skipDraftConfirmation
            && hasActiveCheckoutDraft
            && loadedPendingOrder?.code !== codeToLoad
        ) {
            setPendingOrderLoadRequest({ code: codeToLoad })
            return
        }

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
        setIsVolunteerMode(result.order.pricingMode === "VOLUNTEER")
        setCustomerName(result.order.customer?.name || "")
        setTableNumber(normalizeTableValue(result.order.customer?.table || ""))
        setCart(result.order.items.map((item, index) => ({
            lineId: `${item.productId}-${index}`,
            productId: item.productId,
            name: item.snapshotName,
            price: products.find((product) => product._id === item.productId)?.basePrice ?? item.unitPrice,
            volunteerPrice: item.volunteerPrice ?? products.find((product) => product._id === item.productId)?.volunteerPrice ?? null,
            quantity: item.quantity,
            variants: [],
            customKitchenNotes: item.customKitchenNotes,
            // La struttura ingredienti non è persistita: conserva l'intera nota come testo libero.
            contextCustomNote: item.customKitchenNotes,
            splitPrintPerUnit: item.splitPrintPerUnit,
            selectedOptions: (item.selectedOptions || []).map((option) => option.name),
            menuSelections: item.menuSelections || [],
        })))
        setRecentPendingOrders((prev) => prev.filter((order) => order.id !== result.order?.id))
        setIsCodeDialogOpen(false)
        setIsPendingOrdersSheetOpen(false)
        setIsCartSheetOpen(false)
    }

    const handleCheckoutInterruption = (error: unknown) => {
        console.error("Checkout response interrupted:", error)
        setIsProcessing(false)
        setIsCheckoutOutcomeUnknown(true)
        showFeedbackModal(
            "Non confermare di nuovo: l'ordine potrebbe essere già registrato. Verifica prima in Ordini: se è pagato, usa il Monitor stampa; se è pendente, ricaricalo e completa il pagamento.",
            "error",
            "Esito ordine non verificato"
        )
    }

    const discardUnknownCheckout = () => {
        resetCheckoutForm()
        resetPendingOrder()
        setStockShortages([])
        setIsCheckoutOutcomeUnknown(false)
        setIsCheckoutOpen(false)
    }

    const handleCheckout = async (allowStockOverride = false) => {
        if (isStockMode || isCheckoutOutcomeUnknown) return

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

        if (isTableRequiredInvalid) {
            showFeedbackModal("Inserisci il tavolo oppure selezionalo dalla lista")
            return
        }
        if (productCartItems.length === 0) {
            showFeedbackModal("Aggiungi almeno un prodotto prima di procedere al pagamento")
            return
        }
        if (cashPaymentBlocked) {
            showFeedbackModal(cashReceivedError || "Importo ricevuto non valido")
            return
        }

        setIsProcessing(true)

        const cartPayload = productCartItems.map((item) => ({
            productId: item.productId,
            snapshotName: item.name,
            customKitchenNotes: item.customKitchenNotes,
            splitPrintPerUnit: item.splitPrintPerUnit,
            quantity: item.quantity,
            selectedOptions: (item.selectedOptions || []).map((option) => ({
                name: option,
                priceVariation: 0
            })),
            menuSelections: item.menuSelections || []
        }))

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
                orderDiscounts: orderDiscountsPayload,
                lineDiscounts: [],
                pricingMode: isVolunteerMode ? "VOLUNTEER" : "STANDARD",
                cart: cartPayload
            }).catch((error) => {
                handleCheckoutInterruption(error)
                return null
            })
            if (!completionResult) return

            if (completionResult.success) {
                localStorage.setItem(`${POS_PAYMENT_METHOD_STORAGE_PREFIX}${selectedPosDeviceId}`, effectivePaymentMethod)
                setRecentPendingOrders((prev) => prev.filter((order) => order.id !== completedPendingOrderId))
                resetCheckoutForm(effectivePaymentMethod)
                resetPendingOrder()
                setIsCheckoutOpen(false)
                setIsCartSheetOpen(false)
                setStockShortages([])
                const printFailureMessage = buildPrintFailureMessage(completionResult.printSummary)
                if (printFailureMessage) {
                    showFeedbackModal(printFailureMessage, "error", "Errore stampa", {
                        type: "RETRY_FAILED_PRINTS",
                        orderId: completionResult.orderId,
                        failedPrinters: completionResult.printSummary?.failedPrinters || []
                    })
                }
            } else {
                if (completionResult.stockShortages?.length) {
                    setStockShortages(completionResult.stockShortages)
                } else if (completionResult.cashSessionRequired) {
                    setIsCheckoutOpen(false)
                    setCashReceivedInput("")
                    setIsCashKeypadExpanded(false)
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
            orderDiscounts: orderDiscountsPayload,
            lineDiscounts: [],
            pricingMode: isVolunteerMode ? "VOLUNTEER" as const : "STANDARD" as const,
            cart: cartPayload,
            paymentMethod: effectivePaymentMethod,
            posDeviceId: selectedPosDeviceId,
            allowStockOverride
        }

        const result = await createOrder(orderData).catch((error) => {
            handleCheckoutInterruption(error)
            return null
        })
        if (!result) return

        if (result.success) {
            if (result.paymentCompleted) {
                localStorage.setItem(`${POS_PAYMENT_METHOD_STORAGE_PREFIX}${selectedPosDeviceId}`, effectivePaymentMethod)
            }
            resetCheckoutForm(effectivePaymentMethod)
            setIsCheckoutOpen(false)
            setIsCartSheetOpen(false)
            setStockShortages([])
            const printFailureMessage = buildPrintFailureMessage(result.printSummary)
            if (printFailureMessage) {
                showFeedbackModal(printFailureMessage, "error", "Errore stampa", {
                    type: "RETRY_FAILED_PRINTS",
                    orderId: result.orderId,
                    failedPrinters: result.printSummary?.failedPrinters || []
                })
            }
        } else {
            if (result.stockShortages?.length) {
                setStockShortages(result.stockShortages)
            } else if (result.cashSessionRequired) {
                setIsCheckoutOpen(false)
                setCashReceivedInput("")
                setIsCashKeypadExpanded(false)
                setCashSession(null)
                setIsOpenCashDialogOpen(true)
            } else {
                showFeedbackModal(`Errore durante la creazione dell'ordine: ${result.error}`)
            }
        }
        setIsProcessing(false)
    }

    const checkoutDisabled = isProcessing
        || isStockMode
        || isCheckoutOutcomeUnknown
        || isCashSessionLoading
        || !selectedPosDeviceId
        || !cashSession
        || productCartItems.length === 0
        || (!cashAvailable && !cardAvailable)
        || isTableRequiredInvalid
        || cashPaymentBlocked

    const oneHourAgo = (recentPendingOrdersReferenceTime ?? 0) - 60 * 60 * 1000
    const sortedRecentPendingOrders = [
        ...recentPendingOrders
            .filter((order) => order.createdAt && new Date(order.createdAt).getTime() >= oneHourAgo)
            .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()),
        ...recentPendingOrders
            .filter((order) => !order.createdAt || new Date(order.createdAt).getTime() < oneHourAgo)
            .sort((a, b) => {
                if (!a.createdAt) return 1
                if (!b.createdAt) return -1
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            })
    ]

    const renderCartItem = (item: CartItem) => {
        const unitPrice = getCartItemUnitPrice(item)
        const lineTotal = item.isDiscount
            ? Number((computeLiveDiscountAmount(item) * -1).toFixed(2))
            : Number((item.quantity * unitPrice).toFixed(2))
        return (
            <div key={item.lineId} className="grid gap-3 rounded-md border bg-white p-3" data-testid={`cart-item-row-${item.lineId}`}>
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex flex-col">
                        <span className={`line-clamp-2 text-base font-black ${item.isDiscount ? "text-emerald-700" : "text-slate-800 dark:text-slate-100"}`}>{item.name}</span>
                        {item.isDiscount ? (
                            <span className="text-sm font-semibold text-emerald-600">
                                {item.discountPreset?.type === "PERCENT"
                                    ? `${item.discountPreset.value}% su ${(liveDiscountsByLineId.get(item.lineId)?.baseAmount ?? subtotal).toFixed(2)} €`
                                    : `Sconto fisso ${item.discountPreset?.value.toFixed(2)} €`}
                            </span>
                        ) : (
                            <div className="space-y-1">
                                <span className="text-base font-bold text-slate-600" data-testid={`cart-item-unit-price-${item.lineId}`}>
                                    {item.quantity} x {unitPrice.toFixed(2)} €
                                    {isVolunteerMode && typeof item.volunteerPrice === "number" ? " · Volontari" : ""}
                                </span>
                                {Array.isArray(item.selectedOptions) && item.selectedOptions.length > 0 ? (
                                    <p className="line-clamp-2 text-sm font-semibold text-slate-500">
                                        {item.selectedOptions.join(" • ")}
                                    </p>
                                ) : null}
                                {item.customKitchenNotes ? (
                                    <p className="line-clamp-2 text-sm font-black text-indigo-700" data-testid={`cart-item-notes-${item.lineId}`}>
                                        {item.customKitchenNotes}
                                    </p>
                                ) : null}
                                {item.splitPrintPerUnit ? (
                                    <p className="text-xs font-black uppercase tracking-widest text-amber-700">
                                        Comanda singola
                                    </p>
                                ) : null}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        aria-label={`Rimuovi ${item.name} dal carrello`}
                        disabled={isStockMode}
                        onClick={() => removeFromCart(item.lineId)}
                        className="flex h-11 w-11 items-center justify-center rounded-md text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-lg font-black ${item.isDiscount ? "text-emerald-700" : "text-[var(--brand-blue-700)]"}`} data-testid={`cart-item-total-${item.lineId}`}>{lineTotal.toFixed(2)} €</span>
                    {!item.isDiscount ? (
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                aria-label={`Modifica dettagli ${item.name}`}
                                disabled={isStockMode}
                                onClick={() => openCartItemContext(item)}
                                className="flex h-11 w-11 items-center justify-center rounded-md text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Settings2 size={18} />
                            </button>
                            <div className="inline-flex h-11 items-center rounded-md border border-slate-200 bg-slate-50">
                                <button
                                    type="button"
                                    aria-label={`Diminuisci quantità ${item.name}`}
                                    disabled={isStockMode || item.quantity <= 1}
                                    className="flex h-11 w-11 items-center justify-center text-2xl font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                                    onClick={() => decreaseCartItemQuantity(item.lineId)}
                                >
                                    -
                                </button>
                                <span className="min-w-10 text-center text-lg font-black text-slate-900" aria-live="polite" data-testid={`cart-item-quantity-${item.lineId}`}>
                                    {item.quantity}
                                </span>
                                <button
                                    type="button"
                                    aria-label={`Aumenta quantità ${item.name}`}
                                    disabled={isStockMode}
                                    className="flex h-11 w-11 items-center justify-center text-2xl font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                                    onClick={() => increaseCartItemQuantity(item.lineId)}
                                >
                                    +
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        )
    }

    const loadedPendingOrderBanner = loadedPendingOrder ? (
        <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Ordine WebApp Caricato</p>
                    <p className="text-base font-black text-indigo-700">Codice {loadedPendingOrder.code}</p>
                    <p className="mt-1 text-xs font-semibold text-indigo-600">
                        {isStockMode
                            ? "Carrello in sola lettura durante la modifica scorte."
                            : "Carrello precompilato: puoi aggiungere/rimuovere prodotti prima della chiusura."}
                    </p>
                    {loadedPendingOrder.easterEggAttached ? (
                        <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-amber-800">
                            Foto allegata
                        </p>
                    ) : null}
                </div>
                <button
                    type="button"
                    aria-label="Rimuovi ordine caricato"
                    disabled={isStockMode}
                    className="flex h-11 w-11 items-center justify-center rounded-md text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={resetPendingOrder}
                    title="Rimuovi ordine caricato"
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    ) : null

    const discountsSurfaceContent = (
        <section
            id={isMobilePos ? "pos-mobile-discount-presets" : "pos-discount-presets"}
            className={isMobilePos
                ? "space-y-2 rounded-lg border-2 border-emerald-200 bg-emerald-50/60 p-2.5"
                : "flex min-w-0 items-stretch gap-2"
            }
            data-testid={isMobilePos ? "pos-mobile-discount-presets" : "pos-discount-presets"}
        >
            <div className={isMobilePos
                ? "flex items-center justify-between gap-3"
                : "flex shrink-0 items-stretch gap-2"
            }>
                <div>
                    {isMobilePos ? (
                        <>
                            <p className="text-sm font-black uppercase tracking-[0.08em] text-emerald-900">Prezzi e sconti</p>
                            <p className="text-xs font-semibold text-emerald-700">Modificatori del carrello</p>
                        </>
                    ) : null}
                </div>
                <label className="inline-flex min-h-12 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-black text-emerald-800">
                    <span>Volontari</span>
                    <input
                        type="checkbox"
                        aria-label="Modalità volontari"
                        checked={isVolunteerMode}
                        disabled={isStockMode}
                        onChange={(event) => {
                            setIsVolunteerMode(event.target.checked)
                            if (event.target.checked) {
                                setCart((prev) => prev.filter((item) => !item.isDiscount))
                            }
                        }}
                    />
                </label>
            </div>
            {quickDiscountPresets.length === 0 ? (
                <div className="min-w-0 flex-1 border border-dashed border-emerald-300 bg-white px-3 py-3 text-center">
                    <p className="text-sm font-black text-slate-700">Nessun preset sconto configurato</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                        Configura i preset da Admin &gt; Impostazioni.
                    </p>
                </div>
            ) : (
                <div className={isMobilePos ? "grid gap-2" : "flex min-w-0 flex-1 gap-2 overflow-x-auto"}>
                    {quickDiscountPresets.map((preset, index) => {
                        const previewAmount = computePresetDiscountAmount(preset, discountBaseAmount)
                        const isPresetApplied = discountCartItems.some((item) => isSameDiscountPreset(item, preset))
                        return (
                            <button
                                type="button"
                                key={`discount-preset-card-${preset.label}-${preset.type}-${preset.value}-${index}`}
                                id={`discount-preset-card-${index}`}
                                aria-pressed={isPresetApplied}
                                onClick={() => {
                                    addDiscountPresetToCart(preset)
                                    if (isMobilePos && !isPresetApplied) {
                                        setIsDiscountSheetOpen(false)
                                    }
                                }}
                                disabled={isStockMode || isVolunteerMode || productCartItems.length === 0 || isPresetApplied}
                                className={`inline-flex min-h-12 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 py-2 text-left shadow-sm transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 ${isMobilePos ? "w-full" : "min-w-52 flex-1"}`}
                            >
                                <span className="min-w-0 flex-1 text-sm font-black leading-tight text-emerald-900">
                                    {preset.label}
                                </span>
                                <span className="inline-flex w-fit rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                                    {preset.type === "PERCENT" ? `${preset.value}%` : `${preset.value.toFixed(2)} €`}
                                </span>
                                <span className="whitespace-nowrap text-sm font-black text-emerald-700">
                                    {isPresetApplied ? "Applicato" : `-${previewAmount.toFixed(2)} €`}
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}
        </section>
    )

    const recentPendingOrdersContent = (
        <div className="space-y-4">
            <div>
                <h3 className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <Hash size={12} />
                    Ingredienti in coda
                </h3>
                {isRecentOrdersLoading ? (
                    <div className="flex h-20 items-center justify-center rounded-xl border border-dashed text-slate-400">
                        <Loader2 className="animate-spin" />
                    </div>
                ) : pendingIngredientQueue.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-4 text-center text-sm font-semibold text-slate-500">
                        Nessun ingrediente pendente disponibile.
                    </div>
                ) : (
                    <div className={isMobilePos ? "space-y-2" : "grid grid-cols-2 gap-2"}>
                        {pendingIngredientQueue.map((item) => (
                            <div
                                key={item.ingredientKey}
                                data-testid={`pending-ingredient-card-${toPendingIngredientTestId(item.ingredientKey)}`}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span
                                                className="truncate text-sm font-black text-amber-900"
                                                data-testid={`pending-ingredient-label-${toPendingIngredientTestId(item.ingredientKey)}`}
                                            >
                                                {item.label}
                                            </span>
                                            {item.legacy ? (
                                                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                                    Legacy
                                                </span>
                                            ) : null}
                                        </div>
                                        <p className="mt-0.5 text-[11px] font-semibold text-amber-700">
                                            {item.orderCount} ordini coinvolti
                                        </p>
                                        <p className="mt-0.5 text-[11px] font-semibold text-amber-700">
                                            {item.stockQuantity === null || item.stockQuantity === undefined
                                                ? "Scorta non tracciata"
                                                : item.remainingStockQuantity === 0
                                                    ? "Residuo stimato: esaurito"
                                                    : `Residuo stimato: ${item.remainingStockQuantity}`}
                                        </p>
                                    </div>
                                    <span
                                        className="shrink-0 text-2xl font-black text-amber-800"
                                        data-testid={`pending-ingredient-quantity-${toPendingIngredientTestId(item.ingredientKey)}`}
                                    >
                                        {item.quantity}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <h3 className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <Clock3 size={12} />
                    Ultimi ordini pendenti
                </h3>
                {isRecentOrdersLoading ? (
                    <div className="flex h-20 items-center justify-center rounded-xl border border-dashed text-slate-400">
                        <Loader2 className="animate-spin" />
                    </div>
                ) : sortedRecentPendingOrders.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-4 text-center text-sm font-semibold text-slate-500">
                        Nessun ordine pendente disponibile.
                    </div>
                ) : (
                    <div className={isMobilePos ? "space-y-2" : "grid grid-cols-2 gap-2"}>
                        {sortedRecentPendingOrders.map((order) => {
                            const isOlderThanOneHour = !order.createdAt || new Date(order.createdAt).getTime() < oneHourAgo
                            return (
                                <button
                                    key={order.id}
                                    type="button"
                                    disabled={isStockMode}
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
                        })}
                    </div>
                )}
            </div>
        </div>
    )

    const cartContent = (
        <>
            {isStockMode ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-black text-amber-900" role="status">
                    Carrello in sola lettura · termina la modalità scorte per modificarlo
                </p>
            ) : null}
            {loadedPendingOrderBanner}
            {cart.length === 0 ? (
                <div className="flex h-full min-h-[240px] flex-col items-center justify-center space-y-3 text-slate-400 opacity-50">
                    <ShoppingCart size={52} />
                    <p className="font-bold">Il carrello è vuoto</p>
                </div>
            ) : (
                cart.map(renderCartItem)
            )}
        </>
    )

    const mobileProductList = (
        <div className="space-y-3" data-testid="pos-mobile-catalog">
            <div className="overflow-x-auto pb-1">
                <div className="flex min-w-max gap-2">
                    {categories.map((cat) => {
                        const catTheme = getCategoryTheme(cat.uiColor)
                        const isActive = selectedModernCategoryId === cat._id
                        return (
                            <button
                                key={cat._id}
                                type="button"
                                onClick={() => setActiveCategory(cat._id)}
                                aria-pressed={isActive}
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-black uppercase tracking-[0.04em] transition-all"
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
                                <span className="truncate">{cat.name}</span>
                            </button>
                        )
                    })}
                </div>
            </div>
            {!selectedModernCategory ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-500">
                    Nessuna categoria disponibile.
                </div>
            ) : selectedModernCategoryProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-500">
                    Nessun prodotto nella categoria selezionata.
                </div>
            ) : (
                <div className="space-y-3">
                    {selectedModernCategoryProducts.map((product, productIndex) => {
                        const stockStatus = product.stockStatus || getStockStatus(product.stockQuantity ?? null, Boolean(product.isSoldOut))
                        const stockLabel = getStockLabel(product.stockQuantity ?? null, Boolean(product.isSoldOut))
                        const showStockPill = stockStatus === "LOW" || stockStatus === "OUT"
                        const cardBackground = stockStatus === "OUT"
                            ? "rgba(254, 226, 226, 0.88)"
                            : productIndex % 2 === 0
                                ? categoryColorWithAlpha(selectedModernCategory.uiColor, 0.24)
                                : categoryColorWithAlpha(selectedModernCategory.uiColor, 0.14)
                        const cardBorderColor = stockStatus === "OUT" ? "#dc2626" : selectedModernCategoryTheme.base

                        return isStockMode ? (
                            <PosInlineStockEditor
                                key={product._id}
                                eventId={activeEvent?._id || ""}
                                product={product}
                                displayName={resolveProductDisplayName(product)}
                                priceLabel={resolveProductPriceLabel(product, isVolunteerMode)}
                                stockLabel={showStockPill ? stockLabel : undefined}
                                variant="mobile"
                                borderColor={cardBorderColor}
                                backgroundColor={cardBackground}
                                onUpdated={handleStockUpdated}
                            />
                        ) : (
                            <PosProductCard
                                key={product._id}
                                product={product}
                                displayName={resolveProductDisplayName(product)}
                                quantity={productQuantityById.get(product._id) ?? 0}
                                stockStatus={stockStatus}
                                stockLabel={stockLabel}
                                showStockPill={showStockPill}
                                variant="mobile"
                                showTouchDecrement={showTouchDecrementControls}
                                useVolunteerPrice={isVolunteerMode}
                                borderColor={cardBorderColor}
                                backgroundColor={cardBackground}
                                onAdd={addToCart}
                                onDecrement={decrementProductFromCatalog}
                            />
                        )
                    })}
                </div>
            )}
        </div>
    )

    if (isMobilePos === undefined) {
        return (
            <div className="brand-surface-pos h-screen w-screen overflow-hidden bg-[#f7fbff]" data-testid="pos-brand-shell">
                <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-[var(--brand-blue-700)]" />
                </div>
            </div>
        )
    }

    return (
        <div className="brand-surface-pos h-screen w-screen overflow-hidden" data-testid="pos-brand-shell">
            <p id="pos-product-card-instructions" className="sr-only">
                Click, tap, Invio o Spazio aggiungono una unita. Tasto destro, Canc o meno rimuovono una unita quando il prodotto e nel carrello. Su touch usa il pulsante meno nella card.
            </p>
            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {cartAnnouncement}
            </div>
            {isMobilePos ? (
            <div className="flex h-full flex-col bg-[#f7fbff]">
                <header className="sticky top-0 z-30 border-b border-[#d9e6f8] bg-white/95 px-3 py-3 backdrop-blur">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="truncate text-base font-black uppercase tracking-tight text-[var(--brand-ink)]">
                                {activeEvent?.name || "Cassa FantaFestando"}
                            </p>
                            <button
                                onClick={() => setIsPosSelectorOpen(true)}
                                className="mt-1 inline-flex max-w-full items-center gap-1 text-xs font-bold text-[var(--brand-blue-700)]"
                            >
                                <Monitor size={12} />
                                <span className="truncate">{selectedPosDevice ? `Cassa: ${selectedPosDevice.name}` : "Seleziona Cassa"}</span>
                            </button>
                        </div>
                        <div className="shrink-0 text-right">
                            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Totale</p>
                            <p className="text-2xl font-black text-[var(--brand-blue-700)]">{effectiveTotal.toFixed(2)} €</p>
                        </div>
                    </div>
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                        <button
                            type="button"
                            onClick={() => setIsCashStatusSheetOpen(true)}
                            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-sm font-black ${cashSession ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}
                        >
                            <Wallet size={14} />
                            {cashSession ? "Cassa aperta" : "Cassa chiusa"}
                            {cashSession?.isTest ? <span className="rounded bg-rose-700 px-1.5 py-0.5 text-xs text-white">TEST</span> : null}
                        </button>
                        <button
                            type="button"
                            onClick={openPendingOrdersSurface}
                            disabled={isStockMode}
                            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-700 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            <Clock3 size={14} />
                            Pendenti
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCodeDialogOpenChange(true)}
                            disabled={isStockMode}
                            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            <Search size={14} />
                            Codice
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsDiscountSheetOpen(true)}
                            disabled={isStockMode}
                            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            <Banknote size={14} />
                            Prezzi e sconti
                        </button>
                        <button
                            type="button"
                            onClick={toggleStockMode}
                            aria-pressed={isStockMode}
                            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-black ${isStockMode ? "border-amber-700 bg-amber-700 text-white" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                        >
                            <PackageOpen size={14} />
                            {isStockMode ? "Termina scorte" : "Scorte"}
                        </button>
                    </div>
                    {isStockMode ? (
                        <div className="mt-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-black text-amber-900" role="status" data-testid="pos-stock-mode-banner">
                            Modalità scorte attiva · il catalogo non aggiunge al carrello
                        </div>
                    ) : null}
                    {isVolunteerMode ? (
                        <button
                            type="button"
                            onClick={() => setIsDiscountSheetOpen(true)}
                            disabled={isStockMode}
                            className="mt-2 flex min-h-11 w-full items-center justify-between rounded-xl border border-emerald-300 bg-emerald-100 px-3 py-2 text-sm font-black text-emerald-900 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            <span>Prezzi volontari attivi</span>
                            <span className="text-xs uppercase tracking-wider">Modifica</span>
                        </button>
                    ) : null}
                    {loadedPendingOrder ? (
                        <div className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">
                            Ordine caricato: codice {loadedPendingOrder.code}
                        </div>
                    ) : null}
                </header>

                <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3">
                    {mobileProductList}
                </main>

                <div className="sticky bottom-0 z-30 border-t border-[#d9e6f8] bg-white/95 px-3 py-3 backdrop-blur">
                    <button
                        type="button"
                        data-testid="pos-mobile-cart-bar"
                        onClick={() => setIsCartSheetOpen(true)}
                        className="flex w-full items-center justify-between rounded-2xl bg-[var(--brand-blue-700)] px-4 py-3 text-left text-white shadow-lg"
                    >
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-blue-100">
                                {cart.length === 0 ? "Carrello vuoto" : `${cart.length} righe nel carrello`}
                            </p>
                            <p className="text-lg font-black">
                                {effectiveTotal.toFixed(2)} €
                            </p>
                        </div>
                        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em]">
                            <ShoppingCart size={18} />
                            Apri
                        </div>
                    </button>
                </div>
            </div>
            ) : (
            <div className="flex h-full flex-col">
            <header className="relative z-30 shrink-0 border-b border-[#d9e6f8] bg-white shadow-sm">
                <div className="flex items-center gap-3 px-3 py-2">
                    <h1 className="min-w-0 flex-1 truncate text-lg font-black uppercase tracking-tight text-[var(--brand-ink)]">
                        {activeEvent?.name || "Cassa FantaFestando"}
                    </h1>
                    <button type="button" onClick={openPendingOrdersSurface} disabled={isStockMode} className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-45">Pendenti</button>
                    <button type="button" onClick={() => handleCodeDialogOpenChange(true)} disabled={isStockMode} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-45">Codice</button>
                    <button
                        type="button"
                        onClick={toggleStockMode}
                        aria-pressed={isStockMode}
                        className={`rounded-md border px-3 py-2 text-sm font-bold ${isStockMode ? "border-amber-700 bg-amber-700 text-white" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                    >
                        {isStockMode ? "Termina scorte" : "Scorte"}
                    </button>
                    <details
                        className="group relative"
                        data-testid="pos-desktop-cash-menu"
                        onBlur={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute("open")
                        }}
                    >
                        <summary data-testid="pos-desktop-cash-menu-trigger" className={`flex min-h-10 min-w-52 cursor-pointer list-none items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-black marker:content-none ${cashSession ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
                            <span className="min-w-0 truncate">{selectedPosDevice?.name || "Seleziona cassa"}</span>
                            <span className="flex shrink-0 items-center gap-1 text-xs">
                                {cashSession?.isTest ? <span className="rounded bg-rose-700 px-1.5 py-0.5 text-white">TEST</span> : null}
                                {cashSession?.closeFailedError ? <span className="rounded bg-amber-600 px-1.5 py-0.5 text-white">CHIUSURA DA RIPETERE</span> : null}
                                <span>{cashSession ? "APERTA" : "CHIUSA"} ▾</span>
                            </span>
                        </summary>
                        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 space-y-3 rounded-lg border border-[#d9e6f8] bg-white p-3 text-slate-800 shadow-xl">
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.currentTarget.closest("details")?.removeAttribute("open")
                                    setIsPosSelectorOpen(true)
                                }}
                                className="w-full rounded-md border border-[#d9e6f8] bg-[#eef5ff] px-3 py-2 text-left text-sm font-black text-[var(--brand-blue-700)] hover:bg-[#e4efff]"
                            >
                                {selectedPosDevice ? `Cambia cassa · ${selectedPosDevice.name}` : "Seleziona cassa"}
                            </button>
                            <div className={`rounded-md border p-3 ${cashSession ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                                <p className={`text-[10px] font-black uppercase tracking-widest ${cashSession ? "text-emerald-700" : "text-rose-700"}`}>Stato cassa</p>
                                {isCashSessionLoading ? (
                                    <p className="mt-1 text-xs font-semibold text-slate-500">Caricamento sessione...</p>
                                ) : cashSession ? (
                                    <p className="mt-1 text-xs font-semibold text-emerald-700">
                                        Aperta alle {formatSessionDateTime(cashSession.openedAt)} · Fondo {formatEuro(cashSession.openingFloatAmount)}
                                    </p>
                                ) : (
                                    <p className="mt-1 text-xs font-semibold text-rose-700">Chiusa. Apri la cassa per iniziare gli incassi.</p>
                                )}
                            </div>
                            {lastClosedSummary ? (
                                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">
                                    <p className="font-black uppercase tracking-widest text-slate-500">Ultima chiusura</p>
                                    <p className="mt-1">Chiusa alle {formatSessionDateTime(lastClosedSummary.closedAt)}</p>
                                    <p>Atteso: {formatEuro(lastClosedSummary.expectedCashAmount)} · Contato: {formatEuro(lastClosedSummary.closingCountedCashAmount)}</p>
                                    <p className={lastClosedSummary.varianceAmount === 0 ? "text-emerald-700" : "text-amber-700"}>
                                        Differenza: {formatEuro(lastClosedSummary.varianceAmount)}
                                    </p>
                                </div>
                            ) : null}
                            {cashSession ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-11 w-full border-emerald-300 bg-white font-black text-emerald-700"
                                    onClick={(event) => {
                                        event.currentTarget.closest("details")?.removeAttribute("open")
                                        void handleOpenCloseCashDialog()
                                    }}
                                    disabled={isStockMode || isCashSessionLoading || isCashSessionActionLoading || isCloseCashSessionPreviewLoading || isProcessing}
                                >
                                    Chiudi Cassa
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    className="h-11 w-full bg-rose-600 font-black text-white hover:bg-rose-700"
                                    onClick={(event) => {
                                        event.currentTarget.closest("details")?.removeAttribute("open")
                                        setIsOpenCashDialogOpen(true)
                                    }}
                                    disabled={isStockMode || isCashSessionLoading || isCashSessionActionLoading || !selectedPosDeviceId}
                                >
                                    Apri Cassa
                                </Button>
                            )}
                            {cashSession?.isTest ? <p className="rounded bg-rose-700 px-2 py-1 text-center text-xs font-black text-white">SESSIONE TEST</p> : null}
                            {cashSession?.closeFailedError ? <p className="rounded bg-amber-600 px-2 py-1 text-center text-xs font-black text-white">CHIUSURA DA RIPETERE</p> : null}
                        </div>
                    </details>
                </div>
                <div className="border-t border-[#d9e6f8] bg-[#f7fbff] px-3 py-2" data-testid="pos-desktop-discounts">
                    {discountsSurfaceContent}
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
            {/* Sinistra: Selezione Prodotti (70%) */}
            <div className="flex h-full flex-1 flex-col border-r border-[#d9e6f8] bg-white">
                {isStockMode ? (
                    <div className="shrink-0 border-b-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm font-black text-amber-900" role="status" data-testid="pos-stock-mode-banner">
                        Modalità scorte attiva · il catalogo non aggiunge al carrello
                    </div>
                ) : null}

                <div className="flex-1 overflow-y-auto p-3 text-slate-800">
                    <div className="space-y-2">
                        <section data-testid="pos-all-categories-catalog">
                            {isModernCatalogLayout ? (
                                <div className="space-y-2">
                                    <div className="flex gap-1 overflow-x-auto border-b border-[#d9e6f8] pb-2">
                                        {categories.map((cat) => {
                                            const catTheme = getCategoryTheme(cat.uiColor)
                                            const isActive = selectedModernCategoryId === cat._id
                                            return (
                                                <button
                                                    key={cat._id}
                                                    type="button"
                                                    onClick={() => setActiveCategory(cat._id)}
                                                    aria-pressed={isActive}
                                                    className="inline-flex min-h-12 shrink-0 items-center gap-1.5 border px-3.5 py-2 text-base font-black leading-tight transition-all"
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
                                                    <span className="line-clamp-2 max-w-[190px]">{cat.name}</span>
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
                                                        className="line-clamp-2 text-base font-black leading-tight"
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

                                                    return isStockMode ? (
                                                        <PosInlineStockEditor
                                                            key={p._id}
                                                            eventId={activeEvent?._id || ""}
                                                            product={p}
                                                            displayName={resolveProductDisplayName(p)}
                                                            priceLabel={resolveProductPriceLabel(p, isVolunteerMode)}
                                                            stockLabel={showStockPill ? stockLabel : undefined}
                                                            variant="modern"
                                                            borderColor={cardBorderColor}
                                                            backgroundColor={stockStatus === "OUT"
                                                                ? "rgba(254, 226, 226, 0.88)"
                                                                : stripedBackground}
                                                            onUpdated={handleStockUpdated}
                                                        />
                                                    ) : (
                                                        <PosProductCard
                                                            key={p._id}
                                                            product={p}
                                                            displayName={resolveProductDisplayName(p)}
                                                            quantity={productQuantityById.get(p._id) ?? 0}
                                                            stockStatus={stockStatus}
                                                            stockLabel={stockLabel}
                                                            showStockPill={showStockPill}
                                                            variant="modern"
                                                            showTouchDecrement={showTouchDecrementControls}
                                                            useVolunteerPrice={isVolunteerMode}
                                                            borderColor={cardBorderColor}
                                                            backgroundColor={stockStatus === "OUT"
                                                                ? "rgba(254, 226, 226, 0.88)"
                                                                : stripedBackground}
                                                            onAdd={addToCart}
                                                            onDecrement={decrementProductFromCatalog}
                                                        />
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div
                                    className="grid content-start gap-1"
                                    style={{ gridTemplateColumns: isStockMode ? "minmax(0, 1fr)" : `repeat(${categoryColumnsCount}, minmax(0, 1fr))` }}
                                >
                                    {compactCategoryGroups.map((categoryGroup) => {
                                        const groupProductCount = categoryGroup.reduce((count, category) => count + (productsByCategory[category._id] || []).length, 0)
                                        const categoryRowMinHeight = getAdaptiveProductRowMinHeight(groupProductCount)

                                        return (
                                            <div key={categoryGroup.map((category) => category._id).join("-")} className="min-w-0 space-y-1">
                                                {categoryGroup.map((cat) => {
                                                    const catTheme = getCategoryTheme(cat.uiColor)
                                                    const categoryProducts = productsByCategory[cat._id] || []

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
                                                                    className="line-clamp-2 text-base font-black leading-tight"
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
                                                                        const productQuantity = productQuantityById.get(p._id) ?? 0
                                                                        const stripedBackground = productIndex % 2 === 0
                                                                            ? categoryColorWithAlpha(cat.uiColor, 0.62)
                                                                            : categoryColorWithAlpha(cat.uiColor, 0.18)
                                                                        const strongInset = categoryColorWithAlpha(cat.uiColor, 0.5)
                                                                        const cardBorderColor = stockStatus === "OUT" ? "#dc2626" : catTheme.base
                                                                        const cardBackground = stockStatus === "OUT"
                                                                            ? "rgba(239, 68, 68, 0.24)"
                                                                            : stripedBackground
                                                                        const cardBoxShadow = stockStatus === "OUT"
                                                                            ? "inset 0 0 0 1px rgba(185, 28, 28, 0.5)"
                                                                            : `inset 0 0 0 1px ${strongInset}`

                                                                        return isStockMode ? (
                                                                            <PosInlineStockEditor
                                                                                key={p._id}
                                                                                eventId={activeEvent?._id || ""}
                                                                                product={p}
                                                                                displayName={resolveProductDisplayName(p)}
                                                                                priceLabel={resolveProductPriceLabel(p, isVolunteerMode)}
                                                                                stockLabel={showStockPill ? stockLabel : undefined}
                                                                                variant="modern"
                                                                                borderColor={cardBorderColor}
                                                                                backgroundColor={cardBackground}
                                                                                boxShadow={cardBoxShadow}
                                                                                onUpdated={handleStockUpdated}
                                                                            />
                                                                        ) : (
                                                                            <PosProductCard
                                                                                key={p._id}
                                                                                product={p}
                                                                                displayName={resolveProductDisplayName(p)}
                                                                                quantity={productQuantity}
                                                                                stockStatus={stockStatus}
                                                                                stockLabel={stockLabel}
                                                                                showStockPill={showStockPill}
                                                                                variant="compact"
                                                                                showTouchDecrement={showTouchDecrementControls}
                                                                                useVolunteerPrice={isVolunteerMode}
                                                                                borderColor={cardBorderColor}
                                                                                backgroundColor={cardBackground}
                                                                                minHeight={productQuantity > 0 || showTouchDecrementControls || showStockPill ? `max(${categoryRowMinHeight}, 56px)` : categoryRowMinHeight}
                                                                                boxShadow={cardBoxShadow}
                                                                                onAdd={addToCart}
                                                                                onDecrement={decrementProductFromCatalog}
                                                                            />
                                                                        )
                                                                    })}
                                                                </div>
                                                            )}
                                                        </article>
                                                    )
                                                })}
                                            </div>
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
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="pos-desktop-scroll-region">
                <div className="border-b border-[#d9e6f8] bg-white p-3">
                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2 rounded-md border bg-white p-2">
                            <User size={18} className="text-slate-400" />
                            <input
                                aria-label="Nome cliente"
                                className="w-full border-none bg-transparent text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue-700)] disabled:cursor-not-allowed disabled:opacity-45"
                                disabled={isStockMode}
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
                <div className="min-h-32 flex-1 space-y-2 overflow-y-auto p-3" data-testid="pos-desktop-cart-items">
                    {isStockMode ? (
                        <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs font-black text-amber-900" role="status">
                            Carrello in sola lettura · termina la modalità scorte per modificarlo
                        </p>
                    ) : null}
                    {loadedPendingOrder ? (
                        <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <p className="text-xs uppercase font-bold tracking-widest text-indigo-500">Ordine WebApp Caricato</p>
                                    <p className="text-base font-black text-indigo-700">Codice {loadedPendingOrder.code}</p>
                                    <p className="text-xs font-semibold text-indigo-600 mt-1">
                                        {isStockMode
                                            ? "Carrello in sola lettura durante la modifica scorte."
                                            : "Carrello precompilato: puoi aggiungere/rimuovere prodotti prima della chiusura."}
                                    </p>
                                    {loadedPendingOrder.easterEggAttached ? (
                                        <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-amber-800">
                                            Foto allegata
                                        </p>
                                    ) : null}
                                </div>
                                <button
                                    type="button"
                                    aria-label="Rimuovi ordine caricato"
                                    disabled={isStockMode}
                                    className="flex h-11 w-11 items-center justify-center rounded-md text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
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
                        cart.map(renderCartItem)
                    )}
                </div>
                </div>

                {/* Footer / Pulsante Pagamento */}
                <div className="shrink-0 space-y-2 border-t border-[#d9e6f8] bg-white p-3">
                    <div className="flex items-center justify-between gap-2 px-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Totale da Pagare</span>
                        <span className="whitespace-nowrap text-2xl font-black leading-none text-[var(--brand-blue-700)]">{effectiveTotal.toFixed(2)} €</span>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-600">
                        <p>Subtotale prodotti: {subtotal.toFixed(2)} €</p>
                        {isVolunteerMode ? (
                            <p>Prezzi volontari: -{volunteerDiscountApplied.toFixed(2)} €</p>
                        ) : null}
                        <p>Sconti applicati: -{totalDiscountApplied.toFixed(2)} €</p>
                    </div>
                    <button
                        onClick={() => setIsCheckoutOpen(true)}
                        disabled={isStockMode || productCartItems.length === 0 || !selectedPosDeviceId || !cashSession || isProcessing || isCashSessionLoading}
                        className="brand-cta-primary flex w-full items-center justify-center gap-2 rounded-md py-3 text-base font-black transition-all active:scale-[0.98] hover:brightness-105 disabled:bg-slate-200 disabled:text-slate-400"
                        data-testid="pos-pay-cta"
                    >
                        <CheckCircle2 size={22} />
                        PAGA ORA
                    </button>
                    {isStockMode ? (
                        <p className="text-center text-xs font-black uppercase tracking-wider text-amber-700">
                            Pagamento sospeso durante la modifica scorte
                        </p>
                    ) : null}
                {!cashSession ? (
                    <p className="text-center text-xs font-black uppercase tracking-widest text-rose-600">
                        Incasso bloccato: cassa non aperta
                    </p>
                    ) : null}
                </div>
            </div>
            </div>
            </div>
            )}

            {configuringProduct ? (
                <FixedMenuConfigDialog
                    open
                    onOpenChange={(nextOpen) => {
                        if (!nextOpen) setConfiguringProduct(null)
                    }}
                    product={{
                        _id: configuringProduct._id,
                        name: resolveProductDisplayName(configuringProduct),
                        basePrice: isVolunteerMode && typeof configuringProduct.volunteerPrice === "number"
                            ? configuringProduct.volunteerPrice
                            : configuringProduct.basePrice,
                        menuComponents: configuringProduct.menuComponents || [],
                        menuChoiceGroups: configuringProduct.menuChoiceGroups || []
                    }}
                    confirmLabel="Aggiungi al carrello"
                    onConfirm={(result) => {
                        addConfiguredToCart(configuringProduct, {
                            menuSelections: result.menuSelections,
                            selectedOptionLabels: result.selectedOptionLabels
                        })
                        setConfiguringProduct(null)
                    }}
                />
            ) : null}

            <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
                <SheetContent side="bottom" className="max-h-[88dvh] rounded-t-3xl px-0 pb-0 lg:hidden">
                    <SheetHeader className="border-b border-[#d9e6f8] px-4 pb-3">
                        <SheetTitle className="text-xl font-black text-[var(--brand-ink)]">Carrello</SheetTitle>
                        <SheetDescription>
                            {cart.length === 0 ? "Aggiungi prodotti dal catalogo." : `${cart.length} righe · Totale ${effectiveTotal.toFixed(2)} €`}
                        </SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="pos-mobile-cart-sheet">
                        {cartContent}
                    </div>
                    <div className="space-y-3 border-t border-[#d9e6f8] bg-white px-4 py-4">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                            <p>Subtotale prodotti: {subtotal.toFixed(2)} €</p>
                            {isVolunteerMode ? (
                                <p>Prezzi volontari: -{volunteerDiscountApplied.toFixed(2)} €</p>
                            ) : null}
                            <p>Sconti applicati: -{totalDiscountApplied.toFixed(2)} €</p>
                        </div>
                        <Button
                            type="button"
                            className="brand-cta-primary h-14 w-full text-lg font-black"
                            data-testid="pos-pay-cta"
                            onClick={() => {
                                setIsCartSheetOpen(false)
                                setIsCheckoutOpen(true)
                            }}
                            disabled={isStockMode || productCartItems.length === 0 || !selectedPosDeviceId || !cashSession || isProcessing || isCashSessionLoading}
                        >
                            <CheckCircle2 size={22} />
                            PAGA ORA
                        </Button>
                        {isStockMode ? (
                            <p className="text-center text-xs font-black uppercase tracking-wider text-amber-700">
                                Pagamento sospeso durante la modifica scorte
                            </p>
                        ) : null}
                        {!cashSession ? (
                            <p className="text-center text-xs font-black uppercase tracking-widest text-rose-600">
                                Incasso bloccato: cassa non aperta
                            </p>
                        ) : null}
                    </div>
                </SheetContent>
            </Sheet>

            <Sheet open={isDiscountSheetOpen} onOpenChange={setIsDiscountSheetOpen}>
                <SheetContent side="bottom" className="max-h-[82dvh] rounded-t-3xl px-0 pb-0 lg:hidden">
                    <SheetHeader className="border-b border-[#d9e6f8] px-4 pb-3">
                        <SheetTitle className="text-xl font-black text-[var(--brand-ink)]">Prezzi e sconti</SheetTitle>
                        <SheetDescription>Modalità volontari e preset applicabili al carrello corrente.</SheetDescription>
                    </SheetHeader>
                    <div className="overflow-y-auto px-4 py-4">
                        {discountsSurfaceContent}
                    </div>
                </SheetContent>
            </Sheet>

            <Sheet open={isPendingOrdersSheetOpen} onOpenChange={(open) => {
                setIsPendingOrdersSheetOpen(open)
                if (open) {
                    void loadRecentPendingOrdersForDialog()
                }
            }}>
                <SheetContent side="bottom" className="max-h-[82dvh] rounded-t-3xl px-0 pb-0 lg:hidden">
                    <SheetHeader className="border-b border-[#d9e6f8] px-4 pb-3">
                        <SheetTitle className="text-xl font-black text-[var(--brand-ink)]">Ordini pendenti</SheetTitle>
                        <SheetDescription>Ordini recenti caricabili senza uscire dal POS.</SheetDescription>
                    </SheetHeader>
                    <div className="overflow-y-auto px-4 py-4" data-testid="pos-mobile-pending-sheet">
                        {recentPendingOrdersContent}
                    </div>
                </SheetContent>
            </Sheet>

            <Sheet open={isCashStatusSheetOpen} onOpenChange={setIsCashStatusSheetOpen}>
                <SheetContent side="bottom" className="max-h-[82dvh] rounded-t-3xl px-0 pb-0 lg:hidden">
                    <SheetHeader className="border-b border-[#d9e6f8] px-4 pb-3">
                        <SheetTitle className="text-xl font-black text-[var(--brand-ink)]">Stato cassa</SheetTitle>
                        <SheetDescription>
                            {cashSession ? `Aperta alle ${formatSessionDateTime(cashSession.openedAt)}` : "Apri la cassa per iniziare gli incassi."}
                        </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-3 overflow-y-auto px-4 py-4">
                        <div className={`rounded-2xl border p-3 ${cashSession ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                            <p className={`text-[10px] font-black uppercase tracking-widest ${cashSession ? "text-emerald-700" : "text-rose-700"}`}>
                                Stato Cassa
                            </p>
                            {isCashSessionLoading ? (
                                <p className="mt-1 text-sm font-semibold text-slate-500">Caricamento sessione...</p>
                            ) : cashSession ? (
                                <p className="mt-1 text-sm font-semibold text-emerald-700">
                                    Aperta alle {formatSessionDateTime(cashSession.openedAt)} · Fondo {formatEuro(cashSession.openingFloatAmount)}
                                </p>
                            ) : (
                                <p className="mt-1 text-sm font-semibold text-rose-700">Chiusa. Apri la cassa per iniziare gli incassi.</p>
                            )}
                        </div>
                        {lastClosedSummary ? (
                            <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-600">
                                <p className="font-black uppercase tracking-widest text-slate-500">Ultima chiusura</p>
                                <p className="mt-1">Chiusa alle {formatSessionDateTime(lastClosedSummary.closedAt)}</p>
                                <p>Atteso: {formatEuro(lastClosedSummary.expectedCashAmount)} · Contato: {formatEuro(lastClosedSummary.closingCountedCashAmount)}</p>
                                <p className={lastClosedSummary.varianceAmount === 0 ? "text-emerald-700" : "text-amber-700"}>
                                    Differenza: {formatEuro(lastClosedSummary.varianceAmount)}
                                </p>
                            </div>
                        ) : null}
                        {cashSession ? (
                            <Button
                                type="button"
                                variant="outline"
                                className="h-12 w-full border-emerald-300 bg-white font-black text-emerald-700"
                                onClick={() => {
                                    setIsCashStatusSheetOpen(false)
                                    void handleOpenCloseCashDialog()
                                }}
                                disabled={isStockMode || isCashSessionLoading || isCashSessionActionLoading || isCloseCashSessionPreviewLoading || isProcessing}
                            >
                                <Wallet size={14} />
                                Chiudi Cassa
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                className="h-12 w-full bg-rose-600 font-black text-white hover:bg-rose-700"
                                onClick={() => {
                                    setIsCashStatusSheetOpen(false)
                                    setIsOpenCashDialogOpen(true)
                                }}
                                disabled={isStockMode || isCashSessionLoading || isCashSessionActionLoading}
                            >
                                <Wallet size={14} />
                                Apri Cassa
                            </Button>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            <Dialog open={Boolean(contextLineId)} onOpenChange={(open) => {
                if (!open) setContextLineId(null)
            }}>
                <DialogContent className="max-h-[92dvh] max-w-[560px] overflow-y-auto rounded-2xl p-0 text-slate-800">
                    <DialogHeader className="border-b bg-indigo-50 px-5 py-4">
                        <DialogTitle className="text-xl font-black text-indigo-900">
                            {contextItem?.name || "Dettagli riga"}
                        </DialogTitle>
                        <p className="text-sm font-semibold text-indigo-700">
                            Stai modificando 1 unità su {contextItem?.quantity || 1}.
                        </p>
                    </DialogHeader>

                    <div className="space-y-3 p-5">
                        <fieldset className="space-y-1.5">
                            <legend className="text-xs font-black uppercase tracking-widest text-slate-500">Rimuovi ingredienti</legend>
                            {(contextProduct?.recipeItems || []).length === 0 ? (
                                <p className="rounded-md border border-dashed p-3 text-sm font-semibold text-slate-500">
                                    Ricetta non configurata per questo prodotto.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {(contextProduct?.recipeItems || []).map((entry) => {
                                        const checked = contextDraft.removedIngredientIds.includes(entry.ingredientId)
                                        return (
                                            <label
                                                key={entry.ingredientId}
                                                className={`flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold ${checked ? "border-rose-300 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-800"}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={(event) => updateContextArray("removedIngredientIds", entry.ingredientId, event.target.checked)}
                                                    className="h-5 w-5"
                                                />
                                                <span>Togli {resolveIngredientLabel(entry)}</span>
                                            </label>
                                        )
                                    })}
                                </div>
                            )}
                        </fieldset>

                        <fieldset className="space-y-1.5">
                            <legend className="text-xs font-black uppercase tracking-widest text-slate-500">Aggiungi ingredienti</legend>
                            {contextExtraIngredients.length === 0 ? (
                                <p className="rounded-md border border-dashed p-3 text-sm font-semibold text-slate-500">
                                    Nessun ingrediente extra disponibile.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {contextExtraIngredients.map((ingredient) => {
                                        const checked = contextDraft.addedIngredientIds.includes(ingredient._id)
                                        return (
                                            <label
                                                key={ingredient._id}
                                                className={`flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold ${checked ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-800"}`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={(event) => updateContextArray("addedIngredientIds", ingredient._id, event.target.checked)}
                                                    className="h-5 w-5"
                                                />
                                                <span>Aggiungi {resolveIngredientLabel(ingredient)}</span>
                                            </label>
                                        )
                                    })}
                                </div>
                            )}
                        </fieldset>

                        <div className="space-y-1.5">
                            <Label htmlFor="cart-context-note" className="text-xs font-black uppercase tracking-widest text-slate-500">
                                Nota libera
                            </Label>
                            <textarea
                                id="cart-context-note"
                                value={contextDraft.customNote}
                                onChange={(event) => setContextDraft((prev) => ({ ...prev, customNote: event.target.value }))}
                                className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                placeholder="Es: ben cotte, poco sale..."
                            />
                        </div>

                        <label className={`flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-black ${contextDraft.splitPrintPerUnit ? "border-amber-400 bg-amber-100 text-amber-900" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                            <span>Stampa comanda singola per questa unità</span>
                            <input
                                type="checkbox"
                                checked={contextDraft.splitPrintPerUnit}
                                onChange={(event) => setContextDraft((prev) => ({ ...prev, splitPrintPerUnit: event.target.checked }))}
                                className="h-5 w-5"
                            />
                        </label>

                        <div className="rounded-md border bg-slate-50 px-3 py-2">
                            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Sottotitolo stampa</p>
                            <p className="mt-1 text-sm font-bold text-slate-800">
                                {buildContextKitchenNotes(contextDraft, contextProduct) || "Nessuna nota"}
                            </p>
                        </div>
                        {contextPrintFeedback ? (
                            <p className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-800">
                                {contextPrintFeedback}
                            </p>
                        ) : null}

                        <Button
                            type="button"
                            variant="outline"
                            className="h-11 w-full justify-center border-slate-300 font-bold text-slate-700"
                            onClick={() => void handlePrintContextIngredients()}
                            disabled={isPrintingContextIngredients}
                        >
                            {isPrintingContextIngredients ? <Loader2 className="animate-spin" /> : <Printer size={16} />}
                            Stampa ingredienti
                        </Button>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="h-12 font-black"
                                onClick={() => setContextLineId(null)}
                            >
                                Annulla
                            </Button>
                            <Button
                                type="button"
                                className="h-12 bg-indigo-700 font-black hover:bg-indigo-800"
                                onClick={applyCartItemContext}
                            >
                                Applica a 1 unità
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal di Checkout */}
            <Dialog open={isCheckoutOpen} onOpenChange={handleCheckoutDialogOpenChange}>
                <DialogContent className="flex max-h-[96dvh] flex-col overflow-hidden rounded-2xl border-none p-0 text-slate-800 dark:text-slate-100 sm:max-w-[980px]">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Checkout ordine POS</DialogTitle>
                    </DialogHeader>
                    <div className="shrink-0 bg-blue-600 px-4 py-3 text-center text-white sm:px-6">
                        <span className="text-xs font-bold uppercase tracking-widest text-blue-200">Importo Dovuto</span>
                        <h2 className="mt-1 text-4xl font-black sm:text-5xl">{effectiveTotal.toFixed(2)} €</h2>
                        {loadedPendingOrder && (
                            <div className="mt-1 space-y-1">
                                <p className="text-xs font-semibold text-blue-100">Codice ordine: {loadedPendingOrder.code}</p>
                                {loadedPendingOrder.easterEggAttached ? (
                                    <p className="text-[11px] font-black uppercase tracking-[0.08em] text-amber-100">
                                        Foto allegata pronta per la stampa cassa
                                    </p>
                                ) : null}
                            </div>
                        )}
                    </div>

                    <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:items-start">
                        <div className="space-y-3 sm:space-y-4">
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
                                    <Label htmlFor="checkout-table-number" className="text-base font-bold">Tavolo</Label>
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
                                                        aria-pressed={isActive}
                                                        className={`rounded-md border-2 px-2.5 py-1.5 text-xs font-black transition-colors ${isActive ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}
                                                    >
                                                        {table}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    ) : null}
                                    <Input
                                        id="checkout-table-number"
                                        value={tableNumber}
                                        onChange={(e) => setTableNumber(e.target.value)}
                                        placeholder="Es: B02 oppure VIP TERRAZZA"
                                        aria-invalid={isTableRequiredInvalid}
                                        aria-describedby={isTableRequiredInvalid ? "checkout-table-error" : undefined}
                                        className="h-10 rounded-md border-2 font-semibold"
                                    />
                                    {isTableRequiredInvalid ? (
                                        <p id="checkout-table-error" className="text-sm font-semibold text-rose-600">
                                            Seleziona o inserisci il tavolo per confermare l&apos;ordine.
                                        </p>
                                    ) : null}
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
                                <Label
                                    id="checkout-payment-method-label"
                                    className={cashAvailable !== cardAvailable ? "sr-only" : "text-base font-bold"}
                                >
                                    Metodo di Pagamento
                                </Label>
                                {cashAvailable && cardAvailable ? (
                                    <div className="flex gap-2" role="group" aria-labelledby="checkout-payment-method-label">
                                        <button
                                            type="button"
                                            onClick={() => setPaymentMethod("CASH")}
                                            aria-pressed={effectivePaymentMethod === "CASH"}
                                            className={`flex flex-1 flex-col items-center gap-1 rounded-lg border-2 p-2.5 transition-all ${effectivePaymentMethod === "CASH" ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200"}`}
                                        >
                                            <Banknote size={22} />
                                            <span className="text-sm font-bold">CONTANTI</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPaymentMethod("CARD")}
                                            aria-pressed={effectivePaymentMethod === "CARD"}
                                            className={`flex flex-1 flex-col items-center gap-1 rounded-lg border-2 p-2.5 transition-all ${effectivePaymentMethod === "CARD" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200"}`}
                                        >
                                            <Wallet size={22} />
                                            <span className="text-sm font-bold">CARTA / POS</span>
                                        </button>
                                    </div>
                                ) : cashAvailable || cardAvailable ? (
                                    <button
                                        type="button"
                                        onClick={() => setPaymentMethod(cashAvailable ? "CASH" : "CARD")}
                                        aria-pressed
                                        className={`flex h-10 items-center justify-center gap-2 rounded-lg border-2 font-black ${cashAvailable ? "border-green-600 bg-green-50 text-green-700" : "border-blue-600 bg-blue-50 text-blue-700"}`}
                                    >
                                        {cashAvailable ? <Banknote size={20} /> : <Wallet size={20} />}
                                        {cashAvailable ? "CONTANTI" : "CARTA / POS"}
                                    </button>
                                ) : (
                                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm font-semibold text-amber-800">
                                        La postazione selezionata non ha metodi di pagamento configurati. Associa terminale e/o cassetta in impostazioni hardware.
                                    </p>
                                )}
                            </div>

                        </div>

                        <div className="space-y-3">
                            {effectivePaymentMethod === "CASH" ? (
                                <div
                                    className="space-y-2 rounded-xl border-2 border-green-200 bg-green-50 p-2.5"
                                    data-testid="cash-change-card"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-xs font-black uppercase tracking-widest text-green-700">Calcolo resto</p>
                                            <p className="text-sm font-semibold text-green-900">Contante ricevuto (facoltativo).</p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Totale</p>
                                            <p className="whitespace-nowrap text-lg font-black text-green-900 sm:text-xl">{formatCents(effectiveTotalCents)}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label htmlFor="cash-received-input" className="text-xs font-black uppercase tracking-widest text-slate-600">
                                            Ricevuto
                                        </Label>
                                        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                                            <Input
                                                id="cash-received-input"
                                                data-testid="cash-received-input"
                                                inputMode="decimal"
                                                value={cashReceivedInput}
                                                onChange={(event) => setCashReceivedInput(normalizeCashReceivedInput(event.target.value))}
                                                placeholder="0,00"
                                                aria-invalid={Boolean(cashReceivedError)}
                                                aria-describedby={cashReceivedError ? "cash-change-status" : undefined}
                                                className="h-11 rounded-lg border-2 bg-white text-right text-2xl font-black"
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-11 min-w-14 rounded-lg bg-white font-black"
                                                onClick={() => setCashReceivedInput((current) => current.slice(0, -1))}
                                                aria-label="Cancella ultima cifra"
                                            >
                                                DEL
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-11 min-w-12 rounded-lg bg-white font-black"
                                                onClick={() => setCashReceivedInput("")}
                                                aria-label="Cancella importo ricevuto"
                                            >
                                                C
                                            </Button>
                                        </div>
                                    </div>

                                    {cashReceivedError ? (
                                        <p
                                            id="cash-change-status"
                                            data-testid="cash-change-missing"
                                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-center text-base font-black text-rose-700"
                                        >
                                            {cashReceivedError}
                                        </p>
                                    ) : cashChangeCents !== null ? (
                                        <p
                                            id="cash-change-status"
                                            data-testid="cash-change-due"
                                            className="rounded-lg border border-green-300 bg-white px-3 py-2 text-center text-base font-black text-green-800"
                                        >
                                            Resto {formatCents(cashChangeCents)}
                                        </p>
                                    ) : null}

                                    {!isCashKeypadExpanded ? (
                                        <div className="grid grid-cols-3 gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-10 rounded-lg bg-white text-sm font-black"
                                                onClick={() => setCashReceivedFromCents(effectiveTotalCents)}
                                            >
                                                Esatto {formatCents(effectiveTotalCents)}
                                            </Button>
                                            {cashReceivedSuggestions.map((amountCents) => (
                                                <Button
                                                    key={amountCents}
                                                    type="button"
                                                    variant="outline"
                                                    className="h-10 rounded-lg bg-white text-sm font-black"
                                                    onClick={() => setCashReceivedFromCents(amountCents)}
                                                >
                                                    {formatCents(amountCents)}
                                                </Button>
                                            ))}
                                        </div>
                                    ) : null}

                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-10 w-full rounded-lg bg-white text-sm font-black"
                                        onClick={() => setIsCashKeypadExpanded((current) => !current)}
                                        aria-expanded={isCashKeypadExpanded}
                                    >
                                        {isCashKeypadExpanded ? "Nascondi tastierino" : "Tastierino manuale"}
                                    </Button>

                                    {isCashKeypadExpanded ? (
                                        <div className="grid grid-cols-3 gap-2" aria-label="Tastierino contante ricevuto">
                                            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "00"].map((key) => (
                                                <Button
                                                    key={key}
                                                    type="button"
                                                    variant="outline"
                                                    className="h-10 rounded-lg bg-white text-xl font-black"
                                                    onClick={() => appendCashReceivedKey(key)}
                                                >
                                                    {key}
                                                </Button>
                                            ))}
                                        </div>
                                    ) : null}

                                </div>
                            ) : effectivePaymentMethod === "CARD" ? (
                                <div
                                    className="flex min-h-40 flex-col items-center justify-center rounded-xl border-2 border-blue-200 bg-blue-50 p-5 text-center"
                                    data-testid="card-payment-guide"
                                >
                                    <Wallet className="mb-3 h-8 w-8 text-blue-600" />
                                    <p className="text-base font-black text-blue-900">Pagamento con carta</p>
                                    <p className="mt-1 max-w-xs text-sm font-semibold text-blue-800">
                                        Completa il pagamento sul terminale POS, poi premi Conferma.
                                    </p>
                                </div>
                            ) : null}

                        </div>

                        {stockShortages.length > 0 ? (
                                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 lg:col-span-2">
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
                                            disabled={isProcessing || isCheckoutOutcomeUnknown}
                                        >
                                            Prosegui comunque
                                        </Button>
                                    </div>
                                </div>
                        ) : null}
                        {isCheckoutOutcomeUnknown ? (
                            <div
                                role="alert"
                                data-testid="checkout-outcome-unknown"
                                className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800 lg:col-span-2"
                            >
                                <p>Conferma bloccata: verifica prima l&apos;ordine in Ordini.</p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="mt-2 w-full border-rose-300 bg-white text-rose-800 hover:bg-rose-100"
                                    onClick={discardUnknownCheckout}
                                >
                                    Svuota e avvia nuovo ordine
                                </Button>
                            </div>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2 border-t bg-white p-3 dark:bg-slate-950 sm:px-4">
                        <Button
                            variant="outline"
                            className="h-12 flex-1 rounded-lg text-lg font-bold"
                            onClick={() => handleCheckoutDialogOpenChange(false)}
                            disabled={isProcessing}
                        >
                            ANNULLA
                        </Button>
                        <Button
                            className="h-12 flex-1 rounded-lg bg-green-600 text-lg font-bold hover:bg-green-700"
                            onClick={() => void handleCheckout()}
                            disabled={checkoutDisabled}
                        >
                            {isProcessing ? <Loader2 className="animate-spin" /> : "CONFERMA"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Apertura Cassa */}
            <Dialog open={isOpenCashDialogOpen} onOpenChange={setIsOpenCashDialogOpen}>
                <DialogContent className="max-h-[92dvh] max-w-[480px] overflow-y-auto rounded-3xl p-0">
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
                <DialogContent className="max-h-[92dvh] max-w-[560px] overflow-y-auto rounded-3xl p-0">
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
                        setRetryingPrinterKey(null)
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
                        {feedbackModal.action?.type === "RETRY_FAILED_PRINTS" ? (
                            <div className="space-y-2">
                                {feedbackModal.action.failedPrinters.map((printer) => (
                                    <div key={printer.key} className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                                        <p className="font-black text-rose-900">{printer.name} · {printer.count} {printer.count === 1 ? "stampa" : "stampe"}</p>
                                        {printer.error ? <p className="text-sm text-rose-700">{printer.error}</p> : null}
                                        <Button type="button" variant="outline" className="mt-2 w-full rounded-lg font-bold" onClick={() => void handleRetryFailedPrintsFromModal(printer)} disabled={retryingPrinterKey !== null}>
                                            {retryingPrinterKey === printer.key ? "Reinvio..." : `Riprova — ${printer.name}`}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        <div className="flex items-center justify-end gap-3">
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

            <Dialog
                open={Boolean(pendingOrderLoadRequest)}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingOrderLoadRequest(null)
                    }
                }}
            >
                <DialogContent className="max-w-[460px] rounded-3xl p-0">
                    <DialogHeader className="border-b bg-amber-50 px-6 py-5">
                        <DialogTitle className="text-xl font-black text-amber-800">
                            Sostituire il carrello corrente?
                        </DialogTitle>
                        <p className="text-sm font-semibold text-amber-700">
                            L&apos;ordine pendente sostituirà prodotti, cliente e tavolo già inseriti nel POS.
                        </p>
                    </DialogHeader>
                    <div className="space-y-4 p-6">
                        <p className="text-sm font-semibold text-slate-700">
                            Codice da caricare: <span className="font-black">{pendingOrderLoadRequest?.code}</span>
                        </p>
                        <div className="flex gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                className="flex-1 rounded-xl py-5 font-bold"
                                onClick={() => setPendingOrderLoadRequest(null)}
                            >
                                ANNULLA
                            </Button>
                            <Button
                                type="button"
                                className="flex-1 rounded-xl bg-amber-600 py-5 font-black hover:bg-amber-700"
                                onClick={() => {
                                    const code = pendingOrderLoadRequest?.code
                                    setPendingOrderLoadRequest(null)
                                    if (code) {
                                        void handleLoadOrderByCode(code, { skipDraftConfirmation: true })
                                    }
                                }}
                            >
                                SOSTITUISCI
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal Carica Ordine da Codice */}
            {isMobilePos ? (
                <Sheet open={isCodeDialogOpen} onOpenChange={handleCodeDialogOpenChange}>
                    <SheetContent side="bottom" className="max-h-[82dvh] rounded-t-3xl px-0 pb-0 lg:hidden">
                        <SheetHeader className="border-b border-[#d9e6f8] px-4 pb-3">
                            <SheetTitle className="flex items-center gap-3 text-xl font-black">
                                <Search className="h-5 w-5 text-indigo-600" />
                                Carica ordine da codice
                            </SheetTitle>
                            <SheetDescription>
                                Inserisci il numero ordine e recupera il carrello da chiudere.
                            </SheetDescription>
                        </SheetHeader>
                        <div className="space-y-4 overflow-y-auto px-4 py-4">
                            <div className="flex items-center gap-2">
                                <Label htmlFor="order-code" className="sr-only">Numero ordine</Label>
                                <Input
                                    id="order-code"
                                    aria-label="Numero ordine"
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
                            </div>
                        </div>
                    </SheetContent>
                </Sheet>
            ) : (
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
                            <div className="flex items-center gap-2">
                                <Label htmlFor="order-code" className="sr-only">Numero ordine</Label>
                                <Input
                                    id="order-code"
                                    aria-label="Numero ordine"
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
                            {recentPendingOrdersContent}
                        </div>
                    </DialogContent>
                </Dialog>
            )}

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
                                        type="button"
                                        key={device._id}
                                        onClick={() => selectPosDevice(device._id)}
                                        aria-pressed={isSelected}
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
