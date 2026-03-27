import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";

export interface SessionUser {
    id: string;
    username: string;
    role: "ADMIN" | "CASHIER";
}

export type AdminSessionCheck =
    | { ok: true; user: SessionUser }
    | { ok: false; status: 401 | 403; error: string };
export type AuthenticatedSessionCheck =
    | { ok: true; user: SessionUser }
    | { ok: false; status: 401; error: string };

function resolveSessionUser(session: Session | null): SessionUser | null {
    const user = session?.user;
    if (!user || !user.id || !user.username) return null;

    const role = user.role === "ADMIN" ? "ADMIN" : "CASHIER";
    return {
        id: user.id,
        username: user.username,
        role
    };
}

export async function getCurrentSessionUser(): Promise<SessionUser | null> {
    const session = await auth() as Session | null;
    return resolveSessionUser(session);
}

export async function ensureAdminSession(): Promise<AdminSessionCheck> {
    const user = await getCurrentSessionUser();
    if (!user) {
        return {
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        };
    }

    if (user.role !== "ADMIN") {
        return {
            ok: false,
            status: 403,
            error: "Accesso riservato agli amministratori"
        };
    }

    return { ok: true, user };
}

export async function ensureAuthenticatedSession(): Promise<AuthenticatedSessionCheck> {
    const user = await getCurrentSessionUser();
    if (!user) {
        return {
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        };
    }

    return { ok: true, user };
}

export async function requireAdminPageSession(): Promise<SessionUser> {
    const sessionCheck = await ensureAdminSession();
    if (sessionCheck.ok) {
        return sessionCheck.user;
    }

    const { redirect } = await import("next/navigation");
    redirect(sessionCheck.status === 401 ? "/login" : "/pos");
    throw new Error("Redirect non riuscito");
}

export async function requireAuthenticatedPageSession(): Promise<SessionUser> {
    const sessionCheck = await ensureAuthenticatedSession();
    if (sessionCheck.ok) {
        return sessionCheck.user;
    }

    const { redirect } = await import("next/navigation");
    redirect("/login");
    throw new Error("Redirect non riuscito");
}

export function adminUnauthorizedJson(sessionCheck: Extract<AdminSessionCheck, { ok: false }>) {
    return NextResponse.json(
        { error: sessionCheck.error },
        { status: sessionCheck.status }
    );
}
