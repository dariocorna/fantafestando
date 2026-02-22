"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Pencil } from "lucide-react";
import { useFormStatus } from "react-dom";
import { CATEGORY_COLOR_OPTIONS, getCategoryTextColor, normalizeCategoryColor } from "@/lib/category-colors";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : "Salva Modifiche"}
        </Button>
    );
}

export function EditCategoryDialog({
    category,
    eventId,
    printers,
    updateAction
}: {
    category: { id: string, name: string, uiColor: string, printerId?: string },
    eventId?: string,
    printers: { id: string, name: string, ip: string }[],
    updateAction: (formData: FormData) => Promise<void>
}) {
    const [open, setOpen] = useState(false);
    const [selectedColor, setSelectedColor] = useState(() => normalizeCategoryColor(category.uiColor));

    async function handleSubmit(formData: FormData) {
        await updateAction(formData);
        setOpen(false);
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Modifica">
                    <Pencil className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Modifica Categoria</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="id" value={category.id} />
                        <input type="hidden" name="uiColor" value={selectedColor} />
                        {eventId && <input type="hidden" name="eventId" value={eventId} />}
                        <div className="grid gap-2">
                            <Label htmlFor="cat-edit-name">Nome</Label>
                            <Input id="cat-edit-name" name="name" defaultValue={category.name} required />
                        </div>
                        <div className="grid gap-2">
                            <Label>Colore Categoria</Label>
                            <div className="grid grid-cols-5 gap-2">
                                {CATEGORY_COLOR_OPTIONS.map((option) => {
                                    const isSelected = selectedColor === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            title={option.label}
                                            aria-label={`Colore ${option.label}`}
                                            onClick={() => setSelectedColor(option.value)}
                                            className={`h-9 rounded-md border-2 transition ${isSelected
                                                ? "border-slate-900 dark:border-slate-100 scale-105"
                                                : "border-transparent hover:border-slate-300"
                                                }`}
                                            style={{
                                                backgroundColor: option.value,
                                                color: getCategoryTextColor(option.value)
                                            }}
                                        >
                                            {isSelected ? <Check size={16} className="mx-auto" /> : null}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="printerId">Stampante Reparto</Label>
                            <select
                                id="printerId"
                                name="printerId"
                                aria-label="Stampante Reparto"
                                defaultValue={category.printerId || ""}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                            >
                                <option value="">Nessuna (Copia singola in cassa)</option>
                                {printers.map(p => (
                                    <option key={p.id} value={p.id}>{p.name} ({p.ip})</option>
                                ))}
                            </select>
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
