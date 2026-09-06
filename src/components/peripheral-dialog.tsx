"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Smartphone } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "next/navigation";

function SubmitButton({ label }: { label: string }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Salvataggio..." : label}
        </Button>
    );
}

export function PeripheralDialog({
    peripheral,
    eventId,
    createAction,
    updateAction
}: {
    peripheral?: {
        id: string;
        name: string;
        type: string;
        config?: {
            merchantCode?: string;
            readerId?: string;
            affiliateAppId?: string;
            [key: string]: unknown;
        };
    },
    eventId?: string,
    createAction?: (formData: FormData) => Promise<{ success?: boolean; error?: string } | undefined>,
    updateAction?: (formData: FormData) => Promise<{ success?: boolean; error?: string } | undefined>
}) {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState(peripheral?.type || "SUMUP");
    const router = useRouter();
    const isEdit = !!peripheral;

    async function handleSubmit(formData: FormData) {
        let result;
        if (isEdit && updateAction) {
            result = await updateAction(formData);
        } else if (createAction) {
            result = await createAction(formData);
        }

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
                {isEdit ? (
                    <Button variant="outline" size="sm" className="gap-2">
                        <Pencil className="h-4 w-4" /> Modifica
                    </Button>
                ) : (
                    <Button size="sm" className="gap-2">
                        <Smartphone className="h-4 w-4" /> Nuova Periferica
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <form action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{isEdit ? "Modifica Periferica" : "Aggiungi Periferica"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        {isEdit ? (
                            <input type="hidden" name="id" value={peripheral.id} />
                        ) : (
                            <input type="hidden" name="eventId" value={eventId} />
                        )}
                        {isEdit && eventId && <input type="hidden" name="eventId" value={eventId} />}

                        <div className="space-y-2">
                            <Label htmlFor="periph-name">Nome Descrittivo</Label>
                            <Input id="periph-name" name="name" defaultValue={peripheral?.name} placeholder="Es: Terminale SumUp #1, Cassetta Bar..." required />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="periph-type">Tipo Periferica</Label>
                            <Select name="type" defaultValue={type} onValueChange={setType}>
                                <SelectTrigger id="periph-type">
                                    <SelectValue placeholder="Seleziona tipo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="SUMUP">Terminale SumUp (Carta / POS)</SelectItem>
                                    <SelectItem value="ELECTRONIC_MANUAL">Pagamento Carta / POS (Manuale)</SelectItem>
                                    <SelectItem value="CASH_BOX">Cassetta Contanti (Manuale)</SelectItem>
                                    <SelectItem value="OTHER">Altro</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {type === "SUMUP" && (
                            <div className="space-y-4 pt-2 border-t mt-2">
                                <p className="text-sm font-medium text-muted-foreground">Configurazione SumUp Cloud API</p>
                                <div className="space-y-2">
                                    <Label htmlFor="merchantCode">Merchant Code</Label>
                                    <Input
                                        id="merchantCode"
                                        name="merchantCode"
                                        defaultValue={peripheral?.config?.merchantCode}
                                        placeholder="Es: MK10CL2A"
                                        required={type === "SUMUP" && !isEdit}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="readerId">Reader ID</Label>
                                    <Input
                                        id="readerId"
                                        name="readerId"
                                        defaultValue={peripheral?.config?.readerId}
                                        placeholder="Es: rdr_..."
                                        required={type === "SUMUP" && !isEdit}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="apiKey">API Key</Label>
                                    <Input
                                        id="apiKey"
                                        name="apiKey"
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder={isEdit ? "Lascia vuoto per mantenere la chiave attuale" : "Chiave API SumUp"}
                                        required={type === "SUMUP" && !isEdit}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="affiliateAppId">Affiliate App ID</Label>
                                    <Input
                                        id="affiliateAppId"
                                        name="affiliateAppId"
                                        defaultValue={peripheral?.config?.affiliateAppId}
                                        placeholder="Es: it.fantafestando.pos"
                                        required={type === "SUMUP" && !isEdit}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="affiliateKey">Affiliate Key</Label>
                                    <Input
                                        id="affiliateKey"
                                        name="affiliateKey"
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder={isEdit ? "Lascia vuoto per mantenere la chiave attuale" : "Affiliate Key SumUp"}
                                        required={type === "SUMUP" && !isEdit}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <SubmitButton label={isEdit ? "Salva Modifiche" : "Aggiungi Periferica"} />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
