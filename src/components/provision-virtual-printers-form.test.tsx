import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ProvisionVirtualPrintersForm } from "./provision-virtual-printers-form";

test("shows a provisioning error returned by the server action", async () => {
    const action = vi.fn().mockResolvedValue({ error: "Checkout SumUp in attesa" });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);

    render(<ProvisionVirtualPrintersForm eventId="event-1" action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Provisiona 10 virtuali" }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Checkout SumUp in attesa"));
    expect(action).toHaveBeenCalledWith(expect.any(FormData));
});
