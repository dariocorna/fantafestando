import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { PeripheralDialog } from "@/components/peripheral-dialog";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: refreshMock })
}));

describe("PeripheralDialog", () => {
    test("submits every SumUp Cloud API field when creating a peripheral", async () => {
        const createAction = vi.fn().mockResolvedValue({ success: true });
        render(<PeripheralDialog eventId="event-1" createAction={createAction} />);

        fireEvent.click(screen.getByRole("button", { name: "Nuova Periferica" }));
        const dialog = screen.getByRole("dialog", { name: "Aggiungi Periferica" });

        fireEvent.change(within(dialog).getByLabelText("Nome Descrittivo"), { target: { value: "SumUp Front" } });
        fireEvent.change(within(dialog).getByLabelText("Merchant Code"), { target: { value: "MK10CL2A" } });
        fireEvent.change(within(dialog).getByLabelText("Reader ID"), { target: { value: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65" } });
        fireEvent.change(within(dialog).getByLabelText("API Key"), { target: { value: "sup_sk_api" } });
        fireEvent.change(within(dialog).getByLabelText("Affiliate App ID"), { target: { value: "it.fantafestando.pos" } });
        fireEvent.change(within(dialog).getByLabelText("Affiliate Key"), { target: { value: "affiliate-secret" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "Aggiungi Periferica" }));

        await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
        const formData = createAction.mock.calls[0][0] as FormData;
        expect(formData.get("eventId")).toBe("event-1");
        expect(formData.get("type")).toBe("SUMUP");
        expect(formData.get("merchantCode")).toBe("MK10CL2A");
        expect(formData.get("readerId")).toBe("rdr_3MSAFM23CK82VSTT4BN6RWSQ65");
        expect(formData.get("apiKey")).toBe("sup_sk_api");
        expect(formData.get("affiliateAppId")).toBe("it.fantafestando.pos");
        expect(formData.get("affiliateKey")).toBe("affiliate-secret");
    });

    test("prefills only non-secret values when editing", () => {
        render(
            <PeripheralDialog
                eventId="event-1"
                peripheral={{
                    id: "peripheral-1",
                    name: "SumUp Front",
                    type: "SUMUP",
                    config: {
                        merchantCode: "MK10CL2A",
                        readerId: "rdr_3MSAFM23CK82VSTT4BN6RWSQ65",
                        affiliateAppId: "it.fantafestando.pos"
                    }
                }}
                updateAction={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "Modifica" }));
        const dialog = screen.getByRole("dialog", { name: "Modifica Periferica" });

        expect(within(dialog).getByLabelText("Merchant Code")).toHaveValue("MK10CL2A");
        expect(within(dialog).getByLabelText("Reader ID")).toHaveValue("rdr_3MSAFM23CK82VSTT4BN6RWSQ65");
        expect(within(dialog).getByLabelText("Affiliate App ID")).toHaveValue("it.fantafestando.pos");
        expect(within(dialog).getByLabelText("API Key")).toHaveValue("");
        expect(within(dialog).getByLabelText("Affiliate Key")).toHaveValue("");
    });
});
