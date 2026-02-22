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

    async function handleSubmit(formData: FormData) {
        await createAction(formData);
        setOpen(false);
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
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
                    </div>
                    <DialogFooter>
                        <SubmitButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
