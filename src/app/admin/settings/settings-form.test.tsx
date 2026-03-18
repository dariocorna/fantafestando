import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveEventSettingsForm } from "./settings-form";

const { updateEventSettingsActionMock } = vi.hoisted(() => ({
    updateEventSettingsActionMock: vi.fn()
}));

vi.mock("./actions", () => ({
    updateEventSettingsAction: updateEventSettingsActionMock
}));

afterEach(() => {
    updateEventSettingsActionMock.mockReset();
});

describe("ActiveEventSettingsForm", () => {
    it("keeps the saved feedback visible when the same event refreshes after submit", async () => {
        updateEventSettingsActionMock.mockResolvedValue({
            success: true,
            menuHeaderLogoUrl: "",
            receiptHeaderLogoUrl: ""
        });

        const event = {
            _id: "event-save",
            active: true,
            predefinedTables: [],
            settings: {
                askName: false,
                askTable: false,
                portalEasterEggEnabled: false,
                posCatalogLayout: "COMPACT_COLUMNS" as const,
                menuHeaderLogoUrl: "",
                receiptHeaderLogoUrl: "",
                quickDiscountPresets: []
            }
        };

        const { rerender } = render(<ActiveEventSettingsForm event={event} />);

        fireEvent.change(screen.getByLabelText(/Layout Catalogo POS/i), {
            target: { value: "MODERN_TABS" }
        });
        fireEvent.click(screen.getByRole("button", { name: /Salva Impostazioni/i }));

        await waitFor(() => {
            expect(updateEventSettingsActionMock).toHaveBeenCalledTimes(1);
            expect(screen.getByText(/Modifiche salvate/i)).toBeInTheDocument();
        });

        rerender(<ActiveEventSettingsForm event={{
            ...event,
            settings: {
                ...event.settings,
                posCatalogLayout: "MODERN_TABS"
            }
        }} />);

        await waitFor(() => {
            expect(screen.getByText(/Modifiche salvate/i)).toBeInTheDocument();
            expect(screen.getByLabelText(/Layout Catalogo POS/i)).toHaveValue("MODERN_TABS");
        });
    });

    it("resets the visible settings when the admin switches event context", async () => {
        const firstEvent = {
            _id: "event-a",
            active: true,
            predefinedTables: ["A01", "A02"],
            settings: {
                askName: true,
                askTable: false,
                portalEasterEggEnabled: true,
                posCatalogLayout: "MODERN_TABS" as const,
                menuHeaderLogoUrl: "/uploads/menu-headers/event-a.jpg",
                receiptHeaderLogoUrl: "/uploads/receipt-headers/event-a.png",
                quickDiscountPresets: [
                    { label: "Staff", type: "PERCENT" as const, value: 50 }
                ]
            }
        };
        const secondEvent = {
            _id: "event-b",
            active: false,
            predefinedTables: ["VIP", "B12"],
            settings: {
                askName: false,
                askTable: true,
                portalEasterEggEnabled: false,
                posCatalogLayout: "COMPACT_COLUMNS" as const,
                menuHeaderLogoUrl: "/uploads/menu-headers/event-b.png",
                receiptHeaderLogoUrl: "",
                quickDiscountPresets: [
                    { label: "Promo", type: "FIXED" as const, value: 2 }
                ]
            }
        };

        const { rerender } = render(<ActiveEventSettingsForm event={firstEvent} />);

        expect(screen.getByLabelText(/Festa Attiva/i)).toBeChecked();
        expect(screen.getByLabelText(/Chiedi Nome Cliente/i)).toBeChecked();
        expect(screen.getByLabelText(/Chiedi Numero Tavolo/i)).not.toBeChecked();
        expect(screen.getByLabelText(/Layout Catalogo POS/i)).toHaveValue("MODERN_TABS");
        expect(screen.getByAltText(/Anteprima logo header menu/i)).toHaveAttribute("src", "/uploads/menu-headers/event-a.jpg");
        expect(screen.getByAltText(/Anteprima header scontrino/i)).toHaveAttribute("src", "/uploads/receipt-headers/event-a.png");
        expect(screen.getByText("/uploads/menu-headers/event-a.jpg")).toBeInTheDocument();
        expect(screen.getByText("A01")).toBeInTheDocument();
        expect(screen.getByDisplayValue("Staff")).toBeInTheDocument();

        rerender(<ActiveEventSettingsForm event={secondEvent} />);

        await waitFor(() => {
            expect(screen.getByLabelText(/Festa Attiva/i)).not.toBeChecked();
            expect(screen.getByLabelText(/Chiedi Nome Cliente/i)).not.toBeChecked();
            expect(screen.getByLabelText(/Chiedi Numero Tavolo/i)).toBeChecked();
            expect(screen.getByLabelText(/Layout Catalogo POS/i)).toHaveValue("COMPACT_COLUMNS");
            expect(screen.getByAltText(/Anteprima logo header menu/i)).toHaveAttribute("src", "/uploads/menu-headers/event-b.png");
        });

        expect(screen.queryByAltText(/Anteprima header scontrino/i)).not.toBeInTheDocument();
        expect(screen.getByText("/uploads/menu-headers/event-b.png")).toBeInTheDocument();
        expect(screen.queryByText("/uploads/receipt-headers/event-a.png")).not.toBeInTheDocument();
        expect(screen.queryByText("A01")).not.toBeInTheDocument();
        expect(screen.getByText("VIP")).toBeInTheDocument();
        expect(screen.queryByDisplayValue("Staff")).not.toBeInTheDocument();
        expect(screen.getByDisplayValue("Promo")).toBeInTheDocument();
    });

    it("ignores a stale save response after switching event context", async () => {
        let resolveAction: ((value: { success: boolean; menuHeaderLogoUrl: string; receiptHeaderLogoUrl: string }) => void) | null = null;

        updateEventSettingsActionMock.mockImplementation(() => new Promise((resolve) => {
            resolveAction = resolve;
        }));

        const firstEvent = {
            _id: "event-a",
            active: true,
            predefinedTables: [],
            settings: {
                askName: false,
                askTable: false,
                portalEasterEggEnabled: false,
                posCatalogLayout: "MODERN_TABS" as const,
                menuHeaderLogoUrl: "/uploads/menu-headers/event-a.png",
                receiptHeaderLogoUrl: "/uploads/receipt-headers/event-a.png",
                quickDiscountPresets: []
            }
        };
        const secondEvent = {
            _id: "event-b",
            active: false,
            predefinedTables: [],
            settings: {
                askName: true,
                askTable: true,
                portalEasterEggEnabled: false,
                posCatalogLayout: "COMPACT_COLUMNS" as const,
                menuHeaderLogoUrl: "/uploads/menu-headers/event-b.png",
                receiptHeaderLogoUrl: "/uploads/receipt-headers/event-b.png",
                quickDiscountPresets: []
            }
        };

        const { rerender } = render(<ActiveEventSettingsForm event={firstEvent} />);

        fireEvent.click(screen.getByRole("button", { name: /Salva Impostazioni/i }));

        await waitFor(() => {
            expect(updateEventSettingsActionMock).toHaveBeenCalledTimes(1);
        });

        rerender(<ActiveEventSettingsForm event={secondEvent} />);

        await waitFor(() => {
            expect(screen.getByLabelText(/Layout Catalogo POS/i)).toHaveValue("COMPACT_COLUMNS");
            expect(screen.getByText("/uploads/menu-headers/event-b.png")).toBeInTheDocument();
        });

        expect(resolveAction).not.toBeNull();
        await act(async () => {
            resolveAction?.({
                success: true,
                menuHeaderLogoUrl: "/uploads/menu-headers/saved-a.png",
                receiptHeaderLogoUrl: "/uploads/receipt-headers/saved-a.png"
            });
        });

        expect(screen.getByLabelText(/Layout Catalogo POS/i)).toHaveValue("COMPACT_COLUMNS");
        expect(screen.getByText("/uploads/menu-headers/event-b.png")).toBeInTheDocument();
        expect(screen.getByText("/uploads/receipt-headers/event-b.png")).toBeInTheDocument();
        expect(screen.queryByText("/uploads/menu-headers/saved-a.png")).not.toBeInTheDocument();
        expect(screen.queryByText("/uploads/receipt-headers/saved-a.png")).not.toBeInTheDocument();
        expect(screen.queryByText(/Modifiche salvate/i)).not.toBeInTheDocument();
    });
});
