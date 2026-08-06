"use client";

import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
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
    category: { id: string, name: string, uiColor: string, printerId?: string, skipKitchenPrint?: boolean, printKitchenCopyAtCashier?: boolean, pizzaFlowEnabled?: boolean, pizzaBarcodeEnabled?: boolean },
    eventId?: string,
    printers: { id: string, name: string, ip: string, port?: number }[],
    updateAction: (formData: FormData) => Promise<{ success?: boolean; error?: string } | void>
}) {
    const [open, setOpen] = useState(false);
    const [formInstanceKey, setFormInstanceKey] = useState(0);
    const [selectedColor, setSelectedColor] = useState(() => normalizeCategoryColor(category.uiColor));
    const [pizzaFlowEnabled, setPizzaFlowEnabled] = useState(Boolean(category.pizzaFlowEnabled));
    const [pizzaBarcodeEnabled, setPizzaBarcodeEnabled] = useState(Boolean(category.pizzaBarcodeEnabled));
    const [submitError, setSubmitError] = useState<string | null>(null);
    const skipKitchenPrintRef = useRef<HTMLInputElement>(null);

    async function handleSubmit(formData: FormData) {
        setSubmitError(null);
        try {
            const result = await updateAction(formData);
            if (result && typeof result === "object" && "error" in result && result.error) {
                setSubmitError(result.error);
                return;
            }
            setOpen(false);
        } catch (error) {
            console.error("Errore durante l'aggiornamento categoria", error);
            setSubmitError("Aggiornamento non riuscito. Verifica connessione e riprova.");
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (nextOpen) {
                    setSubmitError(null);
                    setSelectedColor(normalizeCategoryColor(category.uiColor));
                    setPizzaFlowEnabled(Boolean(category.pizzaFlowEnabled));
                    setPizzaBarcodeEnabled(Boolean(category.pizzaBarcodeEnabled));
                    setFormInstanceKey((current) => current + 1);
                }
            }}
        >
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Modifica">
                    <Pencil className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form key={formInstanceKey} action={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Modifica Categoria</DialogTitle>
                        <DialogDescription>
                            Aggiorna nome, colore, stampante reparto e regole di stampa della categoria.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <input type="hidden" name="id" value={category.id} />
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
                                            aria-pressed={isSelected}
                                            onClick={() => setSelectedColor(option.value)}
                                            className={`h-9 rounded-md border-2 transition ${isSelected
                                                ? "border-slate-900 dark:border-slate-100 scale-105"
                                                : "border-slate-200 hover:border-slate-400"
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
                            <div className="flex items-center gap-3">
                                <input
                                    id={`cat-edit-color-picker-${category.id}`}
                                    name="uiColor"
                                    type="color"
                                    value={selectedColor}
                                    onChange={(event) => setSelectedColor(event.target.value)}
                                    className="h-10 w-14 cursor-pointer rounded-md border bg-white p-1"
                                />
                                <Label htmlFor={`cat-edit-color-picker-${category.id}`} className="font-normal text-slate-600">
                                    Colore personalizzato
                                </Label>
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
                                    <option key={p.id} value={p.id}>
                                        {p.name} ({p.port && p.port !== 9100 ? `${p.ip}:${p.port}` : p.ip})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input
                                id="pizzaFlowEnabled"
                                name="pizzaFlowEnabled"
                                type="checkbox"
                                checked={pizzaFlowEnabled}
                                onChange={(event) => {
                                    const nextValue = event.target.checked;
                                    setPizzaFlowEnabled(nextValue);
                                    if (!nextValue) setPizzaBarcodeEnabled(false);
                                    if (nextValue && skipKitchenPrintRef.current) {
                                        skipKitchenPrintRef.current.checked = false;
                                    }
                                }}
                            />
                            Preparazione numerata
                        </label>
                        {pizzaFlowEnabled ? (
                            <label className="ml-6 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                                <input
                                    id="pizzaBarcodeEnabled"
                                    name="pizzaBarcodeEnabled"
                                    type="checkbox"
                                    checked={pizzaBarcodeEnabled}
                                    onChange={(event) => setPizzaBarcodeEnabled(event.target.checked)}
                                />
                                Stampa barcode piatto
                            </label>
                        ) : null}
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input
                                ref={skipKitchenPrintRef}
                                id="skipKitchenPrint"
                                name="skipKitchenPrint"
                                type="checkbox"
                                defaultChecked={Boolean(category.skipKitchenPrint)}
                                disabled={pizzaFlowEnabled}
                            />
                            Non stampare comanda
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input
                                id="printKitchenCopyAtCashier"
                                name="printKitchenCopyAtCashier"
                                type="checkbox"
                                defaultChecked={Boolean(category.printKitchenCopyAtCashier)}
                            />
                            Stampa anche copia reparto in cassa
                        </label>
                        {pizzaFlowEnabled ? (
                            <p className="text-xs font-semibold text-amber-700">
                                La stampante reparto e` opzionale: senza stampante dedicata la comanda esce solo in cassa sulla copia cliente.
                            </p>
                        ) : null}
                    </div>
                    {submitError ? (
                        <p className="text-sm font-medium text-red-600" role="alert">
                            {submitError}
                        </p>
                    ) : null}
                    <DialogFooter>
                        <SubmitButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
