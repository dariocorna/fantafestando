"use client"

import { useState, useEffect, useSyncExternalStore } from "react"
import {
    ArrowRight,
    Info,
    X,
    Plus,
    Minus,
    User,
    Hash,
    Loader2
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { motion, AnimatePresence } from "framer-motion"
import { useRouter } from "next/navigation"
import { getCategoryTheme } from "@/lib/category-colors"
import { BrandSectionHeader } from "@/components/brand/brand-section-header"
import { MenuCartDeleteDialog } from "@/components/menu-cart-delete-dialog"
import { createPublicOrder } from "./actions"
import {
    EMPTY_STORED_MENU_CART_ITEMS,
    clearStoredMenuCart,
    readStoredMenuCart,
    subscribeToStoredMenuCart,
    writeStoredMenuCart,
} from "./cart-storage"
import { storePendingEasterEggUpload } from "./easter-egg-upload-storage"
import { storeRecentOrderSummary } from "./recent-order-storage"
import { isTableValueValid, normalizeTableValue } from "@/lib/table-presets"
import { type StockShortage } from "@/lib/inventory"
import { FixedMenuConfigDialog, type FixedMenuChoiceGroupDto, type FixedMenuComponentDto } from "@/components/fixed-menu-config-dialog"
import { buildMenuConfigurationKey, type MenuSelectionInput } from "@/lib/fixed-menu"
import { type StoredMenuCartItem } from "./cart-storage"

interface Product {
    _id: string
    name: string
    description?: string
    basePrice: number
    categoryId: string
    kind?: "STANDARD" | "FIXED_MENU"
    requiresConfiguration?: boolean
    menuComponents?: FixedMenuComponentDto[]
    menuChoiceGroups?: FixedMenuChoiceGroupDto[]
    variants?: { optionName: string; priceVariation: number }[]
}

interface Category {
    _id: string
    name: string
    uiColor?: string
}

type CartItem = StoredMenuCartItem

interface ActiveEventSummary {
    _id: string
    name: string
    settings?: {
        menuHeaderLogoUrl?: string
        askName?: boolean
        askTable?: boolean
        predefinedTables?: string[]
    }
}

export default function CustomerMenu() {
    const [categories, setCategories] = useState<Category[]>([])
    const [products, setProducts] = useState<Product[]>([])
    const [activeEvent, setActiveEvent] = useState<ActiveEventSummary | null>(null)
    const [activeTab, setActiveTab] = useState("")
    const [isCartOpen, setIsCartOpen] = useState(false)
    const router = useRouter()

    // Checkout state
    const [customerName, setCustomerName] = useState("")
    const [tableNumber, setTableNumber] = useState("")
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [checkoutError, setCheckoutError] = useState<string | null>(null)
    const [checkoutShortages, setCheckoutShortages] = useState<StockShortage[]>([])
    const [configuringProduct, setConfiguringProduct] = useState<Product | null>(null)

    const normalizedTableValue = normalizeTableValue(tableNumber)
    const tableValueValid = isTableValueValid(tableNumber)
    const predefinedTables = activeEvent?.settings?.predefinedTables || []
    const cart = useSyncExternalStore(
        subscribeToStoredMenuCart,
        () => readStoredMenuCart(activeEvent?._id || null) as CartItem[],
        () => EMPTY_STORED_MENU_CART_ITEMS as CartItem[],
    )

    useEffect(() => {
        const fetchData = async () => {
            const res = await fetch('/api/pos/init?channel=menu', { cache: "no-store" })
            const data = await res.json()
            if (data.event) {
                setActiveEvent({
                    ...data.event,
                    settings: {
                        ...data.event.settings,
                        predefinedTables: Array.isArray(data.event.predefinedTables) ? data.event.predefinedTables : (data.event.settings?.predefinedTables || [])
                    }
                })
                setCategories(data.categories)
                setProducts(data.products)
                if (data.categories.length > 0) setActiveTab(data.categories[0]._id)
            }
        }
        fetchData()
    }, [])

    const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0)
    const totalPrice = cart.reduce((acc, item) => acc + (item.basePrice * item.quantity), 0)

    const addConfiguredToCart = (
        product: Product,
        options?: {
            menuSelections?: MenuSelectionInput[]
            selectedOptionLabels?: string[]
        }
    ) => {
        const configurationKey = buildMenuConfigurationKey(options?.menuSelections || [])
        const lineId = configurationKey ? `${product._id}:${configurationKey}` : product._id
        const exists = cart.find((item) => item.lineId === lineId)
        const nextCart = exists
            ? cart.map((item) => item.lineId === lineId ? { ...item, quantity: item.quantity + 1 } : item)
            : [...cart, {
                lineId,
                _id: product._id,
                name: product.name,
                description: product.description,
                categoryId: product.categoryId,
                basePrice: product.basePrice,
                quantity: 1,
                kind: product.kind || "STANDARD",
                selectedOptions: options?.selectedOptionLabels || [],
                menuSelections: options?.menuSelections || [],
            }]

        writeStoredMenuCart(nextCart, activeEvent?._id || null)
    }

    const addToCart = (product: Product) => {
        if (product.requiresConfiguration) {
            setConfiguringProduct(product)
            return
        }
        addConfiguredToCart(product)
    }

    const removeFromCart = (lineId: string) => {
        const exists = cart.find((item) => item.lineId === lineId)
        const nextCart = exists && exists.quantity > 1
            ? cart.map((item) => item.lineId === lineId ? { ...item, quantity: item.quantity - 1 } : item)
            : cart.filter((item) => item.lineId !== lineId)

        writeStoredMenuCart(nextCart, activeEvent?._id || null)
    }

    const deleteFromCart = (lineId: string) => {
        writeStoredMenuCart(
            cart.filter((item) => item.lineId !== lineId),
            activeEvent?._id || null,
        )
    }

    const handleSubmitOrder = async () => {
        setCheckoutError(null)
        setCheckoutShortages([])

        if (activeEvent?.settings?.askName && !customerName.trim()) {
            setCheckoutError("Inserisci il tuo nome")
            return
        }
        if (activeEvent?.settings?.askTable && !tableValueValid) {
            setCheckoutError("Inserisci il tavolo oppure selezionalo dalla lista")
            return
        }

        setIsSubmitting(true)
        const result = await createPublicOrder({
            eventId: activeEvent?._id || "",
            customer: {
                name: customerName || undefined,
                table: normalizedTableValue || undefined
            },
            totalAmount: totalPrice,
            cart: cart.map(item => ({
                productId: item._id,
                snapshotName: item.name,
                quantity: item.quantity,
                selectedOptions: (item.selectedOptions || []).map((option) => ({
                    name: option,
                    priceVariation: 0
                })),
                menuSelections: item.menuSelections || []
            }))
        })

        if (result.success) {
            if (result.easterEggUpload) {
                storePendingEasterEggUpload(result.easterEggUpload)
            }
            if (result.orderSummary) {
                storeRecentOrderSummary(result.orderSummary)
            }
            clearStoredMenuCart()
            router.push(
                `/menu/success?code=${encodeURIComponent(result.shortCode || "")}&orderId=${result.orderId}&token=${encodeURIComponent(result.accessToken || "")}`
            )
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

    const askName = activeEvent?.settings?.askName ?? false
    const askTable = activeEvent?.settings?.askTable ?? false

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
                                    {activeEvent?.name || "Festa"}
                                </p>
                                <h1 className="font-brand-display truncate text-2xl font-extrabold tracking-tight text-[var(--brand-blue-700)] md:text-3xl">
                                    {activeEvent?.name || "FantaFestando"}
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
                        <section key={cat._id} id={cat._id} className="scroll-mt-24 space-y-4 md:scroll-mt-28">
                            <BrandSectionHeader title={cat.name} />
                            <div className="grid gap-4">
                                {products
                                    .filter(p => p.categoryId === cat._id)
                                    .map(product => {
                                        const cartQuantity = cart
                                            .filter((item) => item._id === product._id)
                                            .reduce((sum, item) => sum + item.quantity, 0)
                                        const requiresConfiguration = Boolean(product.requiresConfiguration)
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
                                                    {Array.isArray(product.menuComponents) && product.menuComponents.length > 0 ? (
                                                        <p className="mt-2 text-xs font-semibold text-slate-500">
                                                            Include: {product.menuComponents.map((component) => `${component.quantity > 1 ? `${component.quantity}x ` : ""}${component.name}`).join(" • ")}
                                                        </p>
                                                    ) : null}
                                                    {Array.isArray(product.menuChoiceGroups) && product.menuChoiceGroups.length > 0 ? (
                                                        <div className="mt-2 flex flex-wrap gap-2">
                                                            {product.menuChoiceGroups.map((group) => (
                                                                <span key={group.id} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                                                                    {group.name}: scegli {group.minSelections === group.maxSelections ? group.minSelections : `${group.minSelections}-${group.maxSelections}`}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                    <div className="mt-3 text-lg font-black" style={{ color: catTheme.base }}>
                                                        {product.basePrice.toFixed(2)} €
                                                    </div>
                                                </div>

                                                <div className="ml-3 flex flex-col items-center gap-2">
                                                    {requiresConfiguration ? (
                                                        <>
                                                            <button
                                                                onClick={() => setConfiguringProduct(product)}
                                                                className="rounded-2xl border px-4 py-2 text-sm font-black transition-colors"
                                                                style={{
                                                                    backgroundColor: catTheme.softBg,
                                                                    color: catTheme.base,
                                                                    borderColor: catTheme.border
                                                                }}
                                                            >
                                                                Configura
                                                            </button>
                                                            {cartQuantity > 0 ? (
                                                                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">
                                                                    {cartQuantity} nel carrello
                                                                </span>
                                                            ) : null}
                                                        </>
                                                    ) : cartQuantity > 0 ? (
                                                        <div className="flex items-center gap-2 rounded-full bg-slate-100 p-1">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const firstLine = cart.find((item) => item._id === product._id);
                                                                    if (firstLine) removeFromCart(firstLine.lineId);
                                                                }}
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
                    <span>Copyright 2026 FantaFestando</span>
                    <a
                        href="mailto:fantafestando@gmail.com"
                        className="font-semibold text-[var(--brand-blue-700)] underline-offset-2 hover:underline"
                    >
                        fantafestando@gmail.com
                    </a>
                </div>
            </footer>

            {configuringProduct ? (
                <FixedMenuConfigDialog
                    open
                    onOpenChange={(nextOpen) => {
                        if (!nextOpen) setConfiguringProduct(null)
                    }}
                    product={{
                        _id: configuringProduct._id,
                        name: configuringProduct.name,
                        basePrice: configuringProduct.basePrice,
                        menuComponents: configuringProduct.menuComponents || [],
                        menuChoiceGroups: configuringProduct.menuChoiceGroups || []
                    }}
                    onConfirm={(result) => {
                        addConfiguredToCart(configuringProduct, {
                            menuSelections: result.menuSelections,
                            selectedOptionLabels: result.selectedOptionLabels
                        })
                        setConfiguringProduct(null)
                    }}
                />
            ) : null}

            {/* Floating Cart CTA — solo conteggio, no prezzo */}
            <AnimatePresence>
                {cart.length > 0 && !isCartOpen && (
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
                            <ArrowRight size={22} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Cart Overlay — checkout integrato */}
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
                            data-testid="menu-cart-overlay"
                            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[36px] border border-[#d9e6f8] bg-white p-7"
                        >
                            <div className="mb-5 flex items-center justify-between">
                                <h2 className="font-brand-display text-3xl font-extrabold text-[var(--brand-ink)]">Il tuo ordine</h2>
                                <button onClick={() => setIsCartOpen(false)} className="rounded-full bg-slate-100 p-2 text-slate-400">
                                    <X size={24} />
                                </button>
                            </div>

                            {/* Lista articoli con +/- e rimozione */}
                            <div className="space-y-3">
                                {cart.map(item => (
                                    <div key={item.lineId} className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1 rounded-full bg-slate-100 p-0.5">
                                                <button
                                                    onClick={() => removeFromCart(item.lineId)}
                                                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-600"
                                                >
                                                    <Minus size={14} />
                                                </button>
                                                <span className="w-6 text-center text-sm font-black text-slate-800">{item.quantity}</span>
                                                <button
                                                    onClick={() => addConfiguredToCart({
                                                        _id: item._id,
                                                        name: item.name,
                                                        description: item.description,
                                                        basePrice: item.basePrice,
                                                        categoryId: item.categoryId || "",
                                                        kind: item.kind,
                                                        requiresConfiguration: false,
                                                    }, {
                                                        menuSelections: item.menuSelections || [],
                                                        selectedOptionLabels: item.selectedOptions || []
                                                    })}
                                                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand-blue-700)] text-white"
                                                >
                                                    <Plus size={14} />
                                                </button>
                                            </div>
                                            <div>
                                                <span className="text-base font-bold text-slate-800">{item.name}</span>
                                                {Array.isArray(item.selectedOptions) && item.selectedOptions.length > 0 ? (
                                                    <p className="text-xs font-semibold text-slate-500">
                                                        {item.selectedOptions.join(" • ")}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-black text-slate-800">{(item.basePrice * item.quantity).toFixed(2)} €</span>
                                            <MenuCartDeleteDialog
                                                itemName={item.name}
                                                quantity={item.quantity}
                                                onConfirm={() => deleteFromCart(item.lineId)}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Totale */}
                            <div className="mt-6 flex items-center justify-between border-t border-dashed pt-5">
                                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Totale</span>
                                <span className="text-4xl font-black text-[var(--brand-ink)]">{totalPrice.toFixed(2)} €</span>
                            </div>

                            {/* Form dati consegna (se richiesti) */}
                            {(askName || askTable) && (
                                <div className="mt-6 space-y-4 rounded-2xl border border-[#d9e6f8] bg-[#f8fbff] p-5">
                                    {askName && (
                                        <div className="space-y-2">
                                            <Label className="ml-1 text-slate-600 font-bold">Il tuo nome</Label>
                                            <div className="relative">
                                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                                                <Input
                                                    className="h-12 rounded-2xl border border-[#d9e6f8] bg-white pl-12 text-base font-bold"
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

                                    {askTable && (
                                        <div className="space-y-2">
                                            <Label className="ml-1 text-slate-600 font-bold">Tavolo</Label>
                                            <div className="space-y-3 rounded-2xl border border-[#d9e6f8] bg-white p-3">
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
                                                                    className={`rounded-xl border-2 px-3 py-1.5 text-sm font-black transition-colors ${isActive ? "border-[var(--brand-blue-700)] bg-[var(--brand-blue-700)] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-[var(--brand-blue-500)]"}`}
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
                                                        className="h-12 rounded-2xl border border-[#d9e6f8] bg-[#f8fbff] pl-12 text-base font-bold"
                                                        placeholder="Es: B02 oppure VIP TERRAZZA"
                                                        value={tableNumber}
                                                        onChange={(e) => {
                                                            setTableNumber(e.target.value)
                                                            if (checkoutError) setCheckoutError(null)
                                                            if (checkoutShortages.length > 0) setCheckoutShortages([])
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Errore checkout */}
                            {checkoutError && (
                                <div
                                    role="alert"
                                    className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
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
                            )}

                            {/* Bottone INVIA ORDINE — non floating, in fondo al form */}
                            <div className="mt-6">
                                <Button
                                    disabled={isSubmitting || cart.length === 0}
                                    onClick={() => void handleSubmitOrder()}
                                    className="brand-cta-primary flex h-16 w-full items-center justify-center gap-3 rounded-2xl text-lg font-black hover:brightness-105"
                                    data-testid="menu-submit-order"
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
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
