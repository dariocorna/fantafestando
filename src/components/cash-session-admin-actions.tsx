"use client"

import { useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Printer, TestTube2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { deleteCashSessionAction, reprintClosedCashSessionAction, setCashSessionTestAction } from "@/app/admin/cash-sessions/actions"

const subscribeToNothing = () => () => undefined

export function CashSessionAdminActions({ sessionId, isClosed, isTest }: { sessionId: string; isClosed: boolean; isTest: boolean }) {
    const router = useRouter()
    const [busy, setBusy] = useState<string | null>(null)
    const [message, setMessage] = useState("")
    const [confirmation, setConfirmation] = useState("")
    const [deleteOpen, setDeleteOpen] = useState(false)
    const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false)

    const classify = async () => {
        setBusy("test")
        const result = await setCashSessionTestAction(sessionId, !isTest)
        setBusy(null)
        if (!result.success) return setMessage(result.shortages?.length
            ? result.shortages.map((item) => `${item.entityName}: richieste ${item.required}, disponibili ${item.available}`).join("; ")
            : result.error)
        setMessage(result.approximateOrders ? `${result.approximateOrders} ordini storici ricostruiti in modo approssimativo` : "")
        router.refresh()
    }

    const reprint = async () => {
        setBusy("print")
        const result = await reprintClosedCashSessionAction(sessionId)
        setBusy(null)
        setMessage(result.success ? "Riepilogo inviato alla stampante originale" : result.error)
    }

    const remove = async () => {
        setBusy("delete")
        const result = await deleteCashSessionAction(sessionId, confirmation)
        setBusy(null)
        if (!result.success) return setMessage(result.error)
        setDeleteOpen(false)
        router.refresh()
    }

    return (
        <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void classify()} disabled={!hydrated || busy !== null}>
                {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                {isTest ? "Rendi normale" : "Segna TEST"}
            </Button>
            {isClosed ? <Button type="button" variant="outline" size="sm" onClick={() => void reprint()} disabled={!hydrated || busy !== null}>
                {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Ristampa
            </Button> : null}
            {isClosed ? (
                <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                    <DialogTrigger asChild><Button type="button" variant="destructive" size="sm" disabled={!hydrated}><Trash2 className="h-4 w-4" /> Elimina</Button></DialogTrigger>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Elimina definitivamente la sessione</DialogTitle></DialogHeader>
                        <p className="text-sm text-slate-600">Ordini e stampe verranno eliminati. Digita <strong>ELIMINA</strong> per confermare.</p>
                        <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-label="Conferma eliminazione sessione" />
                        <Button type="button" variant="destructive" disabled={!hydrated || confirmation !== "ELIMINA" || busy !== null} onClick={() => void remove()}>
                            {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Elimina sessione
                        </Button>
                    </DialogContent>
                </Dialog>
            ) : null}
            {message ? <p className="w-full text-right text-xs font-semibold text-slate-600" role="status">{message}</p> : null}
        </div>
    )
}
