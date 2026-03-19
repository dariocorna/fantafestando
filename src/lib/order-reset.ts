export const ORDER_RESET_CONFIRMATION_TOKEN = "RESET"

export function validateOrderResetConfirmationToken(rawToken: string | null | undefined):
    { ok: true }
    | { ok: false, error: string } {
    const normalizedToken = rawToken?.trim().toUpperCase()
    if (!normalizedToken) {
        return { ok: false, error: "Conferma richiesta: digita RESET per procedere" }
    }

    if (normalizedToken !== ORDER_RESET_CONFIRMATION_TOKEN) {
        return { ok: false, error: "Token di conferma non valido. Digita RESET per confermare" }
    }

    return { ok: true }
}
