"use client"

import { Trash2 } from "lucide-react"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function MenuCartDeleteDialog({
    itemName,
    quantity,
    onConfirm,
}: {
    itemName: string
    quantity: number
    onConfirm: () => void
}) {
    const itemSummary = `${Math.max(quantity, 1)} x ${itemName}`

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <button
                    type="button"
                    className="rounded-full p-1 text-red-400 hover:text-red-600"
                    aria-label={`Elimina ${itemName} dal carrello`}
                    title={`Elimina ${itemName}`}
                >
                    <Trash2 size={16} />
                </button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>Rimuovere questo prodotto dall&apos;ordine?</AlertDialogTitle>
                    <AlertDialogDescription>
                        <span className="font-semibold text-slate-700">{itemSummary}</span>
                        {" "}verra' rimosso completamente dal carrello. Potrai sempre aggiungerlo di nuovo dal menu.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-red-600 text-white hover:bg-red-700"
                        onClick={onConfirm}
                    >
                        Elimina
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
