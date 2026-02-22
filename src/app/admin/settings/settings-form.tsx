"use client";

import { useTransition } from "react";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";
import { updateEventSettingsAction } from "./actions";
import { useState } from "react";
import { formatPredefinedTablesForTextarea, MAX_PREDEFINED_TABLES } from "@/lib/table-presets";

interface ActiveEventSettingsFormProps {
    event: {
        _id: string;
        active: boolean;
        settings?: {
            askName?: boolean;
            askTable?: boolean;
        };
        predefinedTables?: string[];
    };
}

export function ActiveEventSettingsForm({ event }: ActiveEventSettingsFormProps) {
    const [isPending, startTransition] = useTransition();
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(formData: FormData) {
        setSaved(false);
        setError(null);
        startTransition(async () => {
            const result = await updateEventSettingsAction(formData);
            if (result?.error) {
                setError(result.error);
                return;
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        });
    }

    return (
        <form action={handleSubmit}>
            <input type="hidden" name="eventId" value={String(event._id)} />
            <CardContent className="grid gap-6 py-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-slate-50 transition-colors">
                        <input
                            type="checkbox"
                            name="active"
                            id="active"
                            defaultChecked={event.active}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <div className="space-y-1 leading-none">
                            <Label htmlFor="active" className="text-sm font-bold text-green-600 cursor-pointer">
                                Festa Attiva (Mostra nel POS e WebApp)
                            </Label>
                            <p className="text-xs text-muted-foreground">Rende questa festa quella predefinita per i clienti.</p>
                        </div>
                    </div>

                    <div className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-slate-50 transition-colors">
                        <input
                            type="checkbox"
                            name="askName"
                            id="askName"
                            defaultChecked={event.settings?.askName}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <div className="space-y-1 leading-none">
                            <Label htmlFor="askName" className="text-sm font-medium cursor-pointer">
                                Chiedi Nome Cliente
                            </Label>
                            <p className="text-xs text-muted-foreground">Abilita il campo nome nel checkout della WebApp.</p>
                        </div>
                    </div>

                    <div className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-slate-50 transition-colors">
                        <input
                            type="checkbox"
                            name="askTable"
                            id="askTable"
                            defaultChecked={event.settings?.askTable}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <div className="space-y-1 leading-none">
                            <Label htmlFor="askTable" className="text-sm font-medium cursor-pointer">
                                Chiedi Numero Tavolo
                            </Label>
                            <p className="text-xs text-muted-foreground">Abilita il campo tavolo per gli ordini al posto.</p>
                        </div>
                    </div>

                </div>

                <div className="space-y-3 rounded-md border p-4 shadow-sm">
                    <Label htmlFor="predefinedTables" className="text-sm font-medium">
                        Tavoli Predefiniti
                    </Label>
                    <p className="text-xs text-muted-foreground">
                        Inserisci un tavolo per riga (oppure separati da virgola). Verranno mostrati come selezione rapida su POS e WebApp, con inserimento custom sempre disponibile. Massimo {MAX_PREDEFINED_TABLES} tavoli unici.
                    </p>
                    <textarea
                        id="predefinedTables"
                        name="predefinedTables"
                        defaultValue={formatPredefinedTablesForTextarea(event.predefinedTables)}
                        placeholder={"A01\nB02\nVIP TERRAZZA"}
                        rows={6}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                </div>
            </CardContent>
            <CardFooter className="bg-slate-50/50 border-t px-6 py-4 flex justify-between items-center">
                <div className="text-sm">
                    {saved && <span className="text-green-600 flex items-center gap-1 font-medium animate-in fade-in slide-in-from-left-2"><CheckCircle2 className="h-4 w-4" /> Modifiche salvate!</span>}
                    {error && <span className="text-red-600 flex items-center gap-1 font-medium">{error}</span>}
                </div>
                <Button type="submit" disabled={isPending} className="px-8 shadow-md">
                    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salva Impostazioni
                </Button>
            </CardFooter>
        </form>
    );
}
