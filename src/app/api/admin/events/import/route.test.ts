import { Blob as NodeBlob } from "node:buffer";
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

function buildUpload() {
  const blob = new NodeBlob(["bundle"], { type: "application/gzip" });
  return {
    name: "event.tar.gz",
    size: blob.size,
    stream: () => blob.stream(),
  } as Blob & { name: string };
}

function buildRequest(fields: Record<string, unknown>) {
  const formData = {
    get: (name: string) => fields[name] ?? null,
  } as FormData;

  return {
    formData: async () => formData,
  } as Request;
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
    const response = await POST(buildRequest({ bundleFile: buildUpload() }));

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

    const response = await POST(buildRequest({
      newEventName: "Sagra 2027",
      bundleFile: buildUpload(),
    }));

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
