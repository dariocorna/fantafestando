"use client"

import { useTransition } from "react"
import { Loader2, Printer, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reprintOrderById, stornoPaidOrderById } from "./actions"

export function OrderRowActions(props: {
    orderId: string
    canReprint: boolean
    canStorno: boolean
}) {
    const [isPending, startTransition] = useTransition()

    const handleReprint = () => {
        startTransition(async () => {
            const result = await reprintOrderById(props.orderId)
            if (!result.success) {
                window.alert(result.error || "Ristampa non riuscita")
            }
        })
    }

    const handleStorno = () => {
        const confirm = window.confirm("Confermi lo storno di questo ordine?")
        if (!confirm) return

        const reason = window.prompt("Motivo storno (opzionale):", "")
        if (reason === null) return

        startTransition(async () => {
            const result = await stornoPaidOrderById(props.orderId, reason || undefined)
            if (!result.success) {
                window.alert(result.error || "Storno non riuscito")
                return
            }

            if (result.alreadyCancelled) {
                window.alert("Ordine già stornato in precedenza")
            }
        })
    }

    return (
        <div className="flex justify-end gap-2">
            <Button
                variant="ghost"
                size="sm"
                title="Ristampa comanda"
                onClick={handleReprint}
                disabled={!props.canReprint || isPending}
            >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            </Button>
            <Button
                variant="ghost"
                size="sm"
                title="Storna ordine"
                onClick={handleStorno}
                disabled={!props.canStorno || isPending}
                className="text-rose-600 hover:text-rose-700"
            >
                <RotateCcw className="h-4 w-4" />
            </Button>
        </div>
    )
}
