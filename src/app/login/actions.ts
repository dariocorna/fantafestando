"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

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
                return { error: "Credenziali non valide." };
            }

            return { error: "Errore di autenticazione. Riprova." };
        }

        throw error;
    }
}
