"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : "Salva Ingrediente"}
        </Button>
    );
}

export function CreateIngredientDialog({
    eventId,
    nextSortOrder,
    createAction
}: {
    eventId: string
    nextSortOrder: number
    createAction: (formData: FormData) => Promise<{ success?: boolean; error?: string } | void>
}) {
    const [open, setOpen] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    async function handleSubmit(formData: FormData) {
        setSubmitError(null);
        try {
            const result = await createAction(formData);
            if (result && typeof result === "object" && "error" in result && result.error) {
                setSubmitError(result.error);
                return;
            }
            setOpen(false);
        } catch (error) {
            console.error("Errore durante il salvataggio ingrediente", error);
            setSubmitError("Salvataggio non riuscito. Verifica connessione e riprova.");
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
                <Button size="sm" id="new-ingredient-btn">+ Nuovo Ingrediente</Button>
            </DialogTrigger>
            <DialogContent>
                <form action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Aggiungi Ingrediente</DialogTitle>
                        <DialogDescription>
                            Crea un ingrediente riutilizzabile da associare ai prodotti tramite ricetta.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="eventId" value={eventId} />
                        <div className="grid gap-2">
                            <Label htmlFor="ingredient-name">Nome</Label>
                            <Input id="ingredient-name" name="name" placeholder="Patatine, Pane..." required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="ingredient-short-name">Nome breve (opzionale)</Label>
                            <Input id="ingredient-short-name" name="shortName" placeholder="PATATINE" maxLength={24} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="ingredient-sort-order">Ordine</Label>
                            <Input
                                id="ingredient-sort-order"
                                name="sortOrder"
                                type="number"
                                min="0"
                                step="1"
                                defaultValue={nextSortOrder}
                            />
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input
                                id="ingredient-active"
                                name="active"
                                type="checkbox"
                                defaultChecked
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
