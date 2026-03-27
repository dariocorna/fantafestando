import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, redirectMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
    redirectMock: vi.fn()
}));

vi.mock("@/auth", () => ({
    auth: authMock
}));

vi.mock("next/navigation", () => ({
    redirect: redirectMock
}));

import {
    ensureAuthenticatedSession,
    adminUnauthorizedJson,
    ensureAdminSession,
    getCurrentSessionUser,
    requireAdminPageSession,
    requireAuthenticatedPageSession
} from "@/lib/authz";

describe("authz helpers", () => {
    beforeEach(() => {
        authMock.mockReset();
        redirectMock.mockReset();
    });

    it("returns null when session is missing", async () => {
        authMock.mockResolvedValue(null);

        await expect(getCurrentSessionUser()).resolves.toBeNull();
    });

    it("normalizes non-admin role as CASHIER", async () => {
        authMock.mockResolvedValue({
            user: { id: "cashier-id", username: "cashier", role: "OTHER" }
        });

        await expect(getCurrentSessionUser()).resolves.toEqual({
            id: "cashier-id",
            username: "cashier",
            role: "CASHIER"
        });
    });

    it("returns 401 when no authenticated user is present", async () => {
        authMock.mockResolvedValue(null);

        await expect(ensureAuthenticatedSession()).resolves.toEqual({
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        });
        await expect(ensureAdminSession()).resolves.toEqual({
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        });
    });

    it("returns 403 when authenticated user is not admin", async () => {
        authMock.mockResolvedValue({
            user: { id: "cashier-id", username: "cashier", role: "CASHIER" }
        });

        await expect(ensureAdminSession()).resolves.toEqual({
            ok: false,
            status: 403,
            error: "Accesso riservato agli amministratori"
        });
    });

    it("returns admin session data when role is ADMIN", async () => {
        authMock.mockResolvedValue({
            user: { id: "admin-id", username: "admin", role: "ADMIN" }
        });

        await expect(ensureAuthenticatedSession()).resolves.toEqual({
            ok: true,
            user: { id: "admin-id", username: "admin", role: "ADMIN" }
        });
        await expect(ensureAdminSession()).resolves.toEqual({
            ok: true,
            user: { id: "admin-id", username: "admin", role: "ADMIN" }
        });
    });

    it("returns current admin user without redirect when authorized", async () => {
        authMock.mockResolvedValue({
            user: { id: "admin-id", username: "admin", role: "ADMIN" }
        });

        await expect(requireAdminPageSession()).resolves.toEqual({
            id: "admin-id",
            username: "admin",
            role: "ADMIN"
        });
        expect(redirectMock).not.toHaveBeenCalled();
    });

    it("redirects to /login when admin page access is unauthenticated", async () => {
        authMock.mockResolvedValue(null);

        await expect(requireAdminPageSession()).rejects.toThrow("Redirect non riuscito");
        expect(redirectMock).toHaveBeenCalledWith("/login");
    });

    it("redirects to /pos when admin page access is forbidden", async () => {
        authMock.mockResolvedValue({
            user: { id: "cashier-id", username: "cashier", role: "CASHIER" }
        });

        await expect(requireAdminPageSession()).rejects.toThrow("Redirect non riuscito");
        expect(redirectMock).toHaveBeenCalledWith("/pos");
    });

    it("returns current cashier user without redirect for authenticated staff pages", async () => {
        authMock.mockResolvedValue({
            user: { id: "cashier-id", username: "cashier", role: "CASHIER" }
        });

        await expect(requireAuthenticatedPageSession()).resolves.toEqual({
            id: "cashier-id",
            username: "cashier",
            role: "CASHIER"
        });
        expect(redirectMock).not.toHaveBeenCalled();
    });

    it("redirects to /login when authenticated staff page access is unauthenticated", async () => {
        authMock.mockResolvedValue(null);

        await expect(requireAuthenticatedPageSession()).rejects.toThrow("Redirect non riuscito");
        expect(redirectMock).toHaveBeenCalledWith("/login");
    });

    it("creates unauthorized json response with expected status", async () => {
        const response = adminUnauthorizedJson({
            ok: false,
            status: 403,
            error: "Accesso riservato agli amministratori"
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: "Accesso riservato agli amministratori"
        });
    });
});
