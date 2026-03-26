"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : "Salva Modifiche"}
        </Button>
    );
}

export function EditIngredientDialog({
    ingredient,
    eventId,
    updateAction
}: {
    ingredient: {
        id: string
        name: string
        shortName?: string
        stockQuantity?: number | null
        active: boolean
    }
    eventId: string
    updateAction: (formData: FormData) => Promise<{ success?: boolean; error?: string } | void>
}) {
    const [open, setOpen] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    async function handleSubmit(formData: FormData) {
        setSubmitError(null);
        try {
            const result = await updateAction(formData);
            if (result && typeof result === "object" && "error" in result && result.error) {
                setSubmitError(result.error);
                return;
            }
            setOpen(false);
        } catch (error) {
            console.error("Errore durante l'aggiornamento ingrediente", error);
            setSubmitError("Aggiornamento non riuscito. Verifica connessione e riprova.");
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (!nextOpen) {
                    setSubmitError(null);
                }
            }}
        >
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Modifica ingrediente">
                    <Pencil className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Modifica Ingrediente</DialogTitle>
                        <DialogDescription>
                            Aggiorna i dati dell&apos;ingrediente e la sua visibilità nel catalogo ricette.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="id" value={ingredient.id} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <div className="grid gap-2">
                            <Label htmlFor={`ingredient-edit-name-${ingredient.id}`}>Nome</Label>
                            <Input id={`ingredient-edit-name-${ingredient.id}`} name="name" defaultValue={ingredient.name} required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={`ingredient-edit-short-name-${ingredient.id}`}>Nome breve (opzionale)</Label>
                            <Input
                                id={`ingredient-edit-short-name-${ingredient.id}`}
                                name="shortName"
                                defaultValue={ingredient.shortName || ""}
                                placeholder="PATATINE"
                                maxLength={24}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor={`ingredient-edit-stock-quantity-${ingredient.id}`}>Scorte (opzionale)</Label>
                            <Input
                                id={`ingredient-edit-stock-quantity-${ingredient.id}`}
                                name="stockQuantity"
                                type="number"
                                min="0"
                                step="1"
                                defaultValue={ingredient.stockQuantity ?? ""}
                                placeholder="Lascia vuoto per non tracciare"
                            />
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input
                                name="active"
                                type="checkbox"
                                defaultChecked={ingredient.active}
                            />
                            Ingrediente attivo
                        </label>
                    </div>
                    {submitError ? (
                        <p className="text-sm font-medium text-red-600" role="alert">
                            {submitError}
                        </p>
                    ) : null}
                    <DialogFooter>
                        <SubmitButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
