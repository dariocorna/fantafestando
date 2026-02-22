"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormStatus } from "react-dom";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : "Salva Categoria"}
        </Button>
    );
}

export function CreateCategoryDialog({
    eventId,
    printers,
    createAction
}: {
    eventId: string,
    printers: { id: string, name: string, ip: string }[],
    createAction: (formData: FormData) => Promise<void>
}) {
    const [open, setOpen] = useState(false);

    async function handleSubmit(formData: FormData) {
        await createAction(formData);
        setOpen(false);
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" id="new-category-btn">+ Nuova Categoria</Button>
            </DialogTrigger>
            <DialogContent>
                <form action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Aggiungi Categoria</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="eventId" value={eventId} />
                        <div className="grid gap-2">
                            <Label htmlFor="cat-name">Nome</Label>
                            <Input id="cat-name" name="name" placeholder="Primi, Bar..." required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="uiColor">Classe Colore (Tailwind)</Label>
                            <Input id="uiColor" name="uiColor" placeholder="bg-red-500" defaultValue="bg-blue-500" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="printerId">Stampante Reparto (Opzionale)</Label>
                            <select id="printerId" name="printerId" aria-label="Stampante Reparto" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                                <option value="">Nessuna (Copia singola in cassa)</option>
                                {printers.map((p) => (
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
