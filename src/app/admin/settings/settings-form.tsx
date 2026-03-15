"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, Plus, X, Upload, Trash2 } from "lucide-react";
import { updateEventSettingsAction } from "./actions";
import { MAX_PREDEFINED_TABLES, normalizeTableValue, parsePredefinedTablesInput } from "@/lib/table-presets";
import {
    MAX_QUICK_DISCOUNT_PRESETS,
    resolveQuickDiscountPresetsFromSettings,
    type QuickDiscountType
} from "@/lib/quick-discount-presets";

interface ActiveEventSettingsFormProps {
    event: {
        _id: string;
        active: boolean;
        settings?: {
            askName?: boolean;
            askTable?: boolean;
            portalEasterEggEnabled?: boolean;
            posCatalogLayout?: "COMPACT_COLUMNS" | "MODERN_TABS";
            menuHeaderLogoUrl?: string;
            receiptHeaderLogoUrl?: string;
            quickDiscountPresets?: Array<{
                label: string;
                type: "PERCENT" | "FIXED";
                value: number;
            }>;
            quickStaffDiscountEnabled?: boolean;
            quickStaffDiscountLabel?: string;
            quickStaffDiscountType?: "PERCENT" | "FIXED";
            quickStaffDiscountValue?: number;
        };
        predefinedTables?: string[];
    };
}

const MENU_HEADER_LOGO_MAX_FILE_BYTES = 2 * 1024 * 1024;
const MENU_HEADER_LOGO_TARGET_RATIO = 10 / 4;
const MENU_HEADER_LOGO_RATIO_TOLERANCE = 0.12;

const MENU_HEADER_LOGO_ACCEPTED_TYPES = new Set(["image/png", "image/jpeg"]);
const RECEIPT_HEADER_LOGO_MAX_FILE_BYTES = 2 * 1024 * 1024;
const RECEIPT_HEADER_LOGO_ACCEPTED_TYPES = new Set(["image/png", "image/jpeg"]);

export function ActiveEventSettingsForm({ event }: ActiveEventSettingsFormProps) {
    const [isPending, startTransition] = useTransition();
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tablesError, setTablesError] = useState<string | null>(null);
    const [newTableValue, setNewTableValue] = useState("");
    const [bulkImportValue, setBulkImportValue] = useState("");
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
    const [menuHeaderLogoFileError, setMenuHeaderLogoFileError] = useState<string | null>(null);
    const [menuHeaderLogoPreviewUrl, setMenuHeaderLogoPreviewUrl] = useState<string | null>(event.settings?.menuHeaderLogoUrl || null);
    const [removeMenuHeaderLogo, setRemoveMenuHeaderLogo] = useState(false);
    const [receiptHeaderLogoFileError, setReceiptHeaderLogoFileError] = useState<string | null>(null);
    const [receiptHeaderLogoPreviewUrl, setReceiptHeaderLogoPreviewUrl] = useState<string | null>(event.settings?.receiptHeaderLogoUrl || null);
    const [removeReceiptHeaderLogo, setRemoveReceiptHeaderLogo] = useState(false);
    const previewObjectUrlRef = useRef<string | null>(null);
    const receiptPreviewObjectUrlRef = useRef<string | null>(null);
    const menuHeaderLogoFileInputRef = useRef<HTMLInputElement | null>(null);
    const receiptHeaderLogoFileInputRef = useRef<HTMLInputElement | null>(null);
    const [predefinedTables, setPredefinedTables] = useState<string[]>(() =>
        parsePredefinedTablesInput(
            Array.isArray(event.predefinedTables) ? event.predefinedTables.join("\n") : "",
            Number.MAX_SAFE_INTEGER
        )
    );
    const [quickDiscountPresets, setQuickDiscountPresets] = useState<Array<{
        label: string;
        type: QuickDiscountType;
        value: string;
    }>>(() =>
        resolveQuickDiscountPresetsFromSettings(event.settings).map((preset) => ({
            label: preset.label,
            type: preset.type,
            value: String(preset.value)
        }))
    );

    const predefinedTablesCount = predefinedTables.length;
    const predefinedTablesOverLimit = predefinedTablesCount > MAX_PREDEFINED_TABLES;
    const quickDiscountPresetCount = quickDiscountPresets.length;
    const quickDiscountPresetsPayload = JSON.stringify(
        quickDiscountPresets.map((preset) => ({
            label: preset.label,
            type: preset.type,
            value: preset.value.trim().replace(",", ".")
        }))
    );

    useEffect(() => {
        return () => {
            if (previewObjectUrlRef.current) {
                URL.revokeObjectURL(previewObjectUrlRef.current);
            }
            if (receiptPreviewObjectUrlRef.current) {
                URL.revokeObjectURL(receiptPreviewObjectUrlRef.current);
            }
        };
    }, []);

    const handleMenuHeaderLogoFileChange = async (file: File | null) => {
        setMenuHeaderLogoFileError(null);
        if (!file) {
            setMenuHeaderLogoPreviewUrl(event.settings?.menuHeaderLogoUrl || null);
            return;
        }

        if (!MENU_HEADER_LOGO_ACCEPTED_TYPES.has(file.type)) {
            setMenuHeaderLogoFileError("Formato non supportato: usa PNG o JPEG.");
            return;
        }

        if (file.size > MENU_HEADER_LOGO_MAX_FILE_BYTES) {
            setMenuHeaderLogoFileError("File troppo grande: massimo 2MB.");
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        const image = new window.Image();

        await new Promise<void>((resolve) => {
            image.onload = () => {
                const ratio = image.naturalWidth / image.naturalHeight;
                if (!Number.isFinite(ratio) || Math.abs(ratio - MENU_HEADER_LOGO_TARGET_RATIO) > MENU_HEADER_LOGO_RATIO_TOLERANCE) {
                    URL.revokeObjectURL(objectUrl);
                    setMenuHeaderLogoFileError("Rapporto immagine non valido: richiesto 10:4 (tolleranza ±12%).");
                    resolve();
                    return;
                }

                if (previewObjectUrlRef.current) {
                    URL.revokeObjectURL(previewObjectUrlRef.current);
                }
                previewObjectUrlRef.current = objectUrl;
                setMenuHeaderLogoPreviewUrl(objectUrl);
                setRemoveMenuHeaderLogo(false);
                resolve();
            };

            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                setMenuHeaderLogoFileError("Impossibile leggere l'immagine selezionata.");
                resolve();
            };
            image.src = objectUrl;
        });
    };

    const handleReceiptHeaderLogoFileChange = async (file: File | null) => {
        setReceiptHeaderLogoFileError(null);
        if (!file) {
            setReceiptHeaderLogoPreviewUrl(event.settings?.receiptHeaderLogoUrl || null);
            return;
        }

        if (!RECEIPT_HEADER_LOGO_ACCEPTED_TYPES.has(file.type)) {
            setReceiptHeaderLogoFileError("Formato non supportato: usa PNG o JPEG.");
            return;
        }

        if (file.size > RECEIPT_HEADER_LOGO_MAX_FILE_BYTES) {
            setReceiptHeaderLogoFileError("File troppo grande: massimo 2MB.");
            return;
        }

        const objectUrl = URL.createObjectURL(file);
        const image = new window.Image();

        await new Promise<void>((resolve) => {
            image.onload = () => {
                if (receiptPreviewObjectUrlRef.current) {
                    URL.revokeObjectURL(receiptPreviewObjectUrlRef.current);
                }
                receiptPreviewObjectUrlRef.current = objectUrl;
                setReceiptHeaderLogoPreviewUrl(objectUrl);
                setRemoveReceiptHeaderLogo(false);
                resolve();
            };

            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                setReceiptHeaderLogoFileError("Impossibile leggere l'immagine selezionata.");
                resolve();
            };
            image.src = objectUrl;
        });
    };

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

    const addQuickDiscountPreset = () => {
        if (quickDiscountPresetCount >= MAX_QUICK_DISCOUNT_PRESETS) return;
        setQuickDiscountPresets((prev) => [...prev, { label: "", type: "PERCENT", value: "10" }]);
        setError(null);
    };

    const removeQuickDiscountPreset = (index: number) => {
        setQuickDiscountPresets((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
        setError(null);
    };

    const updateQuickDiscountPreset = (
        index: number,
        updates: Partial<{ label: string; type: QuickDiscountType; value: string; }>
    ) => {
        setQuickDiscountPresets((prev) => prev.map((preset, currentIndex) => (
            currentIndex === index ? { ...preset, ...updates } : preset
        )));
        setError(null);
    };

    async function handleSubmit(formData: FormData) {
        setSaved(false);
        setError(null);
        if (menuHeaderLogoFileError) {
            setError(menuHeaderLogoFileError);
            return;
        }
        if (receiptHeaderLogoFileError) {
            setError(receiptHeaderLogoFileError);
            return;
        }
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
            <input type="hidden" name="quickDiscountPresets" value={quickDiscountPresetsPayload} />
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

                    <div className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 shadow-sm hover:bg-slate-50 transition-colors">
                        <input
                            type="checkbox"
                            name="portalEasterEggEnabled"
                            id="portalEasterEggEnabled"
                            defaultChecked={event.settings?.portalEasterEggEnabled}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <div className="space-y-1 leading-none">
                            <Label htmlFor="portalEasterEggEnabled" className="text-sm font-medium cursor-pointer">
                                Abilita Easter Egg foto
                            </Label>
                            <p className="text-xs text-muted-foreground">Consente alla WebApp cliente di allegare una foto termica dopo l&apos;invio dell&apos;ordine.</p>
                        </div>
                    </div>

                    <div className="space-y-2 rounded-md border p-4 shadow-sm">
                        <Label htmlFor="posCatalogLayout" className="text-sm font-medium">
                            Layout Catalogo POS
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            Scegli la vista operativa del catalogo cassa.
                        </p>
                        <select
                            id="posCatalogLayout"
                            name="posCatalogLayout"
                            defaultValue={event.settings?.posCatalogLayout || "COMPACT_COLUMNS"}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                            <option value="COMPACT_COLUMNS">Compatto a colonne (attuale)</option>
                            <option value="MODERN_TABS">Moderno con categorie in alto</option>
                        </select>
                    </div>

                    <div className="space-y-3 rounded-md border p-4 shadow-sm sm:col-span-2">
                        <div className="space-y-1">
                            <Label htmlFor="menuHeaderLogoFile" className="text-sm font-medium">
                                Logo Header Menu (rapporto 10:4)
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Carica dal tuo PC un logo PNG/JPG (max 2MB). Se valido, verrà salvato e l&apos;URL verrà impostato automaticamente.
                            </p>
                        </div>
                        <input
                            id="menuHeaderLogoFile"
                            ref={menuHeaderLogoFileInputRef}
                            name="menuHeaderLogoFile"
                            type="file"
                            accept="image/png,image/jpeg"
                            data-testid="menu-header-logo-file-input"
                            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold"
                            onChange={(inputEvent) => {
                                const file = inputEvent.currentTarget.files?.[0] || null;
                                void handleMenuHeaderLogoFileChange(file);
                            }}
                        />
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <input
                                type="checkbox"
                                name="removeMenuHeaderLogo"
                                checked={removeMenuHeaderLogo}
                                onChange={(inputEvent) => {
                                    const checked = inputEvent.currentTarget.checked;
                                    setRemoveMenuHeaderLogo(checked);
                                    if (checked) {
                                        if (menuHeaderLogoFileInputRef.current) {
                                            menuHeaderLogoFileInputRef.current.value = "";
                                        }
                                        setMenuHeaderLogoFileError(null);
                                        setMenuHeaderLogoPreviewUrl(null);
                                    } else {
                                        setMenuHeaderLogoPreviewUrl(event.settings?.menuHeaderLogoUrl || null);
                                    }
                                }}
                            />
                            Rimuovi logo header personalizzato
                        </label>
                        {menuHeaderLogoPreviewUrl ? (
                            <div className="overflow-hidden rounded-xl border bg-slate-50 p-2">
                                <div className="mx-auto max-w-md overflow-hidden rounded-lg border bg-white" style={{ aspectRatio: "10 / 4" }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={menuHeaderLogoPreviewUrl}
                                        alt="Anteprima logo header menu"
                                        className="h-full w-full object-contain"
                                    />
                                </div>
                            </div>
                        ) : null}
                        {event.settings?.menuHeaderLogoUrl ? (
                            <p className="text-xs text-slate-500">
                                URL attuale: <code>{event.settings.menuHeaderLogoUrl}</code>
                            </p>
                        ) : null}
                        {menuHeaderLogoFileError ? (
                            <p className="text-xs font-semibold text-red-600">{menuHeaderLogoFileError}</p>
                        ) : null}
                    </div>

                    <div className="space-y-3 rounded-md border p-4 shadow-sm sm:col-span-2">
                        <div className="space-y-1">
                            <Label htmlFor="receiptHeaderLogoFile" className="text-sm font-medium">
                                Header Scontrino Stampa (rapporto 10:3)
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Carica dal tuo PC un&apos;immagine PNG/JPG (max 2MB) per la testata degli scontrini. Il server adatta automaticamente il rapporto a 10:3. Se assente, la stampante userà il nome festa in grande.
                            </p>
                        </div>
                        <input
                            id="receiptHeaderLogoFile"
                            ref={receiptHeaderLogoFileInputRef}
                            name="receiptHeaderLogoFile"
                            type="file"
                            accept="image/png,image/jpeg"
                            data-testid="receipt-header-logo-file-input"
                            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold"
                            onChange={(inputEvent) => {
                                const file = inputEvent.currentTarget.files?.[0] || null;
                                void handleReceiptHeaderLogoFileChange(file);
                            }}
                        />
                        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <input
                                type="checkbox"
                                name="removeReceiptHeaderLogo"
                                checked={removeReceiptHeaderLogo}
                                onChange={(inputEvent) => {
                                    const checked = inputEvent.currentTarget.checked;
                                    setRemoveReceiptHeaderLogo(checked);
                                    if (checked) {
                                        if (receiptHeaderLogoFileInputRef.current) {
                                            receiptHeaderLogoFileInputRef.current.value = "";
                                        }
                                        setReceiptHeaderLogoFileError(null);
                                        setReceiptHeaderLogoPreviewUrl(null);
                                    } else {
                                        setReceiptHeaderLogoPreviewUrl(event.settings?.receiptHeaderLogoUrl || null);
                                    }
                                }}
                            />
                            Rimuovi header scontrino personalizzato
                        </label>
                        {receiptHeaderLogoPreviewUrl ? (
                            <div className="overflow-hidden rounded-xl border bg-slate-50 p-2">
                                <div className="mx-auto max-w-md overflow-hidden rounded-lg border bg-white" style={{ aspectRatio: "10 / 3" }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={receiptHeaderLogoPreviewUrl}
                                        alt="Anteprima header scontrino"
                                        className="h-full w-full object-contain"
                                    />
                                </div>
                            </div>
                        ) : null}
                        {event.settings?.receiptHeaderLogoUrl ? (
                            <p className="text-xs text-slate-500">
                                URL attuale: <code>{event.settings.receiptHeaderLogoUrl}</code>
                            </p>
                        ) : null}
                        {receiptHeaderLogoFileError ? (
                            <p className="text-xs font-semibold text-red-600">{receiptHeaderLogoFileError}</p>
                        ) : null}
                    </div>
                </div>

                <div className="space-y-4 rounded-md border p-4 shadow-sm">
                    <div className="space-y-1">
                        <Label className="text-sm font-medium">
                            Preset Sconti Rapidi POS
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            Configura più preset (es. Staff 50%, Promo 10%) disponibili nella Scheda Sconti del carrello POS.
                        </p>
                    </div>
                    <div className="flex items-center justify-between rounded-md border bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                        <span>Preset configurati: {quickDiscountPresetCount}/{MAX_QUICK_DISCOUNT_PRESETS}</span>
                        <Button
                            id="quick-discount-add-preset"
                            type="button"
                            variant="outline"
                            className="h-8 gap-2 text-xs font-bold"
                            onClick={addQuickDiscountPreset}
                            disabled={quickDiscountPresetCount >= MAX_QUICK_DISCOUNT_PRESETS}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Aggiungi preset
                        </Button>
                    </div>

                    {quickDiscountPresetCount === 0 ? (
                        <p className="rounded-md border border-dashed bg-white p-3 text-xs italic text-muted-foreground">
                            Nessun preset configurato: il POS mostrerà solo le opzioni sconto avanzate.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {quickDiscountPresets.map((preset, index) => (
                                <div key={`quick-preset-${index}`} className="rounded-md border bg-white p-3">
                                    <div className="grid gap-3 sm:grid-cols-[1.3fr_0.9fr_0.9fr_auto]">
                                        <div className="space-y-1">
                                            <Label htmlFor={`quickDiscountLabel-${index}`} className="text-xs font-medium">Etichetta</Label>
                                            <Input
                                                id={`quickDiscountLabel-${index}`}
                                                data-testid={`quick-discount-label-${index}`}
                                                value={preset.label}
                                                onChange={(e) => updateQuickDiscountPreset(index, { label: e.target.value })}
                                                placeholder="Es: Staff"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor={`quickDiscountType-${index}`} className="text-xs font-medium">Tipo</Label>
                                            <select
                                                id={`quickDiscountType-${index}`}
                                                data-testid={`quick-discount-type-${index}`}
                                                value={preset.type}
                                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                                onChange={(e) => updateQuickDiscountPreset(index, { type: e.target.value as QuickDiscountType })}
                                            >
                                                <option value="PERCENT">Percentuale (%)</option>
                                                <option value="FIXED">Importo fisso (€)</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor={`quickDiscountValue-${index}`} className="text-xs font-medium">Valore</Label>
                                            <Input
                                                id={`quickDiscountValue-${index}`}
                                                data-testid={`quick-discount-value-${index}`}
                                                value={preset.value}
                                                onChange={(e) => updateQuickDiscountPreset(index, { value: e.target.value })}
                                                placeholder={preset.type === "PERCENT" ? "Es: 50" : "Es: 2.00"}
                                                inputMode="decimal"
                                            />
                                        </div>
                                        <div className="flex items-end">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-9 gap-1 text-xs font-bold text-red-700 hover:text-red-800"
                                                onClick={() => removeQuickDiscountPreset(index)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Rimuovi
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
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
