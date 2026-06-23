"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { DeleteForm } from "@/components/delete-form";
import { EditProductDialog } from "@/components/edit-product-dialog";
import { getStockLabel } from "@/lib/inventory";
import type { ProductRecipeIngredientOption, ProductRecipeItemState } from "@/components/product-recipe-editor";

type ProductKind = "STANDARD" | "FIXED_MENU";
type SalesChannel = "POS" | "MENU";

interface MenuComponentState {
    productId: string;
    quantity: number;
}

interface MenuChoiceGroupState {
    id: string;
    name: string;
    minSelections: number;
    maxSelections: number;
    options: MenuComponentState[];
}

interface ProductOption {
    id: string;
    name: string;
    kind?: ProductKind;
}

interface SerializedVariant {
    optionName: string;
    priceVariation: number;
    stockQuantity?: number | null;
}

interface SerializedProduct {
    id: string;
    name: string;
    shortName: string;
    description: string;
    categoryId: string;
    categoryName: string;
    basePrice: number;
    volunteerPrice?: number | null;
    stockQuantity?: number | null;
    isSoldOut: boolean;
    availableDays: string[];
    kind: ProductKind;
    availableOnlyInMenus: boolean;
    splitKitchenPrintPerUnit: boolean;
    salesChannels: SalesChannel[];
    menuComponents: MenuComponentState[];
    menuChoiceGroups: MenuChoiceGroupState[];
    recipeItems: ProductRecipeItemState[];
    variants: SerializedVariant[];
    priceLabel: string;
    salesChannelsLabel: string;
    stockLabel: string;
    stockTone: "OUT" | "LOW" | "DEFAULT";
    availabilityLabel: string;
    menuSummary: string;
    recipeSummary: string;
}

interface ProductTableProps {
    eventId: string;
    products: SerializedProduct[];
    categories: Array<{ id: string; name: string }>;
    productOptions: ProductOption[];
    ingredients: ProductRecipeIngredientOption[];
    updateAction: (formData: FormData) => Promise<{ success?: boolean; error?: string } | void>;
    deleteAction: (formData: FormData) => Promise<void>;
    addVariantAction: (formData: FormData) => Promise<void>;
    removeVariantAction: (formData: FormData) => Promise<void>;
    bulkUpdateProductKitchenPrintModeAction: (formData: FormData) => Promise<{ success?: boolean; error?: string } | void>;
}

function getPrintModeUi(product: SerializedProduct) {
    if (product.kind === "FIXED_MENU") {
        return {
            label: "Derivata dai componenti",
            className: "bg-sky-100 text-sky-700"
        };
    }

    if (product.splitKitchenPrintPerUnit) {
        return {
            label: "Separata per unità",
            className: "bg-amber-100 text-amber-800"
        };
    }

    return {
        label: "Standard",
        className: "bg-emerald-100 text-emerald-800"
    };
}

function getStockToneClass(tone: SerializedProduct["stockTone"]) {
    if (tone === "OUT") return "bg-red-100 text-red-700";
    if (tone === "LOW") return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-700";
}

export function ProductTable({
    eventId,
    products,
    categories,
    productOptions,
    ingredients,
    updateAction,
    deleteAction,
    addVariantAction,
    removeVariantAction,
    bulkUpdateProductKitchenPrintModeAction
}: ProductTableProps) {
    const [isReady, setIsReady] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [batchMode, setBatchMode] = useState<boolean | null>(null);
    const [batchError, setBatchError] = useState<string | null>(null);
    const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);
    const masterCheckboxRef = useRef<HTMLInputElement>(null);

    const eligibleIds = useMemo(
        () => products.filter((product) => product.kind === "STANDARD").map((product) => product.id),
        [products]
    );

    useEffect(() => {
        setSelectedIds((current) => current.filter((id) => eligibleIds.includes(id)));
    }, [eligibleIds]);

    useEffect(() => {
        setIsReady(true);
    }, []);

    const eligibleIdSet = useMemo(() => new Set(eligibleIds), [eligibleIds]);
    const allSelected = eligibleIds.length > 0 && selectedIds.length === eligibleIds.length;
    const someSelected = selectedIds.length > 0 && !allSelected;

    useEffect(() => {
        if (!masterCheckboxRef.current) return;
        masterCheckboxRef.current.indeterminate = someSelected;
    }, [someSelected]);

    const clearSelection = () => {
        setSelectedIds([]);
        setBatchError(null);
    };

    const selectAll = () => {
        setSelectedIds(eligibleIds);
        setBatchError(null);
    };

    const toggleProductSelection = (productId: string) => {
        if (!eligibleIdSet.has(productId)) return;
        setSelectedIds((current) => (
            current.includes(productId)
                ? current.filter((id) => id !== productId)
                : [...current, productId]
        ));
        setBatchError(null);
    };

    const applyBatchMode = async () => {
        if (batchMode === null || selectedIds.length === 0) return;
        setIsSubmittingBatch(true);
        setBatchError(null);

        const formData = new FormData();
        formData.set("eventId", eventId);
        formData.set("productIdsJson", JSON.stringify(selectedIds));
        formData.set("splitKitchenPrintPerUnit", batchMode ? "true" : "false");

        try {
            const result = await bulkUpdateProductKitchenPrintModeAction(formData);
            if (result && typeof result === "object" && "error" in result && result.error) {
                setBatchError(result.error);
                return;
            }

            setBatchMode(null);
            clearSelection();
        } catch (error) {
            console.error("Errore durante l'aggiornamento massivo della stampa comanda", error);
            setBatchError("Aggiornamento massivo non riuscito. Riprova.");
        } finally {
            setIsSubmittingBatch(false);
        }
    };

    return (
        <div className="space-y-4">
            <span className="sr-only" data-testid="product-table-ready">
                {isReady ? "ready" : "loading"}
            </span>
            {selectedIds.length > 0 ? (
                <div className="rounded-lg border bg-slate-50 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <p className="text-sm font-medium">
                            {selectedIds.length} prodotti selezionati
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="product-select-all"
                                onClick={selectAll}
                            >
                                Seleziona tutto
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="product-clear-selection"
                                onClick={clearSelection}
                            >
                                Annulla selezione
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="product-bulk-mode-standard"
                                onClick={() => setBatchMode(false)}
                            >
                                Imposta standard
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                data-testid="product-bulk-mode-split"
                                onClick={() => setBatchMode(true)}
                            >
                                Imposta separata per unità
                            </Button>
                        </div>
                    </div>
                    {batchError ? (
                        <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                            {batchError}
                        </p>
                    ) : null}
                </div>
            ) : null}

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[44px]">
                            <input
                                ref={masterCheckboxRef}
                                type="checkbox"
                                aria-label="Seleziona tutti i prodotti"
                                checked={allSelected}
                                onChange={(event) => {
                                    if (event.target.checked) {
                                        selectAll();
                                    } else {
                                        clearSelection();
                                    }
                                }}
                            />
                        </TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Nome breve</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Canali</TableHead>
                        <TableHead>Prezzo / Volontari</TableHead>
                        <TableHead>Scorte</TableHead>
                        <TableHead>Disponibilità</TableHead>
                        <TableHead>Stampa comanda</TableHead>
                        <TableHead>Menu</TableHead>
                        <TableHead>Ricetta</TableHead>
                        <TableHead>Varianti</TableHead>
                        <TableHead className="w-[120px]">Azioni</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {products.map((product) => {
                        const printModeUi = getPrintModeUi(product);
                        const isSelectable = product.kind === "STANDARD";
                        const isSelected = selectedIds.includes(product.id);

                        return (
                            <TableRow
                                key={product.id}
                                data-state={isSelected ? "selected" : undefined}
                                data-testid={`product-row-${product.id}`}
                            >
                                <TableCell>
                                    <input
                                        type="checkbox"
                                        aria-label={`Seleziona ${product.name}`}
                                        data-testid={`product-checkbox-${product.id}`}
                                        checked={isSelected}
                                        disabled={!isSelectable}
                                        onChange={() => toggleProductSelection(product.id)}
                                    />
                                </TableCell>
                                <TableCell className="font-medium">{product.name}</TableCell>
                                <TableCell className="font-medium text-slate-600">{product.shortName || "-"}</TableCell>
                                <TableCell>{product.categoryName}</TableCell>
                                <TableCell>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                                        {product.kind === "FIXED_MENU" ? "Menu fisso" : "Standard"}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                                        {product.salesChannelsLabel}
                                    </span>
                                </TableCell>
                                <TableCell>{product.priceLabel}</TableCell>
                                <TableCell>
                                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${getStockToneClass(product.stockTone)}`}>
                                        {product.stockLabel}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                                        {product.availabilityLabel}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span
                                        data-testid="product-print-mode"
                                        className={`rounded-full px-2 py-1 text-xs font-bold ${printModeUi.className}`}
                                    >
                                        {printModeUi.label}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {product.availableOnlyInMenus ? (
                                            <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">
                                                Solo menu
                                            </span>
                                        ) : null}
                                        {product.kind === "FIXED_MENU" ? (
                                            <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-700">
                                                {product.menuSummary}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-slate-400">-</span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">
                                        {product.kind === "STANDARD" ? product.recipeSummary : "Derivata dai componenti"}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    {product.kind === "STANDARD" && !product.availableOnlyInMenus ? (
                                        <div className="flex flex-wrap gap-1">
                                            {product.variants.map((variant, index) => (
                                                <span key={`${variant.optionName}-${index}`} className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded flex items-center gap-1 group">
                                                    <span>
                                                        {variant.optionName} ({variant.priceVariation >= 0 ? "+" : ""}{variant.priceVariation}€)
                                                        {" · "}
                                                        {getStockLabel(variant.stockQuantity, false)}
                                                    </span>
                                                    <form action={removeVariantAction} className="flex items-center">
                                                        <input type="hidden" name="productId" value={product.id} />
                                                        <input type="hidden" name="eventId" value={eventId} />
                                                        <input type="hidden" name="optionName" value={variant.optionName} />
                                                        <button type="submit" className="text-red-500 hover:bg-red-200 rounded-full cursor-pointer ml-1 p-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    </form>
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-slate-400">Non applicabili</span>
                                    )}
                                </TableCell>
                                <TableCell className="flex gap-2">
                                    <EditProductDialog
                                        product={{
                                            id: product.id,
                                            name: product.name,
                                            shortName: product.shortName,
                                            description: product.description,
                                            categoryId: product.categoryId,
                                            basePrice: product.basePrice,
                                            volunteerPrice: product.volunteerPrice,
                                            stockQuantity: product.stockQuantity ?? null,
                                            availableDays: product.availableDays,
                                            kind: product.kind,
                                            availableOnlyInMenus: product.availableOnlyInMenus,
                                            splitKitchenPrintPerUnit: product.splitKitchenPrintPerUnit,
                                            salesChannels: product.salesChannels,
                                            menuComponents: product.menuComponents,
                                            menuChoiceGroups: product.menuChoiceGroups,
                                            recipeItems: product.recipeItems,
                                        }}
                                        eventId={eventId}
                                        categories={categories}
                                        ingredients={ingredients}
                                        products={productOptions}
                                        updateAction={updateAction}
                                    />
                                    {product.kind === "STANDARD" && !product.availableOnlyInMenus ? (
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button variant="outline" size="icon" className="h-7 w-7" title="Aggiungi Variante">
                                                    <span className="font-bold">+</span>
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <form action={addVariantAction}>
                                                    <input type="hidden" name="productId" value={product.id} />
                                                    <input type="hidden" name="eventId" value={eventId} />
                                                    <DialogHeader>
                                                        <DialogTitle>Gestisci Varianti per {product.name}</DialogTitle>
                                                        <DialogDescription>
                                                            Aggiungi una nuova opzione variante con prezzo e scorte dedicate.
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <div className="grid gap-4 py-4">
                                                        <div className="grid gap-2">
                                                            <Label htmlFor={`optionName-${product.id}`}>Nome Opzione</Label>
                                                            <Input id={`optionName-${product.id}`} name="optionName" placeholder="Extra Formaggio..." required />
                                                        </div>
                                                        <div className="grid gap-2">
                                                            <Label htmlFor={`priceVariation-${product.id}`}>Varianza Prezzo (€)</Label>
                                                            <Input id={`priceVariation-${product.id}`} name="priceVariation" type="number" step="0.01" placeholder="1.00" required />
                                                        </div>
                                                        <div className="grid gap-2">
                                                            <Label htmlFor={`stockQuantity-${product.id}`}>Scorte Variante</Label>
                                                            <Input
                                                                id={`stockQuantity-${product.id}`}
                                                                name="stockQuantity"
                                                                type="number"
                                                                min="0"
                                                                step="1"
                                                                inputMode="numeric"
                                                                placeholder="Illimitato"
                                                            />
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button type="submit">Aggiungi Variante</Button>
                                                    </DialogFooter>
                                                </form>
                                            </DialogContent>
                                        </Dialog>
                                    ) : null}
                                    <DeleteForm
                                        id={product.id}
                                        idName="id"
                                        hiddenFields={[{ name: "eventId", value: eventId }]}
                                        message="Eliminare questo prodotto?"
                                        action={deleteAction}
                                        buttonSize="xs"
                                        iconSize={16}
                                    />
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>

            <AlertDialog open={batchMode !== null} onOpenChange={(open) => {
                if (!open && !isSubmittingBatch) {
                    setBatchMode(null);
                }
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {batchMode ? "Applicare la stampa separata per unità?" : "Ripristinare la stampa standard?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {batchMode
                                ? `L'azione imposterà la stampa comanda separata per unità su ${selectedIds.length} prodotti selezionati.`
                                : `L'azione ripristinerà la stampa standard su ${selectedIds.length} prodotti selezionati.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isSubmittingBatch}>Annulla</AlertDialogCancel>
                        <Button type="button" disabled={isSubmittingBatch} onClick={() => void applyBatchMode()}>
                            {isSubmittingBatch ? "Applicazione..." : "Conferma"}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
