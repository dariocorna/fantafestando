import { APIError } from "@sumup/sdk"
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest"

const {
    sumUpConstructorMock,
    readersCreateCheckoutMock,
    checkoutsGetMock,
    merchantGetMerchantProfileMock,
    transactionsGetMock,
    transactionsRefundMock
} = vi.hoisted(() => ({
    sumUpConstructorMock: vi.fn(),
    readersCreateCheckoutMock: vi.fn(),
    checkoutsGetMock: vi.fn(),
    merchantGetMerchantProfileMock: vi.fn(),
    transactionsGetMock: vi.fn(),
    transactionsRefundMock: vi.fn()
}))

vi.mock("@sumup/sdk", () => ({
    APIError: class APIError extends Error {
        status: number

        constructor(status: number) {
            super(String(status))
            this.status = status
        }
    },
    SumUp: class {
        readers = { createCheckout: readersCreateCheckoutMock }
        checkouts = { get: checkoutsGetMock }
        merchant = { getMerchantProfile: merchantGetMerchantProfileMock }
        transactions = { get: transactionsGetMock, refund: transactionsRefundMock }

        constructor(config: unknown) {
            sumUpConstructorMock(config)
        }
    }
}))

import {
    createSumUpCheckout,
    getSumUpTransactionByClientTransactionId,
    getSumUpTransactionByForeignTransactionId,
    resolveSumUpTransactionIdByCheckout
} from "@/lib/sumup"

describe("sumup helpers", () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalMenuUrl = process.env.NEXTAUTH_URL_MENU
    const originalWebhookUrl = process.env.SUMUP_WEBHOOK_URL

    beforeEach(() => {
        vi.clearAllMocks()
        ;(process.env as Record<string, string | undefined>).NODE_ENV = "test"
        process.env.NEXTAUTH_URL_MENU = "https://menu.example.test"
        delete process.env.SUMUP_WEBHOOK_URL
    })

    afterAll(() => {
        const restore = (key: string, value: string | undefined) => {
            if (value === undefined) delete process.env[key]
            else (process.env as Record<string, string | undefined>)[key] = value
        }
        restore("NODE_ENV", originalNodeEnv)
        restore("NEXTAUTH_URL_MENU", originalMenuUrl)
        restore("SUMUP_WEBHOOK_URL", originalWebhookUrl)
    })

    test("creates a reader checkout with the public webhook callback and affiliate metadata", async () => {
        readersCreateCheckoutMock.mockResolvedValue({
            data: { client_transaction_id: "client-tx-1" }
        })

        const result = await createSumUpCheckout({
            amount: 12.5,
            merchantCode: "merchant-1",
            readerId: "reader-1",
            apiKey: "api-key-1",
            affiliateAppId: "app-1",
            affiliateKey: "affiliate-key-1",
            foreignTransactionId: "order-1"
        })

        expect(result).toEqual({ success: true, id: "client-tx-1" })
        expect(sumUpConstructorMock).toHaveBeenCalledWith({ apiKey: "api-key-1" })
        expect(readersCreateCheckoutMock).toHaveBeenCalledWith(
            "merchant-1",
            "reader-1",
            {
                affiliate: {
                    app_id: "app-1",
                    key: "affiliate-key-1",
                    foreign_transaction_id: "order-1"
                },
                description: "FantaFestando Order",
                return_url: "https://menu.example.test/api/sumup/webhook?orderId=order-1",
                total_amount: {
                    currency: "EUR",
                    minor_unit: 2,
                    value: 1250
                }
            }
        )
    })

    test("rejects non-https webhook callbacks outside local development", async () => {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
        process.env.SUMUP_WEBHOOK_URL = "http://sumup.example.test/api/sumup/webhook"

        const result = await createSumUpCheckout({
            amount: 12.5,
            merchantCode: "merchant-1",
            readerId: "reader-1",
            apiKey: "api-key-1",
            affiliateAppId: "app-1",
            affiliateKey: "affiliate-key-1",
            foreignTransactionId: "order-1"
        })

        expect(result).toEqual({
            success: false,
            error: "SumUp webhook callback must use HTTPS"
        })
        expect(readersCreateCheckoutMock).not.toHaveBeenCalled()
    })

    test("looks up a transaction by client transaction id", async () => {
        transactionsGetMock.mockResolvedValue({ id: "sumup-tx-1", status: "SUCCESSFUL" })

        const result = await getSumUpTransactionByClientTransactionId({
            clientTransactionId: "client-tx-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1"
        })

        expect(result).toMatchObject({
            success: true,
            transaction: { id: "sumup-tx-1", status: "SUCCESSFUL" }
        })
        expect(transactionsGetMock).toHaveBeenCalledWith("merchant-1", {
            client_transaction_id: "client-tx-1"
        })
    })

    test("looks up a transaction by foreign transaction id", async () => {
        transactionsGetMock.mockResolvedValue({ id: "sumup-tx-1", status: "SUCCESSFUL" })

        const result = await getSumUpTransactionByForeignTransactionId({
            foreignTransactionId: "order-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1"
        })

        expect(result).toMatchObject({
            success: true,
            transaction: { id: "sumup-tx-1", status: "SUCCESSFUL" }
        })
        expect(transactionsGetMock).toHaveBeenCalledWith("merchant-1", {
            foreign_transaction_id: "order-1"
        })
    })

    test("marks transport failures as an uncertain payment outcome", async () => {
        readersCreateCheckoutMock.mockRejectedValue(new Error("connection reset"))

        const result = await createSumUpCheckout({
            amount: 12.5,
            merchantCode: "merchant-1",
            readerId: "reader-1",
            apiKey: "api-key-1",
            affiliateAppId: "app-1",
            affiliateKey: "affiliate-key-1",
            foreignTransactionId: "order-1"
        })

        expect(result).toEqual({
            success: false,
            error: "Failed to initiate payment",
            uncertain: true
        })
    })

    test("treats an accepted response without a client transaction id as uncertain", async () => {
        readersCreateCheckoutMock.mockResolvedValue({ data: {} })

        const result = await createSumUpCheckout({
            amount: 12.5,
            merchantCode: "merchant-1",
            readerId: "reader-1",
            apiKey: "api-key-1",
            affiliateAppId: "app-1",
            affiliateKey: "affiliate-key-1",
            foreignTransactionId: "order-1"
        })

        expect(result).toEqual({
            success: false,
            error: "Missing SumUp client transaction id",
            uncertain: true
        })
    })

    test("treats SumUp 4xx API errors as definite checkout failures", async () => {
        readersCreateCheckoutMock.mockRejectedValue(new APIError(422, {}, new Response()))

        const result = await createSumUpCheckout({
            amount: 12.5,
            merchantCode: "merchant-1",
            readerId: "reader-1",
            apiKey: "api-key-1",
            affiliateAppId: "app-1",
            affiliateKey: "affiliate-key-1",
            foreignTransactionId: "order-1"
        })

        expect(result).toEqual({
            success: false,
            error: "Failed to initiate payment",
            uncertain: false
        })
    })

    test("keeps HTTP request timeouts in the uncertain recovery path", async () => {
        readersCreateCheckoutMock.mockRejectedValue(new APIError(408, {}, new Response()))

        const result = await createSumUpCheckout({
            amount: 12.5,
            merchantCode: "merchant-1",
            readerId: "reader-1",
            apiKey: "api-key-1",
            affiliateAppId: "app-1",
            affiliateKey: "affiliate-key-1",
            foreignTransactionId: "order-1"
        })

        expect(result).toEqual({
            success: false,
            error: "Failed to initiate payment",
            uncertain: true
        })
    })

    test("keeps refund compatibility by resolving transaction ids from client transaction ids", async () => {
        checkoutsGetMock.mockRejectedValue(new Error("legacy checkout not found"))
        merchantGetMerchantProfileMock.mockResolvedValue({ merchant_code: "merchant-1" })
        transactionsGetMock.mockResolvedValue({ id: "sumup-tx-1" })

        const result = await resolveSumUpTransactionIdByCheckout("client-tx-1", "api-key-1")

        expect(result).toEqual({ success: true, transactionId: "sumup-tx-1" })
        expect(merchantGetMerchantProfileMock).toHaveBeenCalledOnce()
        expect(transactionsGetMock).toHaveBeenCalledWith("merchant-1", {
            client_transaction_id: "client-tx-1"
        })
    })
})
