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

export function EditProductDialog({
    product,
    categories,
    updateAction
}: {
    product: { id: string, name: string, categoryId: string, basePrice: number },
    categories: { id: string, name: string }[],
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
                        <DialogTitle>Modifica Prodotto</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="id" value={product.id} />
                        <div className="grid gap-2">
                            <Label htmlFor="productCategory">Categoria</Label>
                            <select
                                id="productCategory"
                                name="categoryId"
                                defaultValue={product.categoryId}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                                required
                            >
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="prod-edit-name">Nome</Label>
                            <Input id="prod-edit-name" name="name" defaultValue={product.name} required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="basePrice">Prezzo Base (€)</Label>
                            <Input id="basePrice" name="basePrice" type="number" step="0.01" defaultValue={product.basePrice} required />
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
