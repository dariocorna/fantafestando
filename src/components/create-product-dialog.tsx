"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormStatus } from "react-dom";
import {
    DAY_CODES,
    DAY_LABELS_IT,
    type DayCode,
    normalizeAvailableDays,
    serializeAvailableDays
} from "@/lib/product-availability";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : "Salva Prodotto"}
        </Button>
    );
}

export function CreateProductDialog({
    eventId,
    categories,
    createAction
}: {
    eventId: string,
    categories: { id: string, name: string }[],
    createAction: (formData: FormData) => Promise<void>
}) {
    const [open, setOpen] = useState(false);
    const [availableDays, setAvailableDays] = useState<DayCode[]>([]);

    async function handleSubmit(formData: FormData) {
        await createAction(formData);
        setOpen(false);
        setAvailableDays([]);
    }

    const toggleDay = (day: DayCode) => {
        setAvailableDays((prev) => {
            const next = prev.includes(day)
                ? prev.filter((entry) => entry !== day)
                : [...prev, day];
            return normalizeAvailableDays(next);
        });
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (!nextOpen) {
                    setAvailableDays([]);
                }
            }}
        >
            <DialogTrigger asChild>
                <Button size="sm" id="new-product-btn">+ Nuovo Prodotto</Button>
            </DialogTrigger>
            <DialogContent>
                <form action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Aggiungi Prodotto</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="availableDays" value={serializeAvailableDays(availableDays)} />
                        <div className="grid gap-2">
                            <Label htmlFor="categoryId">Categoria</Label>
                            <select name="categoryId" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background" required>
                                {categories.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="prod-name">Nome</Label>
                            <Input id="prod-name" name="name" placeholder="Pasta, Birra..." required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="basePrice">Prezzo Base (€)</Label>
                            <Input id="basePrice" name="basePrice" type="number" step="0.01" placeholder="5.00" required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="prod-stock-quantity">Scorte</Label>
                            <Input
                                id="prod-stock-quantity"
                                name="stockQuantity"
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
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
                    </div>
                    <DialogFooter>
                        <SubmitButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
