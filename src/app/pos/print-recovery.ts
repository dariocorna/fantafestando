export interface FailedPrinterGroupState {
    key: string
    name: string
    printerType: "CASHIER" | "KITCHEN" | null
    canHold: boolean
    error?: string
    count: number
    jobIds: string[]
}

export function resolveFailedPrintersAfterHold(
    failedPrinters: FailedPrinterGroupState[],
    heldPrinterKey: string,
    reportedFailedPrinters: FailedPrinterGroupState[]
) {
    return reportedFailedPrinters.length > 0
        ? reportedFailedPrinters
        : failedPrinters.filter((printer) => printer.key !== heldPrinterKey)
}
