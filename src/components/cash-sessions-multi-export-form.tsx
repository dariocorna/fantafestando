"use client"

import { useState, type FormEvent } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

export const CASH_SESSIONS_MULTI_EXPORT_FORM_ID = "cash-sessions-multi-export"

export function CashSessionsMultiExportForm({ hasClosedSessions }: { hasClosedSessions: boolean }) {
    const [error, setError] = useState("")

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        if (new FormData(event.currentTarget).getAll("sessionId").length > 0) {
            setError("")
            return
        }

        event.preventDefault()
        setError("Seleziona almeno una sessione chiusa da esportare.")
    }

    return (
        <form
            id={CASH_SESSIONS_MULTI_EXPORT_FORM_ID}
            action="/admin/cash-sessions/export"
            method="get"
            onSubmit={handleSubmit}
            className="flex flex-col items-end gap-1"
        >
            <input type="hidden" name="format" value="xlsx" />
            <Button type="submit" variant="outline" size="sm" disabled={!hasClosedSessions}>
                <Download className="h-4 w-4" />
                Esporta selezionate XLSX
            </Button>
            <p className="text-xs text-muted-foreground">
                {hasClosedSessions ? "Seleziona almeno una sessione chiusa." : "Nessuna sessione chiusa disponibile."}
            </p>
            {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
        </form>
    )
}
