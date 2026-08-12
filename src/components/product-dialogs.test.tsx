import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateProductDialog } from "@/components/create-product-dialog";
import { EditProductDialog } from "@/components/edit-product-dialog";
import type { ProductFormProduct, ProductOption } from "@/components/product-form-dialog";

const categories = [
    { id: "category-main", name: "Piatti" },
    { id: "category-drinks", name: "Bibite" }
];

const ingredients = [
    { id: "ingredient-bread", name: "Pane", shortName: "PANE" },
    { id: "ingredient-cheese", name: "Formaggio" }
];

const products: ProductOption[] = [
    { id: "product-current", name: "Menu corrente", kind: "FIXED_MENU" },
    { id: "product-side", name: "Contorno", kind: "STANDARD" },
    { id: "product-fixed", name: "Altro menu", kind: "FIXED_MENU" }
];

afterEach(() => {
    vi.restoreAllMocks();
});

function openCreateDialog() {
    const trigger = screen.getByRole("button", { name: /Nuovo Prodotto/i });
    expect(trigger).toHaveAttribute("id", "new-product-btn");
    fireEvent.click(trigger);
    return screen.getByRole("dialog", { name: "Aggiungi Prodotto" });
}

function openEditDialog() {
    fireEvent.click(screen.getByRole("button", { name: "Modifica" }));
    return screen.getByRole("dialog", { name: "Modifica Prodotto" });
}

describe("product dialogs", () => {
    it("serializes create fields, exposes pending state, closes and resets after success", async () => {
        let resolveAction: ((value: { success: boolean }) => void) | undefined;
        const createAction = vi.fn((_formData: FormData) => new Promise<{ success: boolean }>((resolve) => {
            void _formData;
            resolveAction = resolve;
        }));

        render(
            <CreateProductDialog
                eventId="event-create"
                categories={categories}
                products={products}
                ingredients={ingredients}
                createAction={createAction}
            />
        );

        const dialog = openCreateDialog();
        expect(dialog.querySelector("#product-kind")).toBeInTheDocument();
        expect(dialog.querySelector("#prod-name")).toBeInTheDocument();
        expect(dialog.querySelector("#prod-short-name")).toBeInTheDocument();
        expect(dialog.querySelector("#prod-description")).toBeInTheDocument();
        expect(dialog.querySelector("#prod-stock-quantity")).toBeInTheDocument();

        fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Panino" } });
        fireEvent.change(within(dialog).getByLabelText(/Etichetta breve POS\/Scontrino/i), { target: { value: "PANINO" } });
        fireEvent.change(within(dialog).getByLabelText(/Descrizione Menu/i), { target: { value: "Pane e formaggio" } });
        fireEvent.change(within(dialog).getByLabelText("Prezzo Base (€)"), { target: { value: "7.50" } });
        fireEvent.change(within(dialog).getByLabelText("Prezzo volontari (€)"), { target: { value: "4.00" } });
        fireEvent.change(within(dialog).getByLabelText("Scorte"), { target: { value: "12" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "MER" }));
        fireEvent.click(within(dialog).getByLabelText("Visibile nell'app utente"));
        fireEvent.click(within(dialog).getByLabelText("Stampa comanda separata per unità"));
        fireEvent.click(within(dialog).getByRole("button", { name: "Aggiungi ingrediente" }));
        fireEvent.change(within(dialog).getByLabelText("Ingrediente ricetta 1"), {
            target: { value: "ingredient-cheese" }
        });
        fireEvent.change(within(dialog).getByLabelText("Quantità ingrediente ricetta 1"), {
            target: { value: "2" }
        });

        fireEvent.click(within(dialog).getByRole("button", { name: "Salva Prodotto" }));

        await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
        await waitFor(() => {
            expect(within(dialog).getByRole("button", { name: "Salvataggio..." })).toBeDisabled();
        });

        const formData = createAction.mock.calls[0][0];
        expect(formData.get("eventId")).toBe("event-create");
        expect(formData.get("id")).toBeNull();
        expect(formData.get("name")).toBe("Panino");
        expect(formData.get("shortName")).toBe("PANINO");
        expect(formData.get("description")).toBe("Pane e formaggio");
        expect(formData.get("categoryId")).toBe("category-main");
        expect(formData.get("basePrice")).toBe("7.50");
        expect(formData.get("volunteerPrice")).toBe("4.00");
        expect(formData.get("stockQuantity")).toBe("12");
        expect(formData.get("availableDays")).toBe("WED");
        expect(formData.get("kind")).toBe("STANDARD");
        expect(formData.getAll("salesChannels")).toEqual(["POS"]);
        expect(formData.get("availableOnlyInMenus")).toBeNull();
        expect(formData.get("splitKitchenPrintPerUnit")).toBe("on");
        expect(formData.get("menuComponentsJson")).toBe("[]");
        expect(formData.get("menuChoiceGroupsJson")).toBe("[]");
        expect(formData.get("recipeItemsJson")).toBe(JSON.stringify([
            { ingredientId: "ingredient-cheese", quantity: 2 }
        ]));

        expect(resolveAction).toBeDefined();
        await act(async () => {
            resolveAction?.({ success: true });
        });
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Aggiungi Prodotto" })).not.toBeInTheDocument());

        const resetDialog = openCreateDialog();
        expect(within(resetDialog).getByLabelText("Nome")).toHaveValue("");
        expect(within(resetDialog).getByLabelText("Tipo prodotto")).toHaveValue("STANDARD");
        expect(within(resetDialog).getByLabelText("Visibile nel POS")).toBeChecked();
        expect(within(resetDialog).getByLabelText("Visibile nell'app utente")).toBeChecked();
        expect(within(resetDialog).getByLabelText("Stampa comanda separata per unità")).not.toBeChecked();
        expect(within(resetDialog).getByText("Sempre")).toBeInTheDocument();
        expect(within(resetDialog).queryByLabelText("Ingrediente ricetta 1")).not.toBeInTheDocument();
    });

    it("initializes and serializes fixed-menu edits while keeping action errors open", async () => {
        const product: ProductFormProduct = {
            id: "product-current",
            name: "Menu corrente",
            shortName: "MENU",
            description: "Menu completo",
            categoryId: "category-drinks",
            basePrice: 20,
            volunteerPrice: 12,
            stockQuantity: 8,
            availableDays: ["FRI", "MON"],
            kind: "FIXED_MENU",
            salesChannels: ["MENU"],
            menuComponents: [{ productId: "product-side", quantity: 2 }],
            menuChoiceGroups: [{
                id: "group-existing",
                name: "Bibita",
                minSelections: 0,
                maxSelections: 1,
                options: [{ productId: "product-side", quantity: 1 }]
            }]
        };
        const updateAction = vi.fn()
            .mockResolvedValueOnce({ error: "Nome già utilizzato" })
            .mockResolvedValueOnce({ success: true });

        render(
            <EditProductDialog
                product={product}
                eventId="event-edit"
                categories={categories}
                products={products}
                ingredients={ingredients}
                updateAction={updateAction}
            />
        );

        const dialog = openEditDialog();
        expect(dialog.querySelector("#product-kind-edit")).toBeInTheDocument();
        expect(dialog.querySelector("#prod-edit-name")).toBeInTheDocument();
        expect(dialog.querySelector("#prod-edit-short-name")).toBeInTheDocument();
        expect(dialog.querySelector("#prod-edit-description")).toBeInTheDocument();
        expect(dialog.querySelector("#prod-edit-stock-quantity")).toBeInTheDocument();
        expect(within(dialog).getByLabelText("Tipo prodotto")).toHaveValue("FIXED_MENU");
        expect(within(dialog).getByLabelText("Categoria")).toHaveValue("category-drinks");
        expect(within(dialog).getByLabelText("Nome")).toHaveValue("Menu corrente");
        expect(within(dialog).getByLabelText("Visibile nel POS")).not.toBeChecked();
        expect(within(dialog).getByLabelText("Visibile nell'app utente")).toBeChecked();
        expect(within(dialog).getByText("2/7")).toBeInTheDocument();
        expect(dialog.querySelector("#menu-choice-group-name-edit-group-existing")).toHaveValue("Bibita");

        const componentSelectors = Array.from(dialog.querySelectorAll("select")).filter((select) => (
            Array.from(select.options).some((option) => option.text === "Contorno")
        ));
        expect(componentSelectors).toHaveLength(2);
        for (const select of componentSelectors) {
            const labels = Array.from(select.options).map((option) => option.text);
            expect(labels).toContain("Contorno");
            expect(labels).not.toContain("Menu corrente");
            expect(labels).not.toContain("Altro menu");
        }

        fireEvent.click(await within(dialog).findByRole("button", { name: "Salva Modifiche" }));
        await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(1));
        expect(await within(dialog).findByRole("alert")).toHaveTextContent("Nome già utilizzato");
        expect(screen.getByRole("dialog", { name: "Modifica Prodotto" })).toBeInTheDocument();

        const formData = updateAction.mock.calls[0][0] as FormData;
        expect(formData.get("id")).toBe("product-current");
        expect(formData.get("eventId")).toBe("event-edit");
        expect(formData.get("availableDays")).toBe("MON,FRI");
        expect(formData.get("kind")).toBe("FIXED_MENU");
        expect(formData.getAll("salesChannels")).toEqual(["MENU"]);
        expect(formData.get("menuComponentsJson")).toBe(JSON.stringify([
            { productId: "product-side", quantity: 2 }
        ]));
        expect(formData.get("menuChoiceGroupsJson")).toBe(JSON.stringify([{
            id: "group-existing",
            name: "Bibita",
            minSelections: 0,
            maxSelections: 1,
            options: [{ productId: "product-side", quantity: 1 }]
        }]));
        expect(formData.get("recipeItemsJson")).toBe("[]");

        fireEvent.click(await within(dialog).findByRole("button", { name: "Salva Modifiche" }));
        await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Modifica Prodotto" })).not.toBeInTheDocument());
    });

    it("reinitializes edit state from the latest product every time it opens", async () => {
        const firstProduct: ProductFormProduct = {
            id: "product-a",
            name: "Prodotto A",
            categoryId: "category-main",
            basePrice: 6,
            availableDays: ["TUE"],
            kind: "STANDARD",
            availableOnlyInMenus: true,
            splitKitchenPrintPerUnit: true,
            salesChannels: ["POS"],
            recipeItems: [{ ingredientId: "ingredient-bread", quantity: 1 }]
        };
        const secondProduct: ProductFormProduct = {
            id: "product-b",
            name: "Prodotto B",
            categoryId: "category-drinks",
            basePrice: 9,
            availableDays: ["FRI", "MON"],
            kind: "STANDARD",
            availableOnlyInMenus: false,
            splitKitchenPrintPerUnit: false,
            salesChannels: ["MENU"],
            recipeItems: [{ ingredientId: "ingredient-cheese", quantity: 3 }]
        };
        const updateAction = vi.fn().mockResolvedValue({ success: true });
        const view = render(
            <EditProductDialog
                product={firstProduct}
                categories={categories}
                products={products}
                ingredients={ingredients}
                updateAction={updateAction}
            />
        );

        const firstDialog = openEditDialog();
        expect(within(firstDialog).getByLabelText("Tipo prodotto")).toHaveValue("STANDARD");
        expect(within(firstDialog).getByLabelText("Vendibile solo nei menu")).toBeChecked();
        expect(within(firstDialog).getByLabelText("Stampa comanda separata per unità")).toBeChecked();
        expect(within(firstDialog).getByLabelText("Ingrediente ricetta 1")).toHaveValue("ingredient-bread");

        fireEvent.change(within(firstDialog).getByLabelText("Tipo prodotto"), {
            target: { value: "FIXED_MENU" }
        });
        expect(within(firstDialog).queryByText("Ricetta ingredienti")).not.toBeInTheDocument();
        fireEvent.click(within(firstDialog).getByRole("button", { name: "Close" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Modifica Prodotto" })).not.toBeInTheDocument());

        view.rerender(
            <EditProductDialog
                product={secondProduct}
                categories={categories}
                products={products}
                ingredients={ingredients}
                updateAction={updateAction}
            />
        );

        const secondDialog = openEditDialog();
        expect(within(secondDialog).getByLabelText("Tipo prodotto")).toHaveValue("STANDARD");
        expect(within(secondDialog).getByLabelText("Nome")).toHaveValue("Prodotto B");
        expect(within(secondDialog).getByLabelText("Categoria")).toHaveValue("category-drinks");
        expect(within(secondDialog).getByText("2/7")).toBeInTheDocument();
        expect(within(secondDialog).getByLabelText("Visibile nel POS")).not.toBeChecked();
        expect(within(secondDialog).getByLabelText("Visibile nell'app utente")).toBeChecked();
        expect(within(secondDialog).getByLabelText("Vendibile solo nei menu")).not.toBeChecked();
        expect(within(secondDialog).getByLabelText("Stampa comanda separata per unità")).not.toBeChecked();
        expect(within(secondDialog).getByLabelText("Ingrediente ricetta 1")).toHaveValue("ingredient-cheese");
        expect(within(secondDialog).getByLabelText("Quantità ingrediente ricetta 1")).toHaveValue(3);
    });

    it("keeps each dialog open and shows its mode-specific fallback when the action throws", async () => {
        const error = new Error("offline");
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const createAction = vi.fn().mockRejectedValue(error);
        const createView = render(
            <CreateProductDialog
                eventId="event-create"
                categories={categories}
                products={products}
                ingredients={ingredients}
                createAction={createAction}
            />
        );

        const createDialog = openCreateDialog();
        fireEvent.change(within(createDialog).getByLabelText("Nome"), { target: { value: "Panino" } });
        fireEvent.change(within(createDialog).getByLabelText("Prezzo Base (€)"), { target: { value: "7" } });
        fireEvent.click(within(createDialog).getByRole("button", { name: "Salva Prodotto" }));
        expect(await within(createDialog).findByRole("alert")).toHaveTextContent(
            "Salvataggio non riuscito. Verifica connessione e riprova."
        );
        expect(screen.getByRole("dialog", { name: "Aggiungi Prodotto" })).toBeInTheDocument();
        expect(consoleError).toHaveBeenCalledWith("Errore durante il salvataggio prodotto", error);

        createView.unmount();
        const updateAction = vi.fn().mockRejectedValue(error);
        render(
            <EditProductDialog
                product={{
                    id: "product-current",
                    name: "Menu corrente",
                    categoryId: "category-main",
                    basePrice: 20
                }}
                categories={categories}
                products={products}
                ingredients={ingredients}
                updateAction={updateAction}
            />
        );

        const editDialog = openEditDialog();
        fireEvent.click(within(editDialog).getByRole("button", { name: "Salva Modifiche" }));
        expect(await within(editDialog).findByRole("alert")).toHaveTextContent(
            "Aggiornamento non riuscito. Verifica connessione e riprova."
        );
        expect(screen.getByRole("dialog", { name: "Modifica Prodotto" })).toBeInTheDocument();
        expect(consoleError).toHaveBeenCalledWith("Errore durante l'aggiornamento prodotto", error);
    });
});
