import { describe, expect, test } from "vitest"

import {
    resolveFailedPrintersAfterHold,
    type FailedPrinterGroupState
} from "./print-recovery"

function failedPrinter(
    key: string,
    printerType: FailedPrinterGroupState["printerType"]
): FailedPrinterGroupState {
    return {
        key,
        name: key,
        printerType,
        canHold: printerType === "KITCHEN",
        count: 1,
        jobIds: [`job-${key}`]
    }
}

describe("resolveFailedPrintersAfterHold", () => {
    test("preserves the other known failures when the residual lookup returns no groups", () => {
        const kitchen = failedPrinter("kitchen", "KITCHEN")
        const cashier = failedPrinter("cashier", "CASHIER")

        expect(resolveFailedPrintersAfterHold([kitchen, cashier], kitchen.key, []))
            .toEqual([cashier])
    })

    test("uses residual groups returned by the server when available", () => {
        const kitchen = failedPrinter("kitchen", "KITCHEN")
        const cashier = failedPrinter("cashier", "CASHIER")
        const updatedCashier = { ...cashier, count: 2 }

        expect(resolveFailedPrintersAfterHold([kitchen, cashier], kitchen.key, [updatedCashier]))
            .toEqual([updatedCashier])
    })
})
