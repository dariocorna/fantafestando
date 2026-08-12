import { beforeEach, describe, expect, test, vi } from "vitest"

const { sumUpConstructorMock, transactionsGetMock } = vi.hoisted(() => ({
    sumUpConstructorMock: vi.fn(),
    transactionsGetMock: vi.fn()
}))

vi.mock("@sumup/sdk", () => ({
    SumUp: class {
        transactions = { get: transactionsGetMock }

        constructor(config: unknown) {
            sumUpConstructorMock(config)
        }
    }
}))

import { getSumUpRefundState } from "@/lib/sumup-refund"

describe("getSumUpRefundState", () => {
    beforeEach(() => vi.clearAllMocks())

    test("reads the transaction by merchant and id and accepts REFUNDED", async () => {
        transactionsGetMock.mockResolvedValue({ id: "transaction-1", simple_status: "REFUNDED" })

        await expect(getSumUpRefundState({
            transactionId: "transaction-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1"
        })).resolves.toEqual({ success: true, fullyRefunded: true })

        expect(sumUpConstructorMock).toHaveBeenCalledWith({ apiKey: "api-key-1" })
        expect(transactionsGetMock).toHaveBeenCalledWith("merchant-1", { id: "transaction-1" })
    })

    test("accepts only refund events that cover the full transaction amount", async () => {
        transactionsGetMock
            .mockResolvedValueOnce({
                id: "transaction-1",
                amount: 10,
                simple_status: "REFUNDED",
                events: [{ id: "refund-1", type: "REFUND", status: "REFUNDED", amount: 4 }]
            })
            .mockResolvedValueOnce({
                id: "transaction-1",
                amount: 10,
                simple_status: "SUCCESSFUL",
                transaction_events: [
                    { id: "refund-1", event_type: "REFUND", status: "REFUNDED", amount: 4 },
                    { id: "refund-2", event_type: "REFUND", status: "SUCCESSFUL", amount: 6 }
                ]
            })

        const input = { transactionId: "transaction-1", merchantCode: "merchant-1", apiKey: "api-key-1" }
        await expect(getSumUpRefundState(input)).resolves.toEqual({ success: true, fullyRefunded: false })
        await expect(getSumUpRefundState(input)).resolves.toEqual({ success: true, fullyRefunded: true })
    })

    test("rejects a response for a different transaction", async () => {
        transactionsGetMock.mockResolvedValue({ id: "transaction-2", simple_status: "REFUNDED" })

        await expect(getSumUpRefundState({
            transactionId: "transaction-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1"
        })).resolves.toEqual({ success: false, error: "Transazione SumUp non corrispondente" })
    })
})
