"use client"

import { useMemo, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { updatePosStock } from "@/app/pos/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type StockProduct = {
    _id: string
    name: string
    shortName?: string
    categoryId: string
    stockQuantity?: number | null
    variants?: Array<{ optionName: string; priceVariation: number; stockQuantity?: number | null }>
}

type UpdatedProduct = {
    id: string
    stockQuantity: number | null
    isSoldOut: boolean
    stockStatus: "UNLIMITED" | "OK" | "LOW" | "OUT"
    variants: Array<{ optionName: string; priceVariation: number; stockQuantity: number | null }>
}

function normalize(value: string) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

function StockRow({ eventId, product, variantName, value, onUpdated }: {
    eventId: string
    product: StockProduct
    variantName?: string
    value: number | null
    onUpdated: (product: UpdatedProduct) => void
}) {
    const [draft, setDraft] = useState(value === null ? "" : String(value))
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    const save = async (next = draft) => {
        const stockQuantity = next.trim() === "" ? null : Number(next)
        if (stockQuantity !== null && (!Number.isInteger(stockQuantity) || stockQuantity < 0)) {
            setError("Inserisci un intero positivo")
            return
        }
        setSaving(true)
        setError("")
        const result = await updatePosStock({ eventId, productId: product._id, variantName, stockQuantity })
        setSaving(false)
        if (!result.success) return setError(result.error)
        onUpdated(result.product)
    }

    // send the relative change, never an absolute value derived from this stale snapshot
    const delta = async (amount: number) => {
        setSaving(true)
        setError("")
        const result = await updatePosStock({ eventId, productId: product._id, variantName, stockQuantity: null, stockDelta: amount })
        setSaving(false)
        if (!result.success) return setError(result.error)
        const updated = variantName
            ? result.product.variants.find((variant) => variant.optionName === variantName)?.stockQuantity ?? null
            : result.product.stockQuantity
        setDraft(updated === null ? "" : String(updated))
        onUpdated(result.product)
    }

    return (
        <div className="border-t border-slate-200 py-2 first:border-t-0" data-testid={variantName ? `stock-variant-${product._id}-${variantName}` : `stock-product-${product._id}`}>
            <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[150px] flex-1">
                    <p className={variantName ? "text-sm font-semibold text-slate-700" : "text-base font-black text-slate-900"}>
                        {variantName || product.shortName || product.name}
                    </p>
                    {variantName ? <p className="text-xs text-slate-500">Variante di {product.shortName || product.name} · gestione manuale, non scala i consumi automatici</p> : null}
                </div>
                <Input
                    aria-label={`Scorta ${variantName || product.name}`}
                    className="h-10 w-24 text-center text-base font-bold"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    type="number"
                    value={draft}
                    placeholder="∞"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void save() }}
                />
                <Button type="button" size="sm" variant="outline" onClick={() => delta(-1)} disabled={saving}>-1</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => delta(1)} disabled={saving}>+1</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => delta(5)} disabled={saving}>+5</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setDraft("0"); void save("0") }} disabled={saving}>Esaurito</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setDraft(""); void save("") }} disabled={saving}>Illimitata</Button>
                <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salva"}
                </Button>
            </div>
            {error ? <p className="mt-1 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
        </div>
    )
}

export function PosQuickStockDialog({ open, onOpenChange, eventId, categories, products, onUpdated }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    eventId: string
    categories: Array<{ _id: string; name: string }>
    products: StockProduct[]
    onUpdated: (product: UpdatedProduct) => void
}) {
    const [query, setQuery] = useState("")
    const [categoryId, setCategoryId] = useState("")
    const visible = useMemo(() => {
        const needle = normalize(query.trim())
        return products.filter((product) => (!categoryId || product.categoryId === categoryId)
            && (!needle || normalize([product.name, product.shortName, ...(product.variants || []).map((variant) => variant.optionName)].join(" ")).includes(needle)))
    }, [categoryId, products, query])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
                <DialogHeader><DialogTitle>Scorte rapide</DialogTitle></DialogHeader>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="relative flex-1">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                        <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca prodotto o variante" aria-label="Cerca nelle scorte" />
                    </label>
                    <select className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label="Filtra scorte per categoria">
                        <option value="">Tutte le categorie</option>
                        {categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
                    </select>
                </div>
                <div className="min-h-0 overflow-y-auto pr-1">
                    {visible.map((product) => (
                        <div key={product._id} className="mb-2 rounded-lg border border-slate-200 px-3">
                            <StockRow eventId={eventId} product={product} value={product.stockQuantity ?? null} onUpdated={onUpdated} />
                            {(product.variants || []).map((variant) => (
                                <StockRow key={variant.optionName} eventId={eventId} product={product} variantName={variant.optionName} value={variant.stockQuantity ?? null} onUpdated={onUpdated} />
                            ))}
                        </div>
                    ))}
                    {visible.length === 0 ? <p className="py-8 text-center text-sm font-semibold text-slate-500">Nessun prodotto trovato.</p> : null}
                </div>
            </DialogContent>
        </Dialog>
    )
}
