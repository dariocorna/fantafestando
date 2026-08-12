import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ImportEventDialog } from "@/components/import-event-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("ImportEventDialog", () => {
  test("keeps the trigger disabled in server-rendered markup", () => {
    const html = renderToString(<ImportEventDialog importUrl="/api/admin/events/import" />);

    expect(html).toContain("disabled");
    expect(html).toContain("Importa Festa");
  });

  test("enables the trigger after client hydration", () => {
    render(<ImportEventDialog importUrl="/api/admin/events/import" />);

    expect(screen.getByRole("button", { name: /Importa Festa/i })).toBeEnabled();
  });
});
