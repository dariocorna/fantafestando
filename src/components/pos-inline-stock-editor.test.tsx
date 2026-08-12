import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

const { updatePosStockMock } = vi.hoisted(() => ({
    updatePosStockMock: vi.fn(),
}))

vi.mock("@/app/pos/actions", () => ({
    updatePosStock: updatePosStockMock,
}))

import { PosInlineStockEditor } from "@/components/pos-inline-stock-editor"

const product = {
    _id: "product-1",
    name: "Panino con salamella",
    shortName: "Salamella",
    stockQuantity: 5,
    variants: [{ optionName: "Doppia", priceVariation: 2, stockQuantity: 3 }],
}

const updatedProduct = {
    id: product._id,
    stockQuantity: 7,
    isSoldOut: false,
    stockStatus: "OK" as const,
    variants: [{ optionName: "Doppia", priceVariation: 2, stockQuantity: 3 }],
}

function renderEditor(onUpdated = vi.fn()) {
    render(
        <PosInlineStockEditor
            eventId="event-1"
            product={product}
            displayName="Salamella"
            priceLabel="6.00 €"
            variant="modern"
            borderColor="#1d4ed8"
            backgroundColor="#dbeafe"
            onUpdated={onUpdated}
        />
    )
    return onUpdated
}

describe("PosInlineStockEditor", () => {
    beforeEach(() => {
        updatePosStockMock.mockReset()
    })

    test("rifiuta valori non interi senza chiamare l'action", () => {
        renderEditor()
        const row = within(screen.getByTestId(`stock-product-${product._id}`))

        fireEvent.change(row.getByRole("spinbutton"), { target: { value: "1.5" } })
        fireEvent.click(row.getByRole("button", { name: /Salva scorta/i }))

        expect(updatePosStockMock).not.toHaveBeenCalled()
        const alert = row.getByRole("alert")
        expect(alert).toHaveTextContent("Inserisci un intero maggiore o uguale a zero")
        expect(row.getByRole("spinbutton")).toHaveAttribute("aria-describedby", alert.id)
    })

    test("salva il valore assoluto e sincronizza il draft con la risposta", async () => {
        updatePosStockMock.mockResolvedValue({ success: true, product: updatedProduct })
        const onUpdated = renderEditor()
        const row = within(screen.getByTestId(`stock-product-${product._id}`))

        fireEvent.change(row.getByRole("spinbutton"), { target: { value: "6" } })
        fireEvent.click(row.getByRole("button", { name: /Salva scorta/i }))

        await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updatedProduct))
        expect(updatePosStockMock).toHaveBeenCalledWith({
            eventId: "event-1",
            productId: product._id,
            variantName: undefined,
            stockQuantity: 6,
        })
        expect(row.getByRole("spinbutton")).toHaveValue(7)
        expect(row.getByRole("status")).toHaveTextContent("Scorta Salamella aggiornata a 7")
    })

    test("mostra l'errore e riabilita Salva quando l'action genera un'eccezione", async () => {
        let rejectAction!: (error: Error) => void
        updatePosStockMock.mockImplementation(() => new Promise((_resolve, reject) => {
            rejectAction = reject
        }))
        renderEditor()
        const row = within(screen.getByTestId(`stock-product-${product._id}`))
        const saveButton = row.getByRole("button", { name: /Salva scorta/i })

        fireEvent.submit(saveButton.closest("form")!)
        await waitFor(() => expect(saveButton).toBeDisabled())
        await act(async () => {
            rejectAction(new Error("rete non disponibile"))
            await Promise.resolve()
        })

        await waitFor(() => expect(row.getByRole("alert")).toHaveTextContent("Impossibile aggiornare le scorte. Riprova."))
        expect(saveButton).toBeEnabled()
    })

    test("mostra l'errore applicativo restituito dall'action", async () => {
        updatePosStockMock.mockResolvedValue({ success: false, error: "Evento attivo non valido" })
        renderEditor()
        const row = within(screen.getByTestId(`stock-product-${product._id}`))
        const saveButton = row.getByRole("button", { name: /Salva scorta/i })

        fireEvent.click(saveButton)

        await waitFor(() => expect(row.getByRole("alert")).toHaveTextContent("Evento attivo non valido"))
        expect(saveButton).toBeEnabled()
    })

    test("riallinea un valore remoto quando il campo non è stato modificato", () => {
        const view = render(
            <PosInlineStockEditor
                eventId="event-1"
                product={product}
                displayName="Salamella"
                priceLabel="6.00 €"
                variant="modern"
                borderColor="#1d4ed8"
                backgroundColor="#dbeafe"
                onUpdated={vi.fn()}
            />
        )

        view.rerender(
            <PosInlineStockEditor
                eventId="event-1"
                product={{ ...product, stockQuantity: 2 }}
                displayName="Salamella"
                priceLabel="6.00 €"
                variant="modern"
                borderColor="#1d4ed8"
                backgroundColor="#dbeafe"
                onUpdated={vi.fn()}
            />
        )

        expect(within(screen.getByTestId(`stock-product-${product._id}`)).getByRole("spinbutton")).toHaveValue(2)
    })

    test("non sovrascrive un input locale non ancora salvato", () => {
        const props = {
            eventId: "event-1",
            displayName: "Salamella",
            priceLabel: "6.00 €",
            variant: "modern" as const,
            borderColor: "#1d4ed8",
            backgroundColor: "#dbeafe",
            onUpdated: vi.fn(),
        }
        const view = render(<PosInlineStockEditor {...props} product={product} />)
        const input = within(screen.getByTestId(`stock-product-${product._id}`)).getByRole("spinbutton")
        fireEvent.change(input, { target: { value: "9" } })

        view.rerender(<PosInlineStockEditor {...props} product={{ ...product, stockQuantity: 2 }} />)

        expect(input).toHaveValue(9)
    })

    test("mantiene il risultato del salvataggio se arriva un valore remoto mentre il campo è sporco", async () => {
        let resolveAction!: (value: { success: true; product: typeof updatedProduct }) => void
        updatePosStockMock.mockImplementation(() => new Promise((resolve) => {
            resolveAction = resolve
        }))
        const props = {
            eventId: "event-1",
            displayName: "Salamella",
            priceLabel: "6.00 €",
            variant: "modern" as const,
            borderColor: "#1d4ed8",
            backgroundColor: "#dbeafe",
            onUpdated: vi.fn(),
        }
        const view = render(<PosInlineStockEditor {...props} product={product} />)
        const row = within(screen.getByTestId(`stock-product-${product._id}`))
        const input = row.getByRole("spinbutton")

        fireEvent.change(input, { target: { value: "6" } })
        fireEvent.click(row.getByRole("button", { name: /Salva scorta/i }))
        await waitFor(() => expect(input).toBeDisabled())

        view.rerender(<PosInlineStockEditor {...props} product={{ ...product, stockQuantity: 2 }} />)
        expect(input).toHaveValue(6)

        await act(async () => {
            resolveAction({ success: true, product: updatedProduct })
            await Promise.resolve()
        })

        await waitFor(() => expect(input).toHaveValue(7))
        expect(row.getByRole("status")).toHaveTextContent("Scorta Salamella aggiornata a 7")
    })

    test("include il prodotto nel nome accessibile dei controlli variante", () => {
        renderEditor()
        const row = within(screen.getByTestId(`stock-variant-${product._id}-Doppia`))

        expect(row.getByRole("spinbutton", { name: "Scorta Salamella - Doppia" })).toBeVisible()
        expect(row.getByRole("button", { name: "Salva scorta Salamella - Doppia" })).toBeVisible()
    })
})
