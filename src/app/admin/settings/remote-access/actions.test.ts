import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  ensureAdminSessionMock,
  dbConnectMock,
  findOneAndUpdateMock,
  getRemoteAccessSettingsViewMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  ensureAdminSessionMock: vi.fn(),
  dbConnectMock: vi.fn(),
  findOneAndUpdateMock: vi.fn(),
  getRemoteAccessSettingsViewMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ ensureAdminSession: ensureAdminSessionMock }));
vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }));
vi.mock("@/models/SystemSettings", () => ({
  default: { findOneAndUpdate: findOneAndUpdateMock },
}));
vi.mock("@/lib/remote-access", () => ({
  getRemoteAccessSettingsView: getRemoteAccessSettingsViewMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { saveRemoteAccessSettingsAction } from "./actions";

describe("saveRemoteAccessSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureAdminSessionMock.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", username: "admin", role: "ADMIN" },
    });
    getRemoteAccessSettingsViewMock.mockResolvedValue({ menuEnabled: true });
  });

  test("requires an administrator", async () => {
    ensureAdminSessionMock.mockResolvedValue({ ok: false, error: "Accesso negato", status: 403 });
    await expect(saveRemoteAccessSettingsAction(new FormData())).resolves.toEqual({ error: "Accesso negato" });
    expect(findOneAndUpdateMock).not.toHaveBeenCalled();
  });

  test("persists only fixed boolean controls", async () => {
    const formData = new FormData();
    formData.set("menuEnabled", "on");
    formData.set("posEnabled", "on");
    formData.set("posLanAuthenticationEnabled", "on");
    formData.set("remotePort", "9999");

    await saveRemoteAccessSettingsAction(formData);

    const update = findOneAndUpdateMock.mock.calls[0][1];
    expect(update.$set).toMatchObject({
      "remoteAccess.menuEnabled": true,
      "remoteAccess.adminEnabled": false,
      "remoteAccess.posEnabled": true,
      "remoteAccess.sshEnabled": false,
      "remoteAccess.posLanAuthenticationEnabled": true,
      "remoteAccess.requestedBy": "admin",
    });
    expect(JSON.stringify(update)).not.toContain("9999");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/settings/remote-access");
  });
});
