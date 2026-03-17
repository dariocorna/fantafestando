import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { MenuCartDeleteDialog } from "@/components/menu-cart-delete-dialog"

describe("MenuCartDeleteDialog", () => {
    test("annulla la rimozione senza chiamare la callback", () => {
        const onConfirm = vi.fn()

        render(
            <MenuCartDeleteDialog
                itemName="Panino"
                quantity={2}
                onConfirm={onConfirm}
            />
        )

        fireEvent.click(screen.getByRole("button", { name: /Elimina Panino dal carrello/i }))

        expect(screen.getByRole("alertdialog")).toBeInTheDocument()
        expect(screen.getByText(/2 x Panino/i)).toBeInTheDocument()

        fireEvent.click(screen.getByRole("button", { name: "Annulla", exact: true }))

        expect(onConfirm).not.toHaveBeenCalled()
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })

    test("conferma la rimozione del prodotto", () => {
        const onConfirm = vi.fn()

        render(
            <MenuCartDeleteDialog
                itemName="Patatine"
                quantity={1}
                onConfirm={onConfirm}
            />
        )

        fireEvent.click(screen.getByRole("button", { name: /Elimina Patatine dal carrello/i }))
        fireEvent.click(screen.getByRole("button", { name: "Elimina", exact: true }))

        expect(onConfirm).toHaveBeenCalledTimes(1)
    })
})
