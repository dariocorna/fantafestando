import { describe, expect, it } from "vitest"

import {
    ORDER_RESET_CONFIRMATION_TOKEN,
    validateOrderResetConfirmationToken
} from "./order-reset"

describe("order-reset helpers", () => {
    it("accepts valid confirmation token", () => {
        expect(validateOrderResetConfirmationToken(ORDER_RESET_CONFIRMATION_TOKEN)).toEqual({ ok: true })
    })

    it("normalizes case and surrounding spaces", () => {
        expect(validateOrderResetConfirmationToken("  reset  ")).toEqual({ ok: true })
    })

    it("rejects missing token", () => {
        expect(validateOrderResetConfirmationToken("")).toEqual({
            ok: false,
            error: "Conferma richiesta: digita RESET per procedere"
        })
    })

    it("rejects invalid token", () => {
        expect(validateOrderResetConfirmationToken("RESETTA")).toEqual({
            ok: false,
            error: "Token di conferma non valido. Digita RESET per confermare"
        })
    })
})
