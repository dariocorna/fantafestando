import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("lucide-react", () => ({ Trash2: () => <span /> }));
vi.mock("@/components/ui/alert-dialog", () => {
    const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
    const Action = ({ children, ...props }: ComponentProps<"button">) => <button {...props}>{children}</button>;
    return {
        AlertDialog: Wrapper,
        AlertDialogTrigger: Wrapper,
        AlertDialogContent: Wrapper,
        AlertDialogDescription: Wrapper,
        AlertDialogFooter: Wrapper,
        AlertDialogHeader: Wrapper,
        AlertDialogTitle: Wrapper,
        AlertDialogCancel: Action,
        AlertDialogAction: Action
    };
});

import { DeleteForm } from "@/components/delete-form";

describe("DeleteForm", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    test("shows an action error instead of silently discarding it", async () => {
        const action = vi.fn().mockResolvedValue({ error: "Stampante con coda attiva" });
        const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);

        render(<DeleteForm id="printer-1" message="Eliminare?" action={action} />);
        fireEvent.click(screen.getByRole("button", { name: "Continua" }));

        await waitFor(() => {
            expect(action).toHaveBeenCalledTimes(1);
            expect(alertSpy).toHaveBeenCalledWith("Stampante con coda attiva");
        });
    });
});
