import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { ensureAuthenticatedSessionMock, getRemoteAccessSettingsViewMock } = vi.hoisted(() => ({
  ensureAuthenticatedSessionMock: vi.fn(),
  getRemoteAccessSettingsViewMock: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ ensureAuthenticatedSession: ensureAuthenticatedSessionMock }));
vi.mock("@/lib/remote-access", () => ({
  getRemoteAccessSettingsView: getRemoteAccessSettingsViewMock,
}));

import { ensurePosAccess, isTrustedLanPosRequest } from "@/lib/pos-access";

function requestHeaders(values: Record<string, string>) {
  const headers = new Headers(values);
  return { get: headers.get.bind(headers) };
}

describe("POS LAN trust", () => {
  const env = {
    REMOTE_POS_HOSTNAME: "pos.example.com",
    REMOTE_POS_MARKER_SECRET: "marker-secret",
    POS_LAN_HOSTNAMES: "pos.lan,192.168.1.10",
  };

  test("trusts only the configured LAN hostnames", () => {
    expect(isTrustedLanPosRequest(requestHeaders({ host: "pos.lan" }), { posEnabled: true }, env)).toBe(true);
    expect(isTrustedLanPosRequest(requestHeaders({ host: "192.168.1.10:3101" }), { posEnabled: true }, env)).toBe(true);
  });

  test("never trusts an unrecognized hostname", () => {
    expect(isTrustedLanPosRequest(requestHeaders({ host: "admin.example.com" }), { posEnabled: true }, env)).toBe(false);
    expect(isTrustedLanPosRequest(requestHeaders({ host: "attacker-controlled" }), { posEnabled: true }, env)).toBe(false);
    expect(isTrustedLanPosRequest(requestHeaders({}), { posEnabled: true }, env)).toBe(false);
  });

  test("never trusts the public POS hostname or the proxy marker", () => {
    expect(isTrustedLanPosRequest(requestHeaders({ host: "pos.example.com" }), { posEnabled: true }, env)).toBe(false);
    expect(isTrustedLanPosRequest(
      requestHeaders({ host: "pos.lan", "x-fantafestando-remote-pos": "marker-secret" }),
      { posEnabled: true },
      env
    )).toBe(false);
  });

  test("prefers the forwarded hostname over the internal Host header", () => {
    expect(isTrustedLanPosRequest(
      requestHeaders({ host: "pos.lan", "x-forwarded-host": "admin.example.com" }),
      { posEnabled: true },
      env
    )).toBe(false);
  });

  test("without a LAN allow-list, trust ends as soon as the backoffice is published", () => {
    const bare = { REMOTE_POS_HOSTNAME: "pos.example.com", REMOTE_POS_MARKER_SECRET: "marker-secret" };
    expect(isTrustedLanPosRequest(requestHeaders({ host: "lan.local" }), {}, bare)).toBe(true);
    expect(isTrustedLanPosRequest(requestHeaders({ host: "lan.local" }), { posEnabled: true }, bare)).toBe(false);
    expect(isTrustedLanPosRequest(requestHeaders({ host: "lan.local" }), { adminEnabled: true }, bare)).toBe(false);
    expect(isTrustedLanPosRequest(requestHeaders({ host: "lan.local" }), { appliedPosEnabled: true }, bare)).toBe(false);
  });
});

describe("POS access policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REMOTE_POS_HOSTNAME;
    delete process.env.REMOTE_POS_MARKER_SECRET;
    delete process.env.POS_LAN_HOSTNAMES;
    getRemoteAccessSettingsViewMock.mockResolvedValue({
      posEnabled: false,
      adminEnabled: false,
      posLanAuthenticationEnabled: false,
    });
  });

  afterEach(() => {
    delete process.env.REMOTE_POS_HOSTNAME;
    delete process.env.REMOTE_POS_MARKER_SECRET;
    delete process.env.POS_LAN_HOSTNAMES;
  });

  test("allows anonymous LAN access only when nothing is published", async () => {
    await expect(ensurePosAccess(requestHeaders({ host: "lan.local" }))).resolves.toMatchObject({
      ok: true,
      user: null,
      authenticationRequired: false,
    });
    expect(ensureAuthenticatedSessionMock).not.toHaveBeenCalled();
  });

  test("requires credentials for LAN policy, public hostnames and unknown hosts", async () => {
    ensureAuthenticatedSessionMock.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", username: "admin", role: "ADMIN" },
    });
    getRemoteAccessSettingsViewMock.mockResolvedValue({
      posEnabled: false,
      adminEnabled: false,
      posLanAuthenticationEnabled: true,
    });
    await expect(ensurePosAccess(requestHeaders({ host: "lan.local" }))).resolves.toMatchObject({
      ok: true,
      authenticationRequired: true,
    });

    process.env.REMOTE_POS_HOSTNAME = "pos.example.com";
    process.env.REMOTE_POS_MARKER_SECRET = "marker-secret";
    process.env.POS_LAN_HOSTNAMES = "pos.lan";
    getRemoteAccessSettingsViewMock.mockResolvedValue({
      posEnabled: true,
      adminEnabled: true,
      posLanAuthenticationEnabled: false,
    });
    await expect(ensurePosAccess(requestHeaders({ host: "pos.example.com" }))).resolves.toMatchObject({
      ok: true,
      authenticationRequired: true,
    });
    // Regression: the admin hostname reaches the same container as the POS.
    await expect(ensurePosAccess(requestHeaders({ host: "admin.example.com" }))).resolves.toMatchObject({
      ok: true,
      authenticationRequired: true,
    });
  });
});
