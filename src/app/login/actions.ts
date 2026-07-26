"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { consumeRateLimit, isRateLimited, resolveClientKey } from "@/lib/rate-limit";

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface LoginActionState {
    error: string | null;
}

function normalizeCallbackUrl(value: FormDataEntryValue | null): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized.startsWith("/") || normalized.startsWith("//")) {
        return "/admin";
    }
    return normalized;
}

export async function loginAction(
    _prevState: LoginActionState,
    formData: FormData
): Promise<LoginActionState> {
    const username = typeof formData.get("username") === "string"
        ? (formData.get("username") as string).trim()
        : "";
    const password = typeof formData.get("password") === "string"
        ? (formData.get("password") as string)
        : "";
    const callbackUrl = normalizeCallbackUrl(formData.get("callbackUrl"));

    if (!username || !password) {
        return { error: "Inserisci username e password." };
    }

    // Only failed attempts are counted, so legitimate staff logins never lock out.
    const clientKey = resolveClientKey(await headers());
    const rateLimitKeys = [`login:ip:${clientKey}`, `login:user:${username.toLowerCase()}`];
    for (const key of rateLimitKeys) {
        const { allowed, retryAfterSeconds } = isRateLimited(key, LOGIN_ATTEMPT_LIMIT);
        if (!allowed) {
            return {
                error: `Troppi tentativi di accesso falliti. Riprova tra ${Math.ceil(retryAfterSeconds / 60)} minuti.`
            };
        }
    }

    try {
        await signIn("credentials", {
            username,
            password,
            redirectTo: callbackUrl
        });
        return { error: null };
    } catch (error) {
        if (error instanceof AuthError) {
            if (error.type === "CredentialsSignin") {
                rateLimitKeys.forEach((key) =>
                    consumeRateLimit(key, LOGIN_ATTEMPT_LIMIT, LOGIN_ATTEMPT_WINDOW_MS)
                );
                return { error: "Credenziali non valide." };
            }

            return { error: "Errore di autenticazione. Riprova." };
        }

        throw error;
    }
}
