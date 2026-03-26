"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ProductRecipeItemState {
    ingredientId: string;
    quantity: number;
}

export interface ProductRecipeIngredientOption {
    id: string;
    name: string;
    shortName?: string;
    active?: boolean;
}

export function ProductRecipeEditor({
    ingredients,
    recipeItems,
    onChange,
}: {
    ingredients: ProductRecipeIngredientOption[];
    recipeItems: ProductRecipeItemState[];
    onChange: (items: ProductRecipeItemState[]) => void;
}) {
    return (
        <div className="grid gap-4 rounded-lg border p-4">
            <div className="flex items-center justify-between">
                <div>
                    <Label className="text-sm font-bold">Ricetta ingredienti</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Configura gli ingredienti che compongono il prodotto e la quantità per singola unità venduta.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={ingredients.length === 0}
                    onClick={() => onChange([...recipeItems, { ingredientId: "", quantity: 1 }])}
                >
                    Aggiungi ingrediente
                </Button>
            </div>

            {ingredients.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs font-medium text-muted-foreground">
                    Nessun ingrediente disponibile. Creane almeno uno nella sezione catalogo dedicata.
                </p>
            ) : null}

            {recipeItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    Nessuna ricetta configurata: il prodotto userà il fallback legacy nella coda ingredienti.
                </p>
            ) : null}

            <div className="space-y-2">
                {recipeItems.map((item, index) => (
                    <div key={`recipe-item-${index}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_110px_auto]">
                        <select
                            aria-label={`Ingrediente ricetta ${index + 1}`}
                            value={item.ingredientId}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                onChange(recipeItems.map((entry, entryIndex) => (
                                    entryIndex === index ? { ...entry, ingredientId: nextValue } : entry
                                )));
                            }}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                            <option value="">Seleziona ingrediente</option>
                            {ingredients.map((ingredient) => (
                                <option key={ingredient.id} value={ingredient.id}>
                                    {ingredient.name}
                                    {ingredient.shortName ? ` (${ingredient.shortName})` : ""}
                                    {ingredient.active === false ? " · inattivo" : ""}
                                </option>
                            ))}
                        </select>
                        <Input
                            aria-label={`Quantità ingrediente ricetta ${index + 1}`}
                            type="number"
                            min="1"
                            step="1"
                            value={item.quantity}
                            onChange={(event) => {
                                const nextQuantity = Number(event.target.value || 1);
                                onChange(recipeItems.map((entry, entryIndex) => (
                                    entryIndex === index
                                        ? { ...entry, quantity: Math.max(1, Math.floor(nextQuantity || 1)) }
                                        : entry
                                )));
                            }}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onChange(recipeItems.filter((_, entryIndex) => entryIndex !== index))}
                        >
                            Rimuovi
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}
