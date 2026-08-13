"use client"

import { useSyncExternalStore, useTransition } from "react"
import { Loader2, Printer, RotateCcw, SearchCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { recoverUncertainSumUpOrderById, reprintOrderById, stornoPaidOrderById } from "./actions"

const subscribeToNothing = () => () => undefined

export function OrderRowActions(props: {
    orderId: string
    canReprint: boolean
    canStorno: boolean
    isLateSumUpRefund: boolean
    canRecoverSumUp: boolean
}) {
    const [isPending, startTransition] = useTransition()
    const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false)

    const handleReprint = () => {
        startTransition(async () => {
            const result = await reprintOrderById(props.orderId)
            if (!result.success) {
                window.alert(result.error || "Ristampa non riuscita")
                return
            }

            window.alert("Ristampa inviata correttamente")
        })
    }

    const handleStorno = () => {
        const confirm = window.confirm(props.isLateSumUpRefund
            ? "Confermi il rimborso del pagamento SumUp arrivato dopo l'annullamento locale?"
            : "Confermi lo storno di questo ordine?")
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

    const handleSumUpRecovery = () => {
        const confirm = window.confirm(
            "Verificare l'esito direttamente su SumUp? L'ordine sarà annullato solo se, dopo almeno 15 minuti, non esiste alcuna transazione e il reader è online e libero."
        )
        if (!confirm) return

        startTransition(async () => {
            const result = await recoverUncertainSumUpOrderById(props.orderId)
            window.alert(result.success
                ? result.message
                : result.error || "Verifica SumUp non riuscita")
        })
    }

    return (
        <div className="flex justify-end gap-2">
            <Button
                variant="ghost"
                size="sm"
                title="Ristampa comanda"
                onClick={handleReprint}
                disabled={!hydrated || !props.canReprint || isPending}
            >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            </Button>
            <Button
                variant="ghost"
                size="sm"
                title={props.isLateSumUpRefund ? "Rimborsa pagamento SumUp tardivo" : "Storna ordine"}
                onClick={handleStorno}
                disabled={!hydrated || !props.canStorno || isPending}
                className="text-rose-600 hover:text-rose-700"
            >
                <RotateCcw className="h-4 w-4" />
            </Button>
            {props.canRecoverSumUp ? (
                <Button
                    variant="ghost"
                    size="sm"
                    title="Verifica e recupera pagamento SumUp"
                    aria-label="Verifica e recupera pagamento SumUp"
                    onClick={handleSumUpRecovery}
                    disabled={!hydrated || isPending}
                    className="text-amber-700 hover:text-amber-800"
                >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
                </Button>
            ) : null}
        </div>
    )
}
