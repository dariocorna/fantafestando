/**
 * Pure payment logic helpers — extracted for testability.
 */

export type PeripheralType = "SUMUP" | "CASH_BOX" | "ELECTRONIC_MANUAL" | "OTHER"

export interface PosPaymentCapabilities {
    hasCashBox: boolean
    hasPaymentTerminal: boolean
    paymentTerminalType?: PeripheralType
}

/**
 * Returns true when the order must go through a "PENDING → PAID" lifecycle
 * (i.e. SumUp checkout). Manual-electronic and non-card payments resolve
 * immediately as PAID.
 */
export function requiresPendingState(
    paymentMethod: "CASH" | "CARD" | "OTHER",
    capabilities: PosPaymentCapabilities,
): boolean {
    const isCardPayment = paymentMethod === "CARD"
    return isCardPayment && capabilities.paymentTerminalType !== "ELECTRONIC_MANUAL"
}
