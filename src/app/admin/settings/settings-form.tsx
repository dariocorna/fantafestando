"use client";

import { useTransition } from "react";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, Plus, X, Upload, Trash2 } from "lucide-react";
import { updateEventSettingsAction } from "./actions";
import { useState } from "react";
import { MAX_PREDEFINED_TABLES, normalizeTableValue, parsePredefinedTablesInput } from "@/lib/table-presets";

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
    const [tablesError, setTablesError] = useState<string | null>(null);
    const [newTableValue, setNewTableValue] = useState("");
    const [bulkImportValue, setBulkImportValue] = useState("");
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
    const [predefinedTables, setPredefinedTables] = useState<string[]>(() =>
        parsePredefinedTablesInput(
            Array.isArray(event.predefinedTables) ? event.predefinedTables.join("\n") : "",
            Number.MAX_SAFE_INTEGER
        )
    );

    const predefinedTablesCount = predefinedTables.length;
    const predefinedTablesOverLimit = predefinedTablesCount > MAX_PREDEFINED_TABLES;

    const addSingleTable = () => {
        const normalized = normalizeTableValue(newTableValue);
        if (!normalized) {
            setTablesError("Inserisci un tavolo valido prima di aggiungere");
            return;
        }

        const merged = parsePredefinedTablesInput(
            [...predefinedTables, normalized].join("\n"),
            Number.MAX_SAFE_INTEGER
        );

        if (merged.length === predefinedTables.length) {
            setTablesError("Tavolo già presente nella lista");
            return;
        }

        if (merged.length > MAX_PREDEFINED_TABLES) {
            setTablesError(`Puoi inserire al massimo ${MAX_PREDEFINED_TABLES} tavoli unici`);
            return;
        }

        setPredefinedTables(merged);
        setNewTableValue("");
        setTablesError(null);
    };

    const importBulkTables = () => {
        const parsedIncoming = parsePredefinedTablesInput(bulkImportValue, Number.MAX_SAFE_INTEGER);
        if (parsedIncoming.length === 0) {
            setTablesError("Nessun tavolo valido trovato nell'elenco importato");
            return;
        }

        const merged = parsePredefinedTablesInput(
            [...predefinedTables, ...parsedIncoming].join("\n"),
            Number.MAX_SAFE_INTEGER
        );

        if (merged.length > MAX_PREDEFINED_TABLES && merged.length > predefinedTables.length) {
            setTablesError(`Import troppo grande: massimo ${MAX_PREDEFINED_TABLES} tavoli unici`);
            return;
        }

        setPredefinedTables(merged);
        setBulkImportValue("");
        setIsBulkImportOpen(false);
        setTablesError(null);
    };

    const removeTableAtIndex = (index: number) => {
        setPredefinedTables((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
        setTablesError(null);
    };

    const clearAllTables = () => {
        setPredefinedTables([]);
        setTablesError(null);
    };

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
            <input type="hidden" name="predefinedTables" value={predefinedTables.join("\n")} />
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

                <div className="space-y-4 rounded-md border p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="new-predefined-table" className="text-sm font-medium">
                                Tavoli Predefiniti
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Selezione rapida per POS/WebApp, con inserimento custom sempre disponibile.
                            </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${predefinedTablesOverLimit ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                            {predefinedTablesCount}/{MAX_PREDEFINED_TABLES}
                        </span>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                            id="new-predefined-table"
                            value={newTableValue}
                            onChange={(e) => {
                                setNewTableValue(e.target.value);
                                if (tablesError) setTablesError(null);
                            }}
                            placeholder="Es: A01 oppure VIP TERRAZZA"
                            className="sm:flex-1"
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === ",") {
                                    e.preventDefault();
                                    addSingleTable();
                                }
                            }}
                        />
                        <Button type="button" variant="outline" className="gap-2 font-bold" onClick={addSingleTable}>
                            <Plus className="h-4 w-4" />
                            Aggiungi
                        </Button>
                    </div>

                    <div className="min-h-[76px] rounded-md border bg-slate-50 p-3">
                        {predefinedTablesCount === 0 ? (
                            <p className="text-xs italic text-muted-foreground">
                                Nessun tavolo configurato. Puoi aggiungerli uno alla volta o importare un elenco.
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {predefinedTables.map((table, index) => (
                                    <span
                                        key={`${table}-${index}`}
                                        className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm"
                                    >
                                        {table}
                                        <button
                                            type="button"
                                            className="rounded-full p-0.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                            onClick={() => removeTableAtIndex(index)}
                                            aria-label={`Rimuovi tavolo ${table}`}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="gap-2 text-xs font-bold"
                            onClick={() => setIsBulkImportOpen((prev) => !prev)}
                        >
                            <Upload className="h-3.5 w-3.5" />
                            {isBulkImportOpen ? "Chiudi Import" : "Importa Elenco"}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="gap-2 text-xs font-bold text-red-700 hover:text-red-800"
                            onClick={clearAllTables}
                            disabled={predefinedTablesCount === 0}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            Svuota Lista
                        </Button>
                    </div>

                    {isBulkImportOpen && (
                        <div className="space-y-2 rounded-md border bg-white p-3">
                            <Label htmlFor="bulk-predefined-tables" className="text-xs font-medium">
                                Importa multipli (una riga per tavolo oppure separati da virgola)
                            </Label>
                            <textarea
                                id="bulk-predefined-tables"
                                value={bulkImportValue}
                                onChange={(e) => setBulkImportValue(e.target.value)}
                                placeholder={"A01\nB02\nVIP TERRAZZA"}
                                rows={4}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                            <div className="flex justify-end">
                                <Button type="button" className="gap-2 text-sm font-bold" onClick={importBulkTables}>
                                    <Upload className="h-4 w-4" />
                                    Importa in Lista
                                </Button>
                            </div>
                        </div>
                    )}

                    {tablesError && (
                        <p className="text-xs font-semibold text-red-600">{tablesError}</p>
                    )}
                    {predefinedTablesOverLimit && (
                        <p className="text-xs font-semibold text-amber-700">
                            La lista supera il limite massimo. Riduci a {MAX_PREDEFINED_TABLES} tavoli per salvare modifiche su questa sezione.
                        </p>
                    )}
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
