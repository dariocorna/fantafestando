"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { updatePosStock } from "@/app/pos/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type StockProduct = {
    _id: string
    name: string
    shortName?: string
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

function StockRow({ eventId, product, variantName, value, onUpdated }: {
    eventId: string
    product: StockProduct
    variantName?: string
    value: number | null
    onUpdated: (product: UpdatedProduct) => void
}) {
    const label = variantName || product.shortName || product.name
    const accessibleLabel = variantName
        ? `${product.shortName || product.name} - ${variantName}`
        : label
    const [draft, setDraft] = useState(value === null ? "" : String(value))
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    const [success, setSuccess] = useState("")
    const errorId = useId()
    const syncedValue = useRef(value)

    useEffect(() => {
        if (dirty || saving) {
            syncedValue.current = value
            return
        }
        if (Object.is(syncedValue.current, value)) return
        syncedValue.current = value
        setDraft(value === null ? "" : String(value))
    }, [dirty, saving, value])

    const save = (next = draft) => {
        setSuccess("")
        const stockQuantity = next.trim() === "" ? null : Number(next)
        if (stockQuantity !== null && (!Number.isInteger(stockQuantity) || stockQuantity < 0)) {
            setError("Inserisci un intero maggiore o uguale a zero")
            return
        }

        setSaving(true)
        setError("")
        void (async () => {
            try {
                const result = await updatePosStock({
                    eventId,
                    productId: product._id,
                    variantName,
                    stockQuantity,
                })
                if (!result.success) {
                    setError(result.error)
                    return
                }

                const updatedQuantity = variantName
                    ? result.product.variants.find((variant) => variant.optionName === variantName)?.stockQuantity ?? null
                    : result.product.stockQuantity
                onUpdated(result.product)
                setDraft(updatedQuantity === null ? "" : String(updatedQuantity))
                setDirty(false)
                setSuccess(`Scorta ${accessibleLabel} aggiornata a ${updatedQuantity === null ? "illimitata" : updatedQuantity}`)
            } catch {
                setError("Impossibile aggiornare le scorte. Riprova.")
            } finally {
                setSaving(false)
            }
        })()
    }

    return (
        <form
            className="border-t border-slate-300 py-2 first:border-t-0"
            data-testid={variantName ? `stock-variant-${product._id}-${variantName}` : `stock-product-${product._id}`}
            noValidate
            onSubmit={(event) => {
                event.preventDefault()
                save()
            }}
        >
            <div className="flex flex-wrap items-center gap-2">
                <p className="w-full text-sm font-bold leading-tight text-slate-800 sm:min-w-24 sm:flex-1">
                    {variantName ? label : "Prodotto"}
                </p>
                <Input
                    aria-label={`Scorta ${accessibleLabel}`}
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={Boolean(error)}
                    className="h-11 w-24 text-center text-base font-bold"
                    disabled={saving}
                    inputMode="numeric"
                    min={0}
                    step={1}
                    type="number"
                    value={draft}
                    placeholder="∞"
                    onChange={(event) => {
                        setDraft(event.target.value)
                        setDirty(true)
                        setError("")
                        setSuccess("")
                    }}
                />
                <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-3 font-bold"
                    aria-label={`Imposta scorta illimitata per ${accessibleLabel}`}
                    disabled={saving}
                    onClick={() => save("")}
                >
                    Illimitata
                </Button>
                <Button
                    type="submit"
                    className="h-11 min-w-20 px-3 font-bold"
                    aria-label={`Salva scorta ${accessibleLabel}`}
                    aria-busy={saving}
                    disabled={saving}
                >
                    {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Salva
                </Button>
            </div>
            {error ? <p id={errorId} className="mt-1 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
            {success ? <p className="sr-only" role="status">{success}</p> : null}
        </form>
    )
}

export function PosInlineStockEditor({
    eventId,
    product,
    displayName,
    priceLabel,
    stockLabel,
    variant,
    borderColor,
    backgroundColor,
    boxShadow,
    onUpdated,
}: {
    eventId: string
    product: StockProduct
    displayName: string
    priceLabel: string
    stockLabel?: string
    variant: "mobile" | "modern"
    borderColor: string
    backgroundColor: string
    boxShadow?: string
    onUpdated: (product: UpdatedProduct) => void
}) {
    const cardClass = variant === "mobile"
        ? "w-full rounded-3xl border-2 px-4 py-4 text-left shadow-sm"
        : "min-h-[136px] w-full border-2 px-2.5 py-2.5 text-left"
    const priceClass = `inline-flex shrink-0 justify-center border bg-white/90 px-3 py-2 text-lg font-black leading-none ${variant === "mobile" ? "min-w-[88px] rounded-xl" : "min-w-[96px]"}`

    return (
        <section
            aria-label={`Modifica scorte ${displayName}`}
            className={cardClass}
            data-testid={`pos-inline-stock-${product._id}`}
            style={{ borderColor, backgroundColor, boxShadow }}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="line-clamp-2 min-h-10 text-lg font-black leading-tight text-slate-900">{displayName}</p>
                    {stockLabel ? (
                        <span className="mt-1 inline-flex rounded-full border border-slate-300 bg-white/90 px-2 py-1 text-xs font-bold text-slate-700">
                            {stockLabel}
                        </span>
                    ) : null}
                </div>
                <span className={priceClass} style={{ color: borderColor, borderColor }}>
                    {priceLabel}
                </span>
            </div>
            <div className="mt-2 rounded-lg bg-white/75 px-2">
                <StockRow
                    eventId={eventId}
                    product={product}
                    value={product.stockQuantity ?? null}
                    onUpdated={onUpdated}
                />
                {(product.variants || []).map((productVariant) => (
                    <StockRow
                        key={productVariant.optionName}
                        eventId={eventId}
                        product={product}
                        variantName={productVariant.optionName}
                        value={productVariant.stockQuantity ?? null}
                        onUpdated={onUpdated}
                    />
                ))}
            </div>
        </section>
    )
}
