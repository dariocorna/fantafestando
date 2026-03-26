"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { EditCategoryDialog } from "@/components/edit-category-dialog";
import { DeleteForm } from "@/components/delete-form";
import { normalizeCategoryColor } from "@/lib/category-colors";

export interface SerializedCategory {
    _id: string;
    name: string;
    uiColor: string;
    printOrder: number;
    printerName?: string;
    printerId?: string;
    skipKitchenPrint?: boolean;
    pizzaFlowEnabled?: boolean;
}

interface SortableCategoryTableProps {
    categories: SerializedCategory[];
    onReorder: (newOrder: string[]) => void;
    eventId: string;
    printers: { id: string; name: string; ip: string; port?: number }[];
    updateAction: (formData: FormData) => Promise<{ success?: boolean; error?: string } | void>;
    deleteAction: (formData: FormData) => Promise<void>;
}

export function SortableCategoryTable({
    categories: initialCategories,
    onReorder,
    eventId,
    printers,
    updateAction,
    deleteAction,
}: SortableCategoryTableProps) {
    const [mounted, setMounted] = useState(false);
    const [categories, setCategories] = useState(initialCategories);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        setCategories(initialCategories);
    }, [initialCategories]);

    const [, startTransition] = useTransition();

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = categories.findIndex(c => String(c._id) === String(active.id));
            const newIndex = categories.findIndex(c => String(c._id) === String(over.id));

            if (oldIndex !== -1 && newIndex !== -1) {
                const newOrder = arrayMove(categories, oldIndex, newIndex);
                setCategories(newOrder); // Optimistic UI update

                startTransition(async () => {
                    try {
                        await onReorder(newOrder.map(c => String(c._id)));
                    } catch (error) {
                        console.error("Reorder failed, reverting:", error);
                        setCategories(initialCategories);
                    }
                });
            }
        }
    }

    if (!mounted) {
        // Basic table for SSR and initial hydration to avoid mismatches
        return (
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Colore</TableHead>
                        <TableHead>Flusso Pizza</TableHead>
                        <TableHead>Stampa Comanda</TableHead>
                        <TableHead>Stampante Comanda</TableHead>
                        <TableHead className="w-[80px]">Azioni</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {categories.map((cat) => (
                        <TableRow key={String(cat._id)}>
                            <TableCell>
                                <GripVertical className="h-5 w-5 text-muted-foreground/20" />
                            </TableCell>
                            <TableCell className="font-medium">{cat.name}</TableCell>
                            <TableCell>
                                <div
                                    className="w-4 h-4 rounded-full border border-black/10"
                                    style={{ backgroundColor: normalizeCategoryColor(cat.uiColor) }}
                                />
                            </TableCell>
                            <TableCell>
                                {cat.pizzaFlowEnabled ? (
                                    <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700">
                                        Pizza
                                    </span>
                                ) : (
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                                        No
                                    </span>
                                )}
                            </TableCell>
                            <TableCell>
                                {cat.skipKitchenPrint ? (
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                                        Non stampare
                                    </span>
                                ) : (
                                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">
                                        Standard
                                    </span>
                                )}
                            </TableCell>
                            <TableCell>
                                {cat.skipKitchenPrint
                                    ? "Ignorata dal flag categoria"
                                    : cat.printerName || "Default Cassa"}
                            </TableCell>
                            <TableCell className="flex gap-2">
                                {/* Dialogs are client-only anyway, so we just match the spacing */}
                                <div className="w-7 h-7" />
                                <div className="w-7 h-7" />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        );
    }

    return (
        <DndContext
            id="category-dnd-context"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
        >
            <SortableContext items={categories.map(c => String(c._id))} strategy={verticalListSortingStrategy}>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[40px]"></TableHead>
                            <TableHead>Nome</TableHead>
                        <TableHead>Colore</TableHead>
                        <TableHead>Flusso Pizza</TableHead>
                        <TableHead>Stampa Comanda</TableHead>
                        <TableHead>Stampante Comanda</TableHead>
                        <TableHead className="w-[80px]">Azioni</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories.map((cat) => (
                            <SortableCategoryRow key={String(cat._id)} id={String(cat._id)}>
                                <TableCell>
                                    <DragHandle id={String(cat._id)} />
                                </TableCell>
                                <TableCell className="font-medium">{cat.name}</TableCell>
                                <TableCell>
                                    <div
                                        className="w-4 h-4 rounded-full border border-black/10"
                                        style={{ backgroundColor: normalizeCategoryColor(cat.uiColor) }}
                                    />
                                </TableCell>
                                <TableCell>
                                    {cat.pizzaFlowEnabled ? (
                                        <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700">
                                            Pizza
                                        </span>
                                    ) : (
                                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                                            No
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {cat.skipKitchenPrint ? (
                                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                                            Non stampare
                                        </span>
                                    ) : (
                                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">
                                            Standard
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {cat.skipKitchenPrint
                                        ? "Ignorata dal flag categoria"
                                        : cat.printerName || "Default Cassa"}
                                </TableCell>
                                <TableCell className="flex gap-2 relative z-10 w-fit">
                                    <EditCategoryDialog
                                        category={{
                                            id: String(cat._id),
                                            name: cat.name,
                                            uiColor: normalizeCategoryColor(cat.uiColor),
                                            printerId: cat.printerId,
                                            skipKitchenPrint: cat.skipKitchenPrint,
                                            pizzaFlowEnabled: cat.pizzaFlowEnabled
                                        }}
                                        eventId={eventId}
                                        printers={printers}
                                        updateAction={updateAction}
                                    />
                                    <DeleteForm
                                        id={String(cat._id)}
                                        idName="id"
                                        hiddenFields={[{ name: "eventId", value: eventId }]}
                                        message="Eliminare la categoria e TUTTI i suoi prodotti?"
                                        action={deleteAction}
                                        buttonSize="xs"
                                        iconSize={16}
                                    />
                                </TableCell>
                            </SortableCategoryRow>
                        ))}
                    </TableBody>
                </Table>
            </SortableContext>
        </DndContext>
    );
}

export function SortableCategoryRow({ id, children }: { id: string; children: React.ReactNode }) {
    const { setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
        position: isDragging ? "relative" as const : undefined,
        zIndex: isDragging ? 1 : 0,
        backgroundColor: isDragging ? "var(--muted)" : undefined,
    };

    return (
        <TableRow ref={setNodeRef} style={style}>
            {children}
        </TableRow>
    );
}

export function DragHandle({ id }: { id: string }) {
    const { attributes, listeners } = useSortable({ id });
    return (
        <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        >
            <GripVertical className="h-5 w-5" />
        </button>
    );
}
