"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "next/navigation";

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : "Salva Modifiche"}
        </Button>
    );
}

export function EditPrinterDialog({
    printer,
    eventId,
    updateAction
}: {
    printer: { id: string, name: string, ip: string, type: "CASHIER" | "KITCHEN" },
    eventId?: string,
    updateAction: (formData: FormData) => Promise<{ success?: boolean; error?: string } | undefined>
}) {
    const [open, setOpen] = useState(false);
    const router = useRouter();

    async function handleSubmit(formData: FormData) {
        const result = await updateAction(formData);
        if (result?.error) {
            alert(result.error);
        } else {
            setOpen(false);
            router.refresh();
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <Pencil className="h-4 w-4" /> Modifica
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Modifica Stampante</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="id" value={printer.id} />
                        {eventId && <input type="hidden" name="eventId" value={eventId} />}
                        <div className="space-y-2">
                            <Label htmlFor="printer-edit-name">Nome Stampante</Label>
                            <Input id="printer-edit-name" name="name" defaultValue={printer.name} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="printer-edit-ip">Indirizzo IP</Label>
                            <Input id="printer-edit-ip" name="ip" defaultValue={printer.ip} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="printer-edit-type">Tipo Stampante</Label>
                            <Select name="type" defaultValue={printer.type}>
                                <SelectTrigger id="printer-edit-type" aria-label="Tipo Stampante">
                                    <SelectValue placeholder="Seleziona tipo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="CASHIER">Cassa (Scontrino Cliente)</SelectItem>
                                    <SelectItem value="KITCHEN">Reparto (Comanda Piatto)</SelectItem>
                                </SelectContent>
                            </Select>
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
