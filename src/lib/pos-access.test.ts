import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { ensureAuthenticatedSessionMock, getRemoteAccessSettingsViewMock } = vi.hoisted(() => ({
  ensureAuthenticatedSessionMock: vi.fn(),
  getRemoteAccessSettingsViewMock: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ ensureAuthenticatedSession: ensureAuthenticatedSessionMock }));
vi.mock("@/lib/remote-access", () => ({
  getRemoteAccessSettingsView: getRemoteAccessSettingsViewMock,
}));

import { ensurePosAccess, isRemotePosRequest } from "@/lib/pos-access";

function requestHeaders(values: Record<string, string>) {
  const headers = new Headers(values);
  return { get: headers.get.bind(headers) };
}

describe("POS remote request detection", () => {
  const env = {
    REMOTE_POS_HOSTNAME: "pos.example.com",
    REMOTE_POS_MARKER_SECRET: "marker-secret",
  };

  test("recognizes the configured public hostname or trusted marker", () => {
    expect(isRemotePosRequest(
      requestHeaders({ host: "pos.example.com" }),
      { posEnabled: true },
      env
    )).toBe(true);
    expect(isRemotePosRequest(
      requestHeaders({ host: "lan.local", "x-fantafestando-remote-pos": "marker-secret" }),
      { posEnabled: true },
      env
    )).toBe(true);
  });

  test("does not let client headers disable remote authentication", () => {
    expect(isRemotePosRequest(
      requestHeaders({ host: "pos.example.com", "x-fantafestando-remote-pos": "wrong" }),
      { posEnabled: true },
      env
    )).toBe(true);
  });

  test("fails closed when the remote proxy is enabled without complete deployment configuration", () => {
    expect(isRemotePosRequest(requestHeaders({ host: "lan.local" }), { posEnabled: true }, {})).toBe(true);
    expect(isRemotePosRequest(requestHeaders({ host: "lan.local" }), { posEnabled: false }, env)).toBe(false);
  });
});

describe("POS access policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REMOTE_POS_HOSTNAME;
    delete process.env.REMOTE_POS_MARKER_SECRET;
    getRemoteAccessSettingsViewMock.mockResolvedValue({
      posEnabled: false,
      posLanAuthenticationEnabled: false,
    });
  });

  afterEach(() => {
    delete process.env.REMOTE_POS_HOSTNAME;
    delete process.env.REMOTE_POS_MARKER_SECRET;
  });

  test("allows anonymous LAN access only when configured", async () => {
    await expect(ensurePosAccess(requestHeaders({ host: "lan.local" }))).resolves.toMatchObject({
      ok: true,
      user: null,
      authenticationRequired: false,
    });
    expect(ensureAuthenticatedSessionMock).not.toHaveBeenCalled();
  });

  test("requires existing credentials for LAN policy and remote access", async () => {
    ensureAuthenticatedSessionMock.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", username: "admin", role: "ADMIN" },
    });
    getRemoteAccessSettingsViewMock.mockResolvedValue({
      posEnabled: false,
      posLanAuthenticationEnabled: true,
    });
    await expect(ensurePosAccess(requestHeaders({ host: "lan.local" }))).resolves.toMatchObject({
      ok: true,
      authenticationRequired: true,
    });

    process.env.REMOTE_POS_HOSTNAME = "pos.example.com";
    process.env.REMOTE_POS_MARKER_SECRET = "marker-secret";
    getRemoteAccessSettingsViewMock.mockResolvedValue({
      posEnabled: true,
      posLanAuthenticationEnabled: false,
    });
    await expect(ensurePosAccess(requestHeaders({ host: "pos.example.com" }))).resolves.toMatchObject({
      ok: true,
      authenticationRequired: true,
    });
  });
});
