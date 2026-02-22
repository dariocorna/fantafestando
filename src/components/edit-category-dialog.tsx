"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil } from "lucide-react";
import { useFormStatus } from "react-dom";

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
                        {eventId && <input type="hidden" name="eventId" value={eventId} />}
                        <div className="grid gap-2">
                            <Label htmlFor="cat-edit-name">Nome</Label>
                            <Input id="cat-edit-name" name="name" defaultValue={category.name} required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="uiColor">Classe Colore (Tailwind)</Label>
                            <Input id="uiColor" name="uiColor" defaultValue={category.uiColor} placeholder="bg-blue-500" required />
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
