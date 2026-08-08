import { createEvent, fireEvent, render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import {
    CASH_SESSIONS_MULTI_EXPORT_FORM_ID,
    CashSessionsMultiExportForm
} from "@/components/cash-sessions-multi-export-form"

test("blocks an empty export and allows a selected session", () => {
    render(
        <>
            <input type="checkbox" name="sessionId" value="session-1" form={CASH_SESSIONS_MULTI_EXPORT_FORM_ID} aria-label="Sessione 1" />
            <CashSessionsMultiExportForm hasClosedSessions />
        </>
    )
    const form = screen.getByRole("button", { name: "Esporta selezionate XLSX" }).closest("form")!

    const emptySubmit = createEvent.submit(form)
    fireEvent(form, emptySubmit)
    expect(emptySubmit.defaultPrevented).toBe(true)
    expect(screen.getByRole("alert")).toHaveTextContent("Seleziona almeno una sessione chiusa")

    fireEvent.click(screen.getByLabelText("Sessione 1"))
    const selectedSubmit = createEvent.submit(form)
    fireEvent(form, selectedSubmit)
    expect(selectedSubmit.defaultPrevented).toBe(false)
})

test("disables export when no closed sessions are available", () => {
    render(<CashSessionsMultiExportForm hasClosedSessions={false} />)

    expect(screen.getByRole("button", { name: "Esporta selezionate XLSX" })).toBeDisabled()
    expect(screen.getByText("Nessuna sessione chiusa disponibile.")).toBeVisible()
})
