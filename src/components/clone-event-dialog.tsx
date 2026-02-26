"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloneEventAction } from "@/app/admin/settings/actions";
import { Loader2 } from "lucide-react";

interface CloneEventDialogProps {
    sourceEventId: string;
    sourceEventName: string;
}

export function CloneEventDialog({ sourceEventId, sourceEventName }: CloneEventDialogProps) {
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();

    async function handleSubmit(formData: FormData) {
        startTransition(async () => {
            const result = await cloneEventAction(formData);
            if ("success" in result && result.success) {
                setOpen(false);
            }
        });
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">Clona</Button>
            </DialogTrigger>
            <DialogContent>
                <form action={handleSubmit}>
                    <input type="hidden" name="sourceEventId" value={sourceEventId} />
                    <DialogHeader>
                        <DialogTitle>Clona {sourceEventName}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor={`newName-${sourceEventId}`}>Nome Nuova Festa</Label>
                            <Input id={`newName-${sourceEventId}`} name="newName" placeholder="Es. Sagra 2025" required />
                        </div>
                        <p className="text-sm text-muted-foreground">Verranno copiati tutti i prodotti, le categorie e le impostazioni della festa. Lo storico ordini partirà da zero.</p>
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={isPending}>
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Clona Festa
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
