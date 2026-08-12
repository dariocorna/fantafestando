"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pencil } from "lucide-react";
import { useFormStatus } from "react-dom";
import { ProductRecipeEditor, type ProductRecipeIngredientOption, type ProductRecipeItemState } from "@/components/product-recipe-editor";
import {
    DAY_CODES,
    DAY_LABELS_IT,
    type DayCode,
    normalizeAvailableDays,
    serializeAvailableDays
} from "@/lib/product-availability";
import { MAX_PRODUCT_SHORT_NAME_LENGTH } from "@/lib/product-fields";

export type ProductKind = "STANDARD" | "FIXED_MENU";
export type SalesChannel = "POS" | "MENU";

export interface MenuComponentState {
    productId: string;
    quantity: number;
}

export interface MenuChoiceGroupState {
    id: string;
    name: string;
    minSelections: number;
    maxSelections: number;
    options: MenuComponentState[];
}

export interface ProductOption {
    id: string;
    name: string;
    kind?: ProductKind;
}

export interface ProductFormProduct {
    id: string;
    name: string;
    shortName?: string;
    description?: string;
    categoryId: string;
    basePrice: number;
    volunteerPrice?: number | null;
    stockQuantity?: number | null;
    availableDays?: string[];
    kind?: ProductKind;
    availableOnlyInMenus?: boolean;
    splitKitchenPrintPerUnit?: boolean;
    salesChannels?: SalesChannel[];
    menuComponents?: MenuComponentState[];
    menuChoiceGroups?: MenuChoiceGroupState[];
    recipeItems?: ProductRecipeItemState[];
}

export type ProductFormAction = (
    formData: FormData
) => Promise<{ success?: boolean; error?: string } | void>;

type ProductFormDialogProps = {
    categories: { id: string; name: string }[];
    products: ProductOption[];
    ingredients: ProductRecipeIngredientOption[];
    action: ProductFormAction;
} & (
    | { mode: "create"; eventId: string; product?: never }
    | { mode: "edit"; eventId?: string; product: ProductFormProduct }
);

interface ProductFormState {
    availableDays: DayCode[];
    kind: ProductKind;
    availableOnlyInMenus: boolean;
    splitKitchenPrintPerUnit: boolean;
    salesChannels: SalesChannel[];
    menuComponents: MenuComponentState[];
    menuChoiceGroups: MenuChoiceGroupState[];
    recipeItems: ProductRecipeItemState[];
}

function getInitialState(product?: ProductFormProduct): ProductFormState {
    return {
        availableDays: normalizeAvailableDays(product?.availableDays || []),
        kind: product?.kind || "STANDARD",
        availableOnlyInMenus: Boolean(product?.availableOnlyInMenus),
        splitKitchenPrintPerUnit: Boolean(product?.splitKitchenPrintPerUnit),
        salesChannels: Array.isArray(product?.salesChannels) && product.salesChannels.length > 0
            ? product.salesChannels
            : ["POS", "MENU"],
        menuComponents: Array.isArray(product?.menuComponents) ? product.menuComponents : [],
        menuChoiceGroups: Array.isArray(product?.menuChoiceGroups) ? product.menuChoiceGroups : [],
        recipeItems: Array.isArray(product?.recipeItems) ? product.recipeItems : []
    };
}

function SubmitButton({ label }: { label: string }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : label}
        </Button>
    );
}

function buildGroupId() {
    return `group-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function ProductFormDialog(props: ProductFormDialogProps) {
    const { mode, eventId, categories, products, ingredients, action } = props;
    const product = mode === "edit" ? props.product : undefined;
    const isEdit = mode === "edit";
    const formKey = isEdit ? JSON.stringify(product) : "create";
    const initialState = getInitialState(product);
    const [open, setOpen] = useState(false);
    const [availableDays, setAvailableDays] = useState<DayCode[]>(initialState.availableDays);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [kind, setKind] = useState<ProductKind>(initialState.kind);
    const [availableOnlyInMenus, setAvailableOnlyInMenus] = useState(initialState.availableOnlyInMenus);
    const [salesChannels, setSalesChannels] = useState<SalesChannel[]>(initialState.salesChannels);
    const [splitKitchenPrintPerUnit, setSplitKitchenPrintPerUnit] = useState(initialState.splitKitchenPrintPerUnit);
    const [menuComponents, setMenuComponents] = useState<MenuComponentState[]>(initialState.menuComponents);
    const [menuChoiceGroups, setMenuChoiceGroups] = useState<MenuChoiceGroupState[]>(initialState.menuChoiceGroups);
    const [recipeItems, setRecipeItems] = useState<ProductRecipeItemState[]>(initialState.recipeItems);

    async function handleSubmit(formData: FormData) {
        setSubmitError(null);
        try {
            const result = await action(formData);
            if (result && typeof result === "object" && "error" in result && result.error) {
                setSubmitError(result.error);
                return;
            }
            setOpen(false);
            if (!isEdit) {
                resetState();
            }
        } catch (error) {
            console.error(
                isEdit ? "Errore durante l'aggiornamento prodotto" : "Errore durante il salvataggio prodotto",
                error
            );
            setSubmitError(isEdit
                ? "Aggiornamento non riuscito. Verifica connessione e riprova."
                : "Salvataggio non riuscito. Verifica connessione e riprova."
            );
        }
    }

    function resetState() {
        const nextState = getInitialState(product);
        setAvailableDays(nextState.availableDays);
        setSubmitError(null);
        setKind(nextState.kind);
        setAvailableOnlyInMenus(nextState.availableOnlyInMenus);
        setSalesChannels(nextState.salesChannels);
        setSplitKitchenPrintPerUnit(nextState.splitKitchenPrintPerUnit);
        setMenuComponents(nextState.menuComponents);
        setMenuChoiceGroups(nextState.menuChoiceGroups);
        setRecipeItems(nextState.recipeItems);
    }

    const toggleDay = (day: DayCode) => {
        setAvailableDays((prev) => {
            const next = prev.includes(day)
                ? prev.filter((entry) => entry !== day)
                : [...prev, day];
            return normalizeAvailableDays(next);
        });
    };

    const toggleSalesChannel = (channel: SalesChannel) => {
        setSalesChannels((prev) => {
            if (prev.includes(channel)) {
                const next = prev.filter((entry) => entry !== channel);
                return next.length > 0 ? next : prev;
            }
            return [...prev, channel];
        });
    };

    const menuEligibleProducts = products.filter((entry) => (
        entry.kind !== "FIXED_MENU" && (!product || entry.id !== product.id)
    ));
    const serializedMenuComponents = JSON.stringify(
        menuComponents
            .filter((entry) => entry.productId)
            .map((entry) => ({
                productId: entry.productId,
                quantity: Math.max(1, Math.floor(entry.quantity || 1))
            }))
    );
    const serializedMenuChoiceGroups = JSON.stringify(
        menuChoiceGroups
            .map((group) => ({
                id: group.id,
                name: group.name.trim(),
                minSelections: Math.max(0, Math.floor(group.minSelections || 0)),
                maxSelections: Math.max(1, Math.floor(group.maxSelections || 1)),
                options: group.options
                    .filter((option) => option.productId)
                    .map((option) => ({
                        productId: option.productId,
                        quantity: Math.max(1, Math.floor(option.quantity || 1))
                    }))
            }))
            .filter((group) => group.name && group.options.length > 0)
    );
    const serializedRecipeItems = JSON.stringify(
        recipeItems
            .filter((entry) => entry.ingredientId)
            .map((entry) => ({
                ingredientId: entry.ingredientId,
                quantity: Math.max(1, Math.floor(entry.quantity || 1))
            }))
    );

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if ((isEdit && nextOpen) || (!isEdit && !nextOpen)) {
                    resetState();
                }
            }}
        >
            <DialogTrigger asChild>
                {isEdit ? (
                    <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Modifica">
                        <Pencil className="h-4 w-4" />
                    </Button>
                ) : (
                    <Button size="sm" id="new-product-btn">+ Nuovo Prodotto</Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <form key={formKey} action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{isEdit ? "Modifica Prodotto" : "Aggiungi Prodotto"}</DialogTitle>
                        <DialogDescription>
                            {isEdit
                                ? "Aggiorna i campi del prodotto selezionato."
                                : "Compila i campi per creare un nuovo prodotto nel catalogo."
                            }
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        {product ? <input type="hidden" name="id" value={product.id} /> : null}
                        {isEdit ? (
                            eventId ? <input type="hidden" name="eventId" value={eventId} /> : null
                        ) : (
                            <input type="hidden" name="eventId" value={eventId} />
                        )}
                        <input type="hidden" name="availableDays" value={serializeAvailableDays(availableDays)} />
                        <input type="hidden" name="kind" value={kind} />
                        <input type="hidden" name="menuComponentsJson" value={serializedMenuComponents} />
                        <input type="hidden" name="menuChoiceGroupsJson" value={serializedMenuChoiceGroups} />
                        <input type="hidden" name="recipeItemsJson" value={serializedRecipeItems} />
                        <div className="grid gap-2">
                            <Label htmlFor={isEdit ? "product-kind-edit" : "product-kind"}>Tipo prodotto</Label>
                            <select
                                id={isEdit ? "product-kind-edit" : "product-kind"}
                                value={kind}
                                onChange={(event) => {
                                    const nextKind = event.target.value === "FIXED_MENU" ? "FIXED_MENU" : "STANDARD";
                                    setKind(nextKind);
                                    if (nextKind === "FIXED_MENU") {
                                        setAvailableOnlyInMenus(false);
                                        setSplitKitchenPrintPerUnit(false);
                                        setRecipeItems([]);
                                    }
                                }}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                            >
                                <option value="STANDARD">Prodotto standard</option>
                                <option value="FIXED_MENU">Menu a prezzo fisso</option>
                            </select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={isEdit ? "productCategory" : "categoryId"}>Categoria</Label>
                            <select
                                id={isEdit ? "productCategory" : undefined}
                                name="categoryId"
                                defaultValue={product?.categoryId}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                                required
                            >
                                {categories.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={isEdit ? "prod-edit-name" : "prod-name"}>Nome</Label>
                            <Input
                                id={isEdit ? "prod-edit-name" : "prod-name"}
                                name="name"
                                defaultValue={product?.name}
                                placeholder={isEdit ? undefined : "Pasta, Birra..."}
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={isEdit ? "prod-edit-short-name" : "prod-short-name"}>Etichetta breve POS/Scontrino (opzionale)</Label>
                            <Input
                                id={isEdit ? "prod-edit-short-name" : "prod-short-name"}
                                name="shortName"
                                maxLength={MAX_PRODUCT_SHORT_NAME_LENGTH}
                                defaultValue={isEdit ? product?.shortName || "" : undefined}
                                placeholder="Es: BIRRA BIONDA"
                            />
                            <p className="text-xs text-muted-foreground">
                                Usato in POS e stampe. Massimo {MAX_PRODUCT_SHORT_NAME_LENGTH} caratteri.
                            </p>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={isEdit ? "prod-edit-description" : "prod-description"}>Descrizione Menu (opzionale)</Label>
                            <Textarea
                                id={isEdit ? "prod-edit-description" : "prod-description"}
                                name="description"
                                rows={3}
                                defaultValue={isEdit ? product?.description || "" : undefined}
                                placeholder="Descrizione breve visibile nel menu pubblico..."
                                className="min-h-[84px] bg-background"
                            />
                        </div>
                        <div className="grid gap-3 rounded-lg border p-3">
                            <Label className="text-sm font-bold">Canali di vendita</Label>
                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center gap-2 text-sm font-medium">
                                    <input
                                        type="checkbox"
                                        name="salesChannels"
                                        value="POS"
                                        checked={salesChannels.includes("POS")}
                                        onChange={() => toggleSalesChannel("POS")}
                                    />
                                    Visibile nel POS
                                </label>
                                <label className="flex items-center gap-2 text-sm font-medium">
                                    <input
                                        type="checkbox"
                                        name="salesChannels"
                                        value="MENU"
                                        checked={salesChannels.includes("MENU")}
                                        onChange={() => toggleSalesChannel("MENU")}
                                    />
                                    Visibile nell&apos;app utente
                                </label>
                            </div>
                        </div>
                        {kind === "STANDARD" ? (
                            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm font-medium">
                                <input
                                    type="checkbox"
                                    name="availableOnlyInMenus"
                                    checked={availableOnlyInMenus}
                                    onChange={(event) => setAvailableOnlyInMenus(event.target.checked)}
                                />
                                Vendibile solo nei menu
                            </label>
                        ) : null}
                        {kind === "STANDARD" ? (
                            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm font-medium">
                                <input
                                    type="checkbox"
                                    name="splitKitchenPrintPerUnit"
                                    checked={splitKitchenPrintPerUnit}
                                    onChange={(event) => setSplitKitchenPrintPerUnit(event.target.checked)}
                                />
                                Stampa comanda separata per unità
                            </label>
                        ) : null}
                        <div className="grid gap-2">
                            <Label htmlFor="basePrice">{kind === "FIXED_MENU" ? "Prezzo Fisso (€)" : "Prezzo Base (€)"}</Label>
                            <Input
                                id="basePrice"
                                name="basePrice"
                                type="number"
                                step="0.01"
                                defaultValue={product?.basePrice}
                                placeholder={isEdit ? undefined : "5.00"}
                                required={kind === "FIXED_MENU" || !availableOnlyInMenus}
                            />
                            {!isEdit && kind === "STANDARD" && availableOnlyInMenus ? (
                                <p className="text-xs text-muted-foreground">
                                    Per i prodotti solo menu il prezzo unitario non viene mostrato né usato per la vendita diretta.
                                </p>
                            ) : null}
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="volunteerPrice">Prezzo volontari (€)</Label>
                            <Input
                                id="volunteerPrice"
                                name="volunteerPrice"
                                type="number"
                                min="0"
                                step="0.01"
                                defaultValue={isEdit ? product?.volunteerPrice ?? "" : undefined}
                                placeholder="Lascia vuoto"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={isEdit ? "prod-edit-stock-quantity" : "prod-stock-quantity"}>Scorte</Label>
                            <Input
                                id={isEdit ? "prod-edit-stock-quantity" : "prod-stock-quantity"}
                                name="stockQuantity"
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                defaultValue={isEdit ? product?.stockQuantity ?? "" : undefined}
                                placeholder="Illimitato"
                            />
                            <p className="text-xs text-muted-foreground">
                                Lascia vuoto per prodotto sempre disponibile.
                            </p>
                        </div>
                        <div className="grid gap-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm">Disponibilità Giorni</Label>
                                <span className="text-xs text-muted-foreground">
                                    {availableDays.length === 0 ? "Sempre" : `${availableDays.length}/7`}
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {DAY_CODES.map((day) => {
                                    const active = availableDays.includes(day);
                                    return (
                                        <Button
                                            key={day}
                                            type="button"
                                            variant={active ? "default" : "outline"}
                                            className="h-8 px-3 text-xs font-bold"
                                            onClick={() => toggleDay(day)}
                                        >
                                            {DAY_LABELS_IT[day]}
                                        </Button>
                                    );
                                })}
                            </div>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => setAvailableDays([...DAY_CODES])}>
                                    Tutti i giorni
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => setAvailableDays([])}>
                                    Nessun filtro
                                </Button>
                            </div>
                        </div>
                        {kind === "STANDARD" ? (
                            <ProductRecipeEditor
                                ingredients={ingredients}
                                recipeItems={recipeItems}
                                onChange={setRecipeItems}
                            />
                        ) : null}
                        {kind === "FIXED_MENU" ? (
                            <div className="grid gap-4 rounded-lg border p-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-sm font-bold">Componenti fissi</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setMenuComponents((prev) => [...prev, { productId: "", quantity: 1 }])}
                                        >
                                            Aggiungi componente
                                        </Button>
                                    </div>
                                    {menuComponents.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">Nessun componente fisso configurato.</p>
                                    ) : null}
                                    {menuComponents.map((component, index) => (
                                        <div key={`fixed-${index}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_110px_auto]">
                                            <select
                                                value={component.productId}
                                                onChange={(event) => {
                                                    const nextValue = event.target.value;
                                                    setMenuComponents((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, productId: nextValue } : entry));
                                                }}
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                            >
                                                <option value="">Seleziona prodotto</option>
                                                {menuEligibleProducts.map((product) => (
                                                    <option key={product.id} value={product.id}>{product.name}</option>
                                                ))}
                                            </select>
                                            <Input
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={component.quantity}
                                                onChange={(event) => {
                                                    const nextQuantity = Number(event.target.value || 1);
                                                    setMenuComponents((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: Math.max(1, Math.floor(nextQuantity || 1)) } : entry));
                                                }}
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setMenuComponents((prev) => prev.filter((_, entryIndex) => entryIndex !== index))}
                                            >
                                                Rimuovi
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-sm font-bold">Gruppi di scelta</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setMenuChoiceGroups((prev) => [...prev, {
                                                id: buildGroupId(),
                                                name: "",
                                                minSelections: 1,
                                                maxSelections: 1,
                                                options: [{ productId: "", quantity: 1 }]
                                            }])}
                                        >
                                            Aggiungi gruppo
                                        </Button>
                                    </div>
                                    {menuChoiceGroups.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">Nessun gruppo di scelta configurato.</p>
                                    ) : null}
                                    {menuChoiceGroups.map((group, groupIndex) => (
                                        <div key={group.id} className="space-y-3 rounded-md border p-3">
                                            <div className="space-y-2">
                                                <Label
                                                    htmlFor={`menu-choice-group-name${isEdit ? "-edit" : ""}-${group.id}`}
                                                    className="text-xs font-medium text-muted-foreground"
                                                >
                                                    Nome gruppo
                                                </Label>
                                                <Input
                                                    id={`menu-choice-group-name${isEdit ? "-edit" : ""}-${group.id}`}
                                                    value={group.name}
                                                    onChange={(event) => {
                                                        const nextValue = event.target.value;
                                                        setMenuChoiceGroups((prev) => prev.map((entry, entryIndex) => entryIndex === groupIndex ? { ...entry, name: nextValue } : entry));
                                                    }}
                                                    placeholder="Es: Bibita"
                                                />
                                            </div>
                                            <div className="grid gap-2 md:grid-cols-[110px_110px_auto]">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    value={group.minSelections}
                                                    onChange={(event) => {
                                                        const nextValue = Number(event.target.value || 0);
                                                        setMenuChoiceGroups((prev) => prev.map((entry, entryIndex) => entryIndex === groupIndex ? { ...entry, minSelections: Math.max(0, Math.floor(nextValue || 0)) } : entry));
                                                    }}
                                                />
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={group.maxSelections}
                                                    onChange={(event) => {
                                                        const nextValue = Number(event.target.value || 1);
                                                        setMenuChoiceGroups((prev) => prev.map((entry, entryIndex) => entryIndex === groupIndex ? { ...entry, maxSelections: Math.max(1, Math.floor(nextValue || 1)) } : entry));
                                                    }}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => setMenuChoiceGroups((prev) => prev.filter((_, entryIndex) => entryIndex !== groupIndex))}
                                                >
                                                    Rimuovi gruppo
                                                </Button>
                                            </div>
                                            {!isEdit ? (
                                                <p className="text-xs text-muted-foreground">
                                                    Nome gruppo, numero minimo e massimo di scelte richieste.
                                                </p>
                                            ) : null}
                                            <div className="space-y-2">
                                                {group.options.map((option, optionIndex) => (
                                                    <div key={`${group.id}-option-${optionIndex}`} className="grid gap-2 md:grid-cols-[1fr_110px_auto]">
                                                        <select
                                                            value={option.productId}
                                                            onChange={(event) => {
                                                                const nextValue = event.target.value;
                                                                setMenuChoiceGroups((prev) => prev.map((entry, entryIndex) => {
                                                                    if (entryIndex !== groupIndex) return entry;
                                                                    return {
                                                                        ...entry,
                                                                        options: entry.options.map((entryOption, entryOptionIndex) => entryOptionIndex === optionIndex ? { ...entryOption, productId: nextValue } : entryOption)
                                                                    };
                                                                }));
                                                            }}
                                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                        >
                                                            <option value="">Seleziona opzione</option>
                                                            {menuEligibleProducts.map((product) => (
                                                                <option key={product.id} value={product.id}>{product.name}</option>
                                                            ))}
                                                        </select>
                                                        <Input
                                                            type="number"
                                                            min="1"
                                                            step="1"
                                                            value={option.quantity}
                                                            onChange={(event) => {
                                                                const nextValue = Number(event.target.value || 1);
                                                                setMenuChoiceGroups((prev) => prev.map((entry, entryIndex) => {
                                                                    if (entryIndex !== groupIndex) return entry;
                                                                    return {
                                                                        ...entry,
                                                                        options: entry.options.map((entryOption, entryOptionIndex) => entryOptionIndex === optionIndex ? { ...entryOption, quantity: Math.max(1, Math.floor(nextValue || 1)) } : entryOption)
                                                                    };
                                                                }));
                                                            }}
                                                        />
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            onClick={() => setMenuChoiceGroups((prev) => prev.map((entry, entryIndex) => {
                                                                if (entryIndex !== groupIndex) return entry;
                                                                return {
                                                                    ...entry,
                                                                    options: entry.options.filter((_, entryOptionIndex) => entryOptionIndex !== optionIndex)
                                                                };
                                                            }))}
                                                        >
                                                            Rimuovi
                                                        </Button>
                                                    </div>
                                                ))}
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setMenuChoiceGroups((prev) => prev.map((entry, entryIndex) => entryIndex === groupIndex ? { ...entry, options: [...entry.options, { productId: "", quantity: 1 }] } : entry))}
                                                >
                                                    Aggiungi opzione
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                    {submitError ? (
                        <p className="text-sm font-medium text-red-600" role="alert">
                            {submitError}
                        </p>
                    ) : null}
                    <DialogFooter>
                        <SubmitButton label={isEdit ? "Salva Modifiche" : "Salva Prodotto"} />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
