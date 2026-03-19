"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface FixedMenuChoiceOptionDto {
    productId: string;
    name: string;
    quantity: number;
}

export interface FixedMenuChoiceGroupDto {
    id: string;
    name: string;
    minSelections: number;
    maxSelections: number;
    options: FixedMenuChoiceOptionDto[];
}

export interface FixedMenuComponentDto {
    productId: string;
    name: string;
    quantity: number;
}

export interface FixedMenuConfigProductDto {
    _id: string;
    name: string;
    basePrice: number;
    menuComponents?: FixedMenuComponentDto[];
    menuChoiceGroups?: FixedMenuChoiceGroupDto[];
}

export interface FixedMenuSelectionResult {
    menuSelections: Array<{ groupId: string; productId: string }>;
    selectedOptionLabels: string[];
}

function buildInitialSelections(product: FixedMenuConfigProductDto) {
    return Object.fromEntries(
        (product.menuChoiceGroups || []).map((group) => [group.id, [] as string[]])
    ) as Record<string, string[]>;
}

export function FixedMenuConfigDialog({
    open,
    onOpenChange,
    product,
    confirmLabel,
    onConfirm
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    product: FixedMenuConfigProductDto | null;
    confirmLabel?: string;
    onConfirm: (result: FixedMenuSelectionResult) => void;
}) {
    const groups = useMemo(() => product?.menuChoiceGroups ?? [], [product]);
    const [selectionByGroup, setSelectionByGroup] = useState<Record<string, string[]>>(
        () => product ? buildInitialSelections(product) : {}
    );
    const [error, setError] = useState<string | null>(null);
    const hasConfig = groups.length > 0;
    const selectedOptionLabels = useMemo(() => {
        return groups.flatMap((group) => {
            const selectedIds = selectionByGroup[group.id] || [];
            return group.options
                .filter((option) => selectedIds.includes(option.productId))
                .map((option) => `${group.name}: ${option.name}`);
        });
    }, [groups, selectionByGroup]);

    const toggleOption = (groupId: string, productId: string, maxSelections: number) => {
        setSelectionByGroup((prev) => {
            const current = prev[groupId] || [];
            if (maxSelections === 1) {
                return { ...prev, [groupId]: [productId] };
            }

            if (current.includes(productId)) {
                return { ...prev, [groupId]: current.filter((entry) => entry !== productId) };
            }

            if (current.length >= maxSelections) {
                return prev;
            }

            return { ...prev, [groupId]: [...current, productId] };
        });
    };

    const handleConfirm = () => {
        if (!product) return;
        for (const group of groups) {
            const selected = selectionByGroup[group.id] || [];
            if (selected.length < group.minSelections) {
                setError(`Completa la scelta obbligatoria: ${group.name}`);
                return;
            }
            if (selected.length > group.maxSelections) {
                setError(`Hai selezionato troppe opzioni per ${group.name}`);
                return;
            }
        }

        onConfirm({
            menuSelections: groups.flatMap((group) =>
                (selectionByGroup[group.id] || []).map((productId) => ({
                    groupId: group.id,
                    productId
                }))
            ),
            selectedOptionLabels
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{product?.name || "Configura menu"}</DialogTitle>
                    <DialogDescription>
                        Completa le scelte richieste prima di aggiungere il menu al carrello.
                    </DialogDescription>
                </DialogHeader>
                {product ? (
                    <div className="space-y-4 py-2">
                        {Array.isArray(product.menuComponents) && product.menuComponents.length > 0 ? (
                            <div className="space-y-2 rounded-lg border p-3">
                                <Label className="text-sm font-bold">Inclusi sempre</Label>
                                <ul className="space-y-1 text-sm text-slate-600">
                                    {product.menuComponents.map((component) => (
                                        <li key={`${component.productId}-${component.name}`}>
                                            {component.quantity > 1 ? `${component.quantity} x ` : ""}{component.name}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        {hasConfig ? groups.map((group) => {
                            const selected = selectionByGroup[group.id] || [];
                            return (
                                <div key={group.id} className="space-y-3 rounded-lg border p-3">
                                    <div>
                                        <p className="text-sm font-bold text-slate-900">{group.name}</p>
                                        <p className="text-xs text-slate-500">
                                            Scegli da {group.minSelections} a {group.maxSelections} opzioni
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {group.options.map((option) => {
                                            const active = selected.includes(option.productId);
                                            return (
                                                <Button
                                                    key={`${group.id}-${option.productId}`}
                                                    type="button"
                                                    variant={active ? "default" : "outline"}
                                                    className="h-auto min-h-10 px-3 py-2 text-left"
                                                    onClick={() => toggleOption(group.id, option.productId, group.maxSelections)}
                                                >
                                                    {option.quantity > 1 ? `${option.quantity} x ` : ""}{option.name}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        }) : (
                            <p className="text-sm text-slate-500">Questo menu non richiede configurazione.</p>
                        )}

                        {error ? (
                            <p className="text-sm font-medium text-red-600" role="alert">{error}</p>
                        ) : null}
                    </div>
                ) : null}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Annulla
                    </Button>
                    <Button type="button" onClick={handleConfirm}>
                        {confirmLabel || "Aggiungi al carrello"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
