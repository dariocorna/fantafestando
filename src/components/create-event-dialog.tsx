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
import { createEventAction } from "@/app/admin/settings/actions";
import { Loader2 } from "lucide-react";

export function CreateEventDialog() {
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [submitError, setSubmitError] = useState<string | null>(null);

    async function handleSubmit(formData: FormData) {
        setSubmitError(null);
        startTransition(async () => {
            const result = await createEventAction(formData);
            if ("error" in result && result.error) {
                setSubmitError(result.error);
                return;
            }
            if ("success" in result && result.success) {
                setOpen(false);
            }
        });
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
                <Button id="new-event-btn">+ Nuova Festa</Button>
            </DialogTrigger>
            <DialogContent>
                <form action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Crea Nuova Festa</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">Nome</Label>
                            <Input id="name" name="name" placeholder="Es. Sagra 2025" className="col-span-3" required />
                        </div>
                    </div>
                    {submitError ? (
                        <p className="text-sm font-medium text-red-600" role="alert">
                            {submitError}
                        </p>
                    ) : null}
                    <DialogFooter>
                        <Button type="submit" disabled={isPending}>
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Salva
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
