import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  ensureAdminSessionMock,
  adminUnauthorizedJsonMock,
  importEventTransferBundleMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  ensureAdminSessionMock: vi.fn(),
  adminUnauthorizedJsonMock: vi.fn(),
  importEventTransferBundleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  ensureAdminSession: ensureAdminSessionMock,
  adminUnauthorizedJson: adminUnauthorizedJsonMock,
}));

vi.mock("@/lib/event-transfer", () => ({
  importEventTransferBundle: importEventTransferBundleMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import { POST } from "@/app/api/admin/events/import/route";

function buildRequest(formData: FormData) {
  return new Request("http://localhost/api/admin/events/import", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/admin/events/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureAdminSessionMock.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", username: "admin", role: "ADMIN" },
    });
    adminUnauthorizedJsonMock.mockImplementation((sessionCheck) =>
      Response.json({ error: sessionCheck.error }, { status: sessionCheck.status })
    );
  });

  test("rejects requests without a new event name", async () => {
    const formData = new FormData();
    formData.set("bundleFile", new File(["bundle"], "event.tar.gz", { type: "application/gzip" }));

    const response = await POST(buildRequest(formData));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/nome nuova festa obbligatorio/i),
    });
    expect(importEventTransferBundleMock).not.toHaveBeenCalled();
  });

  test("imports a valid bundle and revalidates admin pages", async () => {
    importEventTransferBundleMock.mockResolvedValue({
      newEventId: "event-2",
      newEventName: "Sagra 2027",
      imported: {
        printers: 2,
        peripherals: 1,
        categories: 4,
        products: 12,
        posDevices: 1,
      },
    });

    const formData = new FormData();
    formData.set("newEventName", "Sagra 2027");
    formData.set("bundleFile", new File(["bundle"], "event.tar.gz", { type: "application/gzip" }));

    const response = await POST(buildRequest(formData));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        newEventId: "event-2",
        newEventName: "Sagra 2027",
        imported: {
          products: 12,
        },
      },
    });
    expect(importEventTransferBundleMock).toHaveBeenCalledWith(expect.any(String), "Sagra 2027");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin", "layout");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/settings");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/settings/events");
  });
});
