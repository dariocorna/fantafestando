import { describe, it, expect } from "vitest"
import { requiresPendingState, type PosPaymentCapabilities } from "./payment-logic"

describe("requiresPendingState", () => {
    const baseCaps: PosPaymentCapabilities = {
        hasCashBox: true,
        hasPaymentTerminal: true,
    }

    it("returns true for CARD payment with SUMUP terminal", () => {
        expect(requiresPendingState("CARD", { ...baseCaps, paymentTerminalType: "SUMUP" })).toBe(true)
    })

    it("returns false for CARD payment with ELECTRONIC_MANUAL terminal", () => {
        expect(requiresPendingState("CARD", { ...baseCaps, paymentTerminalType: "ELECTRONIC_MANUAL" })).toBe(false)
    })

    it("returns false for CASH payment regardless of terminal type", () => {
        expect(requiresPendingState("CASH", { ...baseCaps, paymentTerminalType: "SUMUP" })).toBe(false)
        expect(requiresPendingState("CASH", { ...baseCaps, paymentTerminalType: "ELECTRONIC_MANUAL" })).toBe(false)
    })

    it("returns false for OTHER payment regardless of terminal type", () => {
        expect(requiresPendingState("OTHER", { ...baseCaps, paymentTerminalType: "SUMUP" })).toBe(false)
    })

    it("returns true for CARD payment when terminal type is undefined (no terminal)", () => {
        expect(requiresPendingState("CARD", { ...baseCaps, paymentTerminalType: undefined })).toBe(true)
    })

    it("returns true for CARD payment with OTHER terminal type", () => {
        expect(requiresPendingState("CARD", { ...baseCaps, paymentTerminalType: "OTHER" })).toBe(true)
    })
})
