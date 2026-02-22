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

export function EditPosDeviceDialog({
    posDevice,
    eventId,
    printers,
    peripherals,
    updateAction
}: {
    posDevice: { id: string, name: string, printerId: string, paymentTerminalId?: string, cashBoxId?: string },
    eventId?: string,
    printers: { id: string, name: string }[],
    peripherals: { id: string, name: string, type: string }[],
    updateAction: (formData: FormData) => Promise<{ success?: boolean; error?: string } | undefined>
}) {
    const [open, setOpen] = useState(false);
    const router = useRouter();

    async function handleSubmit(formData: FormData) {
        // Normalize "none" selections
        if (formData.get("paymentTerminalId") === "none") formData.set("paymentTerminalId", "");
        if (formData.get("cashBoxId") === "none") formData.set("cashBoxId", "");

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
                        <DialogTitle>Modifica Punto Cassa</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="id" value={posDevice.id} />
                        {eventId && <input type="hidden" name="eventId" value={eventId} />}
                        <div className="space-y-2">
                            <Label htmlFor="pos-edit-name">Nome Postazione</Label>
                            <Input id="pos-edit-name" name="name" defaultValue={posDevice.name} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="pos-edit-printerId">Stampante Associata</Label>
                            <Select name="printerId" defaultValue={posDevice.printerId}>
                                <SelectTrigger id="pos-edit-printerId" aria-label="Stampante Associata">
                                    <SelectValue placeholder="Seleziona la stampante" />
                                </SelectTrigger>
                                <SelectContent>
                                    {printers.map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="pos-edit-paymentTerminalId">Terminale Pagamento (Elettronico)</Label>
                            <Select name="paymentTerminalId" defaultValue={posDevice.paymentTerminalId || "none"}>
                                <SelectTrigger id="pos-edit-paymentTerminalId">
                                    <SelectValue placeholder="Nessuno" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Nessuno</SelectItem>
                                    {peripherals.filter(p => p.type === "SUMUP").map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="pos-edit-cashBoxId">Cassetta Contanti (Manuale)</Label>
                            <Select name="cashBoxId" defaultValue={posDevice.cashBoxId || "none"}>
                                <SelectTrigger id="pos-edit-cashBoxId">
                                    <SelectValue placeholder="Nessuna" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Nessuna</SelectItem>
                                    {peripherals.filter(p => p.type === "CASH_BOX").map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
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
