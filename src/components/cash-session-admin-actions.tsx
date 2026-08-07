"use client"

import { useState } from "react"
import { Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reprintClosedCashSessionAction } from "@/app/admin/cash-sessions/actions"

export function CashSessionAdminActions({ sessionId, isClosed }: { sessionId: string; isClosed: boolean }) {
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState("")

    const reprint = async () => {
        setBusy(true)
        const result = await reprintClosedCashSessionAction(sessionId)
        setBusy(false)
        setMessage(result.success ? "Riepilogo inviato alla stampante originale" : result.error)
    }

    if (!isClosed) return null

    return (
        <div className="flex flex-wrap items-center justify-end gap-1">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reprint}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Ristampa
            </Button>
            {message ? <p className="w-full text-right text-xs font-semibold text-slate-600">{message}</p> : null}
        </div>
    )
}
