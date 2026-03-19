"use client"

import { useState, useTransition } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { ORDER_RESET_CONFIRMATION_TOKEN } from "@/lib/order-reset"
import { resetEventOrdersAction } from "./actions"

interface ResetOrdersFormProps {
    eventName: string
}

type FeedbackState =
    | { kind: "success", message: string }
    | { kind: "error", message: string }
    | null

export function ResetOrdersForm({ eventName }: ResetOrdersFormProps) {
    const [isPending, startTransition] = useTransition()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [confirmationToken, setConfirmationToken] = useState("")
    const [feedback, setFeedback] = useState<FeedbackState>(null)

    const handleReset = () => {
        startTransition(async () => {
            const formData = new FormData()
            formData.set("confirmationToken", confirmationToken)

            const result = await resetEventOrdersAction(formData)
            if (!result.success) {
                setFeedback({ kind: "error", message: result.error })
                return
            }

            const summary = result.summary
            setFeedback({
                kind: "success",
                message: `Reset completato: ${summary.deletedOrders} ordini, ${summary.deletedOrderCounters} contatori, ${summary.deletedPrintJobs} job stampa, ${summary.deletedCashSessions} sessioni cassa eliminati.`
            })
            setConfirmationToken("")
            setIsDialogOpen(false)
        })
    }

    return (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4" data-testid="admin-reset-orders-panel">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-rose-800">Zona Pericolosa</h2>
                    <p className="text-sm text-rose-700">
                        Elimina definitivamente ordini, contatori, job di stampa e sessioni cassa della festa <strong>{eventName}</strong>.
                    </p>
                </div>

                <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <AlertDialogTrigger asChild>
                        <Button
                            variant="destructive"
                            data-testid="admin-reset-orders-trigger"
                        >
                            <AlertTriangle className="h-4 w-4" />
                            Reset ordini festa
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Conferma reset ordini festa</AlertDialogTitle>
                            <AlertDialogDescription>
                                Operazione irreversibile. Verranno eliminati tutti i dati ordine della festa selezionata.
                                Digita <strong>{ORDER_RESET_CONFIRMATION_TOKEN}</strong> per confermare.
                            </AlertDialogDescription>
                        </AlertDialogHeader>

                        <div className="space-y-2">
                            <label htmlFor="reset-orders-token" className="text-sm font-medium text-slate-700">
                                Token di conferma
                            </label>
                            <Input
                                id="reset-orders-token"
                                data-testid="admin-reset-orders-token-input"
                                value={confirmationToken}
                                onChange={(event) => setConfirmationToken(event.target.value)}
                                placeholder={ORDER_RESET_CONFIRMATION_TOKEN}
                                autoCapitalize="characters"
                            />
                        </div>

                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={isPending}>Annulla</AlertDialogCancel>
                            <AlertDialogAction
                                type="button"
                                onClick={handleReset}
                                disabled={isPending}
                                className="bg-rose-700 hover:bg-rose-800"
                                data-testid="admin-reset-orders-confirm"
                            >
                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Conferma reset
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>

            {feedback ? (
                <p
                    className={`mt-3 text-sm ${feedback.kind === "success" ? "text-emerald-700" : "text-rose-700"}`}
                    data-testid={feedback.kind === "success" ? "admin-reset-orders-success" : "admin-reset-orders-error"}
                >
                    {feedback.message}
                </p>
            ) : null}
        </div>
    )
}
