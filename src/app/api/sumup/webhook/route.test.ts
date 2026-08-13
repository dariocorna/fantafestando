import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const {
    orderFindOneAndUpdateMock,
    orderFindOneMock,
    orderUpdateOneMock,
    posDeviceFindOneMock,
    decryptSecretMock,
    isEncryptedSecretMock,
    getByClientMock,
    getByForeignMock,
    transitionSumUpOrderStockMock,
    routeOrderToPrintersMock,
    claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaimMock,
    claimSumUpEventOperationMock,
    releaseSumUpEventOperationMock,
} = vi.hoisted(() => ({
    orderFindOneAndUpdateMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
    posDeviceFindOneMock: vi.fn(),
    decryptSecretMock: vi.fn(),
    isEncryptedSecretMock: vi.fn(),
    getByClientMock: vi.fn(),
    getByForeignMock: vi.fn(),
    transitionSumUpOrderStockMock: vi.fn(),
    routeOrderToPrintersMock: vi.fn(),
    claimCashSessionPaymentMock: vi.fn(),
    refreshCashSessionPaymentClaimMock: vi.fn(),
    releaseCashSessionPaymentClaimMock: vi.fn(),
    claimSumUpEventOperationMock: vi.fn(),
    releaseSumUpEventOperationMock: vi.fn(),
}))

vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }))
vi.mock("@/models/Order", () => ({
    default: {
        findOneAndUpdate: orderFindOneAndUpdateMock,
        findOne: orderFindOneMock,
        updateOne: orderUpdateOneMock,
    },
}))
vi.mock("@/models/PosDevice", () => ({ default: { findOne: posDeviceFindOneMock } }))
vi.mock("@/lib/secrets", () => ({
    decryptSecret: decryptSecretMock,
    encryptSecret: vi.fn(),
    isEncryptedSecret: isEncryptedSecretMock
}))
vi.mock("@/lib/sumup", () => ({
    getSumUpTransactionByClientTransactionId: getByClientMock,
    getSumUpTransactionByForeignTransactionId: getByForeignMock,
}))
vi.mock("@/lib/sumup-order-stock", () => ({ transitionSumUpOrderStock: transitionSumUpOrderStockMock }))
vi.mock("@/lib/printer", () => ({ PrinterService: { routeOrderToPrinters: routeOrderToPrintersMock } }))
vi.mock("@/lib/cash-session-payment-claim", () => ({
    claimCashSessionPayment: claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaim: refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaim: releaseCashSessionPaymentClaimMock,
}))
vi.mock("@/lib/sumup-event-operation", () => ({
    claimSumUpEventOperation: claimSumUpEventOperationMock,
    releaseSumUpEventOperation: releaseSumUpEventOperationMock,
}))

import { POST } from "./route"

const pendingOrder = {
    _id: "order-1",
    status: "PENDING" as const,
    totalAmount: 12.5,
    eventId: "event-1",
    cashSessionId: "session-1",
    posDeviceId: "pos-1",
    stockEffectStatus: "APPLIED" as const,
    stockAdjustments: [{ entityType: "PRODUCT" as const, entityId: "product-1", quantity: 1 }],
}

const successfulTransaction = {
    id: "sumup-tx-1",
    merchant_code: "merchant-1",
    amount: 12.5,
    currency: "EUR" as const,
    status: "SUCCESSFUL" as const,
    simple_status: "SUCCESSFUL" as const,
}

function webhookRequest(payloadStatus: "successful" | "failed" = "successful", orderId?: string) {
    const url = new URL("https://menu.example.test/api/sumup/webhook")
    if (orderId) url.searchParams.set("orderId", orderId)
    return new NextRequest(url, {
        method: "POST",
        body: JSON.stringify({
            event_type: "solo.transaction.updated",
            payload: {
                client_transaction_id: "client-tx-1",
                merchant_code: "untrusted-merchant",
                status: payloadStatus,
            },
        }),
    })
}

function selectLean(value: unknown) {
    return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) }
}

function populatedPosDevice(value: unknown) {
    return { populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) }
}

describe("POST /api/sumup/webhook", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        orderFindOneMock.mockReturnValue(selectLean(pendingOrder))
        orderFindOneAndUpdateMock.mockResolvedValue(pendingOrder)
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 })
        posDeviceFindOneMock.mockReturnValue(populatedPosDevice({
            paymentTerminalId: {
                type: "SUMUP",
                config: { merchantCode: "merchant-1", apiKey: "encrypted-api-key" },
            },
        }))
        decryptSecretMock.mockReturnValue("api-key-1")
        getByClientMock.mockResolvedValue({ success: true, transaction: successfulTransaction })
        getByForeignMock.mockResolvedValue({ success: true, transaction: successfulTransaction })
        transitionSumUpOrderStockMock.mockResolvedValue({ success: true })
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "session-claim", isTest: false })
        refreshCashSessionPaymentClaimMock.mockResolvedValue(true)
        releaseCashSessionPaymentClaimMock.mockResolvedValue(undefined)
        claimSumUpEventOperationMock.mockResolvedValue("event-operation-1")
        releaseSumUpEventOperationMock.mockResolvedValue(undefined)
        routeOrderToPrintersMock.mockResolvedValue([])
    })

    test("completes only the transaction verified by SumUp and dispatches prints", async () => {
        const response = await POST(webhookRequest("failed"))

        expect(response.status).toBe(200)
        expect(getByClientMock).toHaveBeenCalledWith({
            clientTransactionId: "client-tx-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1",
        })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: "order-1", status: "PENDING", sumupWebhookClaimToken: expect.any(String) },
            {
                $set: {
                    status: "PAID",
                    paidAt: expect.any(Date),
                    sumupCheckoutId: "client-tx-1",
                    sumupPaymentId: "sumup-tx-1",
                },
                $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 },
            },
        )
        expect(routeOrderToPrintersMock).toHaveBeenCalledWith(
            "order-1",
            "pos-1",
            { idempotencyScope: "SUMUP_CALLBACK" },
        )
        expect(claimSumUpEventOperationMock).toHaveBeenCalledWith("event-1", true)
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", "event-operation-1")
    })

    test("keeps the webhook retryable while a storno owns the event", async () => {
        claimSumUpEventOperationMock.mockResolvedValue(null)

        const response = await POST(webhookRequest())

        expect(response.status).toBe(503)
        await expect(response.json()).resolves.toEqual({ error: "Print dispatch retry required" })
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled()
    })

    test("verifies the callback from the order snapshot after its POS has been removed", async () => {
        const query = selectLean({
            ...pendingOrder,
            sumupRefundCredentials: {
                merchantCode: "merchant-1",
                readerId: "reader-1",
                apiKey: "enc:v1:snapshot"
            }
        })
        orderFindOneMock.mockReturnValue(query)
        posDeviceFindOneMock.mockReset()
        isEncryptedSecretMock.mockReturnValue(true)
        decryptSecretMock.mockReturnValue("snapshot-api-key")

        const response = await POST(webhookRequest())

        expect(response.status).toBe(200)
        expect(query.select).toHaveBeenCalledWith(expect.stringContaining("+sumupRefundCredentials"))
        expect(posDeviceFindOneMock).not.toHaveBeenCalled()
        expect(getByClientMock).toHaveBeenCalledWith({
            clientTransactionId: "client-tx-1",
            merchantCode: "merchant-1",
            apiKey: "snapshot-api-key"
        })
    })

    test("keeps the first successful finalizer authoritative while print recovery is pending", async () => {
        routeOrderToPrintersMock.mockResolvedValue(["RECOVERY_PENDING"])

        const response = await POST(webhookRequest())

        expect(response.status).toBe(200)
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: "order-1", status: "PENDING", sumupWebhookClaimToken: expect.any(String) },
            expect.objectContaining({ $set: expect.objectContaining({ status: "PAID" }) }),
        )
    })

    test("keeps webhook retries active when print dispatch fails before persisting an intent", async () => {
        routeOrderToPrintersMock.mockResolvedValue(["RETRY_REQUIRED"])

        const response = await POST(webhookRequest())

        expect(response.status).toBe(503)
        await expect(response.json()).resolves.toEqual({ error: "Print dispatch retry required" })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: "order-1", status: "PENDING", sumupWebhookClaimToken: expect.any(String) },
            expect.objectContaining({ $set: expect.objectContaining({ status: "PAID" }) }),
        )
    })

    test("uses simple_status as authoritative and rolls back a refunded payment", async () => {
        getByClientMock.mockResolvedValue({
            success: true,
            transaction: { ...successfulTransaction, status: "SUCCESSFUL", simple_status: "REFUNDED" },
        })

        const response = await POST(webhookRequest())

        await expect(response.json()).resolves.toEqual({ success: true, status: "cancelled" })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledWith({
            eventId: "event-1",
            orderId: "order-1",
            token: "SUMUP_CANCEL:client-tx-1",
            target: "REVERTED",
            adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }],
        })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({ status: "PENDING" }),
            expect.objectContaining({
                $unset: expect.objectContaining({ sumupRefundCredentials: 1 })
            })
        )
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled()
    })

    test("does not claim an order while the verified transaction is non-final", async () => {
        getByClientMock.mockResolvedValue({
            success: true,
            transaction: { ...successfulTransaction, status: "PENDING", simple_status: undefined },
        })

        const response = await POST(webhookRequest())

        expect(response.status).toBe(409)
        expect(orderFindOneAndUpdateMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).not.toHaveBeenCalled()
    })

    test("rejects verified transaction data that does not match the order", async () => {
        getByClientMock.mockResolvedValue({
            success: true,
            transaction: { ...successfulTransaction, amount: 18 },
        })

        const response = await POST(webhookRequest())

        expect(response.status).toBe(409)
        expect(orderFindOneAndUpdateMock).not.toHaveBeenCalled()
    })

    test("returns a retryable response while another callback owns the atomic claim", async () => {
        orderFindOneMock
            .mockReturnValueOnce(selectLean(pendingOrder))
            .mockReturnValueOnce(selectLean(pendingOrder))
        orderFindOneAndUpdateMock.mockResolvedValue(null)

        const response = await POST(webhookRequest())

        expect(response.status).toBe(503)
        expect(orderFindOneAndUpdateMock).toHaveBeenCalledWith(
            {
                sumupCheckoutId: "client-tx-1",
                status: "PENDING",
                $or: [
                    { sumupWebhookClaimedAt: { $exists: false } },
                    { sumupWebhookClaimedAt: { $lt: expect.any(Date) } },
                ],
            },
            { $set: { sumupWebhookClaimToken: expect.any(String), sumupWebhookClaimedAt: expect.any(Date) } },
            { returnDocument: "after" },
        )
    })

    test("reconciles an uncertain checkout with matching client and foreign lookups", async () => {
        orderFindOneMock
            .mockReturnValueOnce(selectLean(null))
            .mockReturnValueOnce(selectLean(pendingOrder))

        const response = await POST(webhookRequest("successful", "order-1"))

        expect(response.status).toBe(200)
        expect(getByClientMock).toHaveBeenCalledWith({
            clientTransactionId: "client-tx-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1",
        })
        expect(getByForeignMock).toHaveBeenCalledWith({
            foreignTransactionId: "order-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1",
        })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            {
                _id: "order-1",
                status: "PENDING",
                sumupCheckoutId: "initiating:order-1",
                $or: [
                    { sumupWebhookClaimedAt: { $exists: false } },
                    { sumupWebhookClaimedAt: { $lt: expect.any(Date) } },
                ],
            },
            { $set: { sumupCheckoutId: "client-tx-1" } },
        )
    })

    test("does not link an uncertain checkout when the two official lookups disagree", async () => {
        orderFindOneMock
            .mockReturnValueOnce(selectLean(null))
            .mockReturnValueOnce(selectLean(pendingOrder))
        getByForeignMock.mockResolvedValue({
            success: true,
            transaction: { ...successfulTransaction, id: "different-sumup-transaction" },
        })

        const response = await POST(webhookRequest("successful", "order-1"))

        expect(response.status).toBe(409)
        expect(orderUpdateOneMock).not.toHaveBeenCalled()
        expect(orderFindOneAndUpdateMock).not.toHaveBeenCalled()
    })

    test("persists a late successful payment that arrives after recovery cancelled the order", async () => {
        const recoveredCancellation = {
            ...pendingOrder,
            status: "CANCELLED" as const,
            sumupCheckoutId: "initiating:order-1",
            sumupRecoveryCancelledAt: new Date("2026-08-12T11:20:00Z"),
        }
        orderFindOneMock
            .mockReturnValueOnce(selectLean(null))
            .mockReturnValueOnce(selectLean(recoveredCancellation))

        const response = await POST(webhookRequest("successful", "order-1"))

        expect(response.status).toBe(409)
        await expect(response.json()).resolves.toEqual({
            error: "Late SumUp payment detected after local cancellation; refund required",
        })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            {
                _id: "order-1",
                status: "CANCELLED",
                sumupRecoveryCancelledAt: { $exists: true },
            },
            {
                $set: {
                    sumupCheckoutId: "client-tx-1",
                    sumupPaymentId: "sumup-tx-1",
                    sumupLateSuccessDetectedAt: expect.any(Date),
                },
            },
        )
        expect(orderFindOneAndUpdateMock).not.toHaveBeenCalled()
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled()
    })

    test("resolves a recovery cancellation after an authoritative negative transaction", async () => {
        const recoveredCancellation = {
            ...pendingOrder,
            status: "CANCELLED" as const,
            sumupCheckoutId: "initiating:order-1",
            sumupRecoveryCancelledAt: new Date("2026-08-12T11:20:00Z"),
        }
        const failedTransaction = {
            ...successfulTransaction,
            status: "FAILED",
            simple_status: "FAILED",
        }
        orderFindOneMock
            .mockReturnValueOnce(selectLean(null))
            .mockReturnValueOnce(selectLean(recoveredCancellation))
        getByForeignMock.mockResolvedValue({ success: true, transaction: failedTransaction })
        getByClientMock.mockResolvedValue({ success: true, transaction: failedTransaction })

        const response = await POST(webhookRequest("failed", "order-1"))

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ success: true, message: "Already cancelled" })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: "order-1", status: "CANCELLED", sumupRecoveryCancelledAt: { $exists: true } },
            {
                $set: {
                    sumupCheckoutId: "client-tx-1",
                    sumupRecoveryResolvedAt: expect.any(Date),
                },
                $unset: { sumupRefundCredentials: 1 },
            },
        )
    })

    test("acknowledges a duplicate late callback after its payment was refunded", async () => {
        orderFindOneMock.mockReturnValue(selectLean({
            ...pendingOrder,
            status: "CANCELLED",
            sumupCheckoutId: "client-tx-1",
            sumupRecoveryCancelledAt: new Date("2026-08-12T11:20:00Z"),
            sumupLateSuccessDetectedAt: new Date("2026-08-12T11:25:00Z"),
            stornoMeta: { refundStatus: "DONE" },
        }))

        const response = await POST(webhookRequest())

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
            success: true,
            message: "Late payment already refunded",
        })
        expect(orderUpdateOneMock).not.toHaveBeenCalled()
        expect(orderFindOneAndUpdateMock).not.toHaveBeenCalled()
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled()
    })

    test("recovers prints for an already-paid callback without querying SumUp again", async () => {
        orderFindOneMock.mockReturnValue(selectLean({ ...pendingOrder, status: "PAID" }))
        routeOrderToPrintersMock.mockResolvedValue([true])

        const response = await POST(webhookRequest())

        await expect(response.json()).resolves.toEqual({ success: true, message: "Already paid" })
        expect(getByClientMock).not.toHaveBeenCalled()
        expect(routeOrderToPrintersMock).toHaveBeenCalledOnce()
    })

    test("returns 503 for an already-paid callback while a print recovery claim is active, then completes after reclaim", async () => {
        orderFindOneMock.mockReturnValue(selectLean({ ...pendingOrder, status: "PAID" }))
        routeOrderToPrintersMock
            .mockResolvedValueOnce(["RECOVERY_PENDING"])
            .mockResolvedValueOnce([true])

        const activeClaimResponse = await POST(webhookRequest())
        const reclaimedResponse = await POST(webhookRequest())

        expect(activeClaimResponse.status).toBe(503)
        await expect(activeClaimResponse.json()).resolves.toEqual({ error: "Print recovery pending" })
        expect(reclaimedResponse.status).toBe(200)
        await expect(reclaimedResponse.json()).resolves.toEqual({ success: true, message: "Already paid" })
        expect(routeOrderToPrintersMock).toHaveBeenCalledTimes(2)
        expect(getByClientMock).not.toHaveBeenCalled()
    })

    test.each([true, false])("acknowledges an already-paid callback when its duplicate print intent is terminal (%s)", async (result) => {
        orderFindOneMock.mockReturnValue(selectLean({ ...pendingOrder, status: "PAID" }))
        routeOrderToPrintersMock.mockResolvedValue([result])

        const response = await POST(webhookRequest())

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ success: true, message: "Already paid" })
    })

    test("rebuilds missing print intents idempotently for an already-paid order", async () => {
        orderFindOneMock.mockReturnValue(selectLean({ ...pendingOrder, status: "PAID" }))

        const response = await POST(webhookRequest())

        expect(response.status).toBe(200)
        expect(routeOrderToPrintersMock).toHaveBeenCalledWith(
            "order-1",
            "pos-1",
            { idempotencyScope: "SUMUP_CALLBACK" },
        )
    })

    test.each([
        ["closed", { success: false }],
        ["TEST", { success: true, token: "test-claim", isTest: true }],
    ] as const)("does not complete stock or payment when the cash session is %s", async (_name, claimResult) => {
        claimCashSessionPaymentMock.mockResolvedValue(claimResult)

        const response = await POST(webhookRequest())

        expect(response.status).toBe(409)
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: "order-1", status: "PENDING", sumupWebhookClaimToken: expect.any(String) },
            { $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 } },
        )
    })

    test("releases the callback claim when cancellation loses its CAS", async () => {
        getByClientMock.mockResolvedValue({
            success: true,
            transaction: { ...successfulTransaction, status: "FAILED", simple_status: "FAILED" },
        })
        orderUpdateOneMock
            .mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 })
            .mockResolvedValueOnce({ acknowledged: true, matchedCount: 1 })

        const response = await POST(webhookRequest())

        expect(response.status).toBe(409)
        expect(orderUpdateOneMock).toHaveBeenLastCalledWith(
            { _id: "order-1", status: "PENDING", sumupWebhookClaimToken: expect.any(String) },
            { $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 } },
        )
    })
})
