import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensureAdminSessionMock,
    getAdminContextEventIdMock,
    orderFindOneAndUpdateMock,
    orderFindOneMock,
    orderUpdateOneMock,
    posDeviceFindOneMock,
    decryptSecretMock,
    isEncryptedSecretMock,
    transitionClaimedOrderStockMock,
    refundSumUpTransactionMock,
    getSumUpRefundStateMock,
    claimSumUpEventOperationMock,
    releaseSumUpEventOperationMock,
    startSumUpEventOperationHeartbeatMock,
    stopSumUpEventOperationHeartbeatMock
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    orderFindOneAndUpdateMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
    posDeviceFindOneMock: vi.fn(),
    decryptSecretMock: vi.fn(),
    isEncryptedSecretMock: vi.fn(),
    transitionClaimedOrderStockMock: vi.fn(),
    refundSumUpTransactionMock: vi.fn(),
    getSumUpRefundStateMock: vi.fn(),
    claimSumUpEventOperationMock: vi.fn(),
    releaseSumUpEventOperationMock: vi.fn(),
    startSumUpEventOperationHeartbeatMock: vi.fn(),
    stopSumUpEventOperationHeartbeatMock: vi.fn()
}))

vi.mock("@/lib/authz", () => ({ ensureAdminSession: ensureAdminSessionMock }))
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }))
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }))
vi.mock("@/models/Order", () => ({ default: {
    findOneAndUpdate: orderFindOneAndUpdateMock,
    findOne: orderFindOneMock,
    updateOne: orderUpdateOneMock
} }))
vi.mock("@/models/OrderCounter", () => ({ default: {} }))
vi.mock("@/models/PrintJob", () => ({ default: {} }))
vi.mock("@/models/CashSession", () => ({ default: {} }))
vi.mock("@/models/PosDevice", () => ({ default: { findOne: posDeviceFindOneMock } }))
vi.mock("@/models/Peripheral", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({ PrinterService: {} }))
vi.mock("@/lib/secrets", () => ({
    decryptSecret: decryptSecretMock,
    encryptSecret: vi.fn(),
    isEncryptedSecret: isEncryptedSecretMock
}))
vi.mock("@/lib/sumup", () => ({
    refundSumUpTransaction: refundSumUpTransactionMock,
    resolveSumUpTransactionIdByCheckout: vi.fn()
}))
vi.mock("@/lib/sumup-refund", () => ({ getSumUpRefundState: getSumUpRefundStateMock }))
vi.mock("@/lib/cash-session-stock", () => ({ transitionClaimedOrderStock: transitionClaimedOrderStockMock }))
vi.mock("@/lib/sumup-event-operation", () => ({
    claimSumUpEventOperation: claimSumUpEventOperationMock,
    releaseSumUpEventOperation: releaseSumUpEventOperationMock,
    startSumUpEventOperationHeartbeat: startSumUpEventOperationHeartbeatMock
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { stornoPaidOrderById } from "./actions"

function mockSumUpTerminal() {
    posDeviceFindOneMock.mockReturnValue({
        populate: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                paymentTerminalId: {
                    type: "SUMUP",
                    config: { apiKey: "encrypted-api-key", merchantCode: "merchant-1" }
                }
            })
        })
    })
    decryptSecretMock.mockReturnValue("plain-api-key")
}

function sumUpOrder(stornoMeta: Record<string, unknown> = { status: "IN_PROGRESS" }) {
    return {
        _id: "order-1",
        status: "PAID",
        paymentMethod: "CARD",
        totalAmount: 10,
        sumupPaymentId: "transaction-1",
        posDeviceId: { toString: () => "pos-1" },
        cart: [],
        stockEffectStatus: "APPLIED",
        stornoMeta
    }
}

function selectedLean(value: unknown) {
    return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) }
}

describe("stornoPaidOrderById stock claim", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensureAdminSessionMock.mockResolvedValue({ ok: true })
        getAdminContextEventIdMock.mockResolvedValue("event-1")
        orderUpdateOneMock.mockResolvedValue({ matchedCount: 1 })
        getSumUpRefundStateMock.mockResolvedValue({ success: true, fullyRefunded: false })
        claimSumUpEventOperationMock.mockResolvedValue("event-operation-1")
        releaseSumUpEventOperationMock.mockResolvedValue(undefined)
        startSumUpEventOperationHeartbeatMock.mockReturnValue(stopSumUpEventOperationHeartbeatMock)
    })

    test("does not start a refund while SumUp print dispatch owns the event", async () => {
        claimSumUpEventOperationMock.mockResolvedValue(null)

        await expect(stornoPaidOrderById("order-1")).resolves.toEqual({
            success: false,
            error: expect.stringMatching(/già in corso/i)
        })

        expect(orderFindOneAndUpdateMock).not.toHaveBeenCalled()
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", null)
    })

    test("does not refund or restore stock when a session transition already claimed the order", async () => {
        const lockedOrder = {
            _id: "order-1",
            status: "PAID",
            paymentMethod: "CASH",
            totalAmount: 10,
            cart: [],
            stockEffectStatus: "APPLIED",
            stornoMeta: { status: "IN_PROGRESS" }
        }
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(selectedLean(lockedOrder))
            .mockReturnValueOnce(selectedLean(null))

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: false, error: "Modifica scorte già in corso per questo ordine: riprova tra poco" })
        expect(transitionClaimedOrderStockMock).not.toHaveBeenCalled()
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({ "stornoMeta.status": "IN_PROGRESS" }),
            expect.objectContaining({ $set: expect.objectContaining({ "stornoMeta.status": "FAILED" }) })
        )
    })

    test("storna a manual CARD payment without calling SumUp", async () => {
        const lockedOrder = {
            _id: "order-1",
            status: "PAID",
            paymentMethod: "CARD",
            totalAmount: 10,
            cart: [],
            stockEffectStatus: "APPLIED",
            stornoMeta: { status: "IN_PROGRESS" }
        }
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(selectedLean(lockedOrder))
            .mockReturnValueOnce(selectedLean(lockedOrder))
        transitionClaimedOrderStockMock.mockResolvedValue({ success: true })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: true })
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
        expect(transitionClaimedOrderStockMock).toHaveBeenCalledOnce()
        expect(orderUpdateOneMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ _id: "order-1", eventId: "event-1" }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: "CANCELLED",
                    "stornoMeta.refundRequired": false,
                    "stornoMeta.refundStatus": "SKIPPED"
                })
            })
        )
    })

    test("uses the dedicated encrypted API key for a certified SumUp refund", async () => {
        const lockedOrder = sumUpOrder()
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(selectedLean(lockedOrder))
            .mockReturnValueOnce(selectedLean(lockedOrder))
        mockSumUpTerminal()
        refundSumUpTransactionMock.mockImplementation(async () => {
            expect(orderUpdateOneMock).toHaveBeenCalledWith(
                expect.objectContaining({ "stornoMeta.status": "IN_PROGRESS" }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        "stornoMeta.refundTransactionId": "transaction-1",
                        "stornoMeta.refundError": "Rimborso SumUp in verifica"
                    })
                })
            )
            return { success: true }
        })
        transitionClaimedOrderStockMock.mockResolvedValue({ success: true })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: true })
        expect(decryptSecretMock).toHaveBeenCalledWith("encrypted-api-key")
        expect(refundSumUpTransactionMock).toHaveBeenCalledWith({
            transactionId: "transaction-1",
            apiKey: "plain-api-key"
        })
    })

    test("refunds from the encrypted order snapshot after the POS and terminal are removed", async () => {
        const lockedOrder = {
            ...sumUpOrder(),
            sumupRefundCredentials: {
                merchantCode: "snapshot-merchant",
                readerId: "snapshot-reader",
                apiKey: "enc:v1:snapshot"
            }
        }
        const leaseQuery = selectedLean(lockedOrder)
        const stockQuery = selectedLean(lockedOrder)
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(leaseQuery)
            .mockReturnValueOnce(stockQuery)
        isEncryptedSecretMock.mockReturnValue(true)
        decryptSecretMock.mockReturnValue("snapshot-api-key")
        refundSumUpTransactionMock.mockResolvedValue({ success: true })
        transitionClaimedOrderStockMock.mockResolvedValue({ success: true })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: true })
        expect(leaseQuery.select).toHaveBeenCalledWith("+sumupRefundCredentials")
        expect(stockQuery.select).toHaveBeenCalledWith("+sumupRefundCredentials")
        expect(posDeviceFindOneMock).not.toHaveBeenCalled()
        expect(refundSumUpTransactionMock).toHaveBeenCalledWith({
            transactionId: "transaction-1",
            apiKey: "snapshot-api-key"
        })
        expect(orderUpdateOneMock).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                $unset: expect.objectContaining({ sumupRefundCredentials: 1 })
            })
        )
    })

    test("fails closed instead of falling back when the order snapshot is corrupt", async () => {
        const lockedOrder = {
            ...sumUpOrder(),
            sumupRefundCredentials: {
                merchantCode: "snapshot-merchant",
                apiKey: "plaintext-is-not-a-valid-snapshot"
            }
        }
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(selectedLean(lockedOrder))
            .mockReturnValueOnce(selectedLean(lockedOrder))
        isEncryptedSecretMock.mockReturnValue(false)
        mockSumUpTerminal()

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: false, error: "Snapshot credenziali SumUp non valido" })
        expect(posDeviceFindOneMock).not.toHaveBeenCalled()
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
    })

    test("refunds a late SumUp success without reverting stock a second time", async () => {
        const lockedOrder = {
            ...sumUpOrder(),
            status: "CANCELLED",
            stockEffectStatus: "REVERTED",
            sumupLateSuccessDetectedAt: new Date(),
        }
        orderFindOneAndUpdateMock.mockReturnValueOnce(selectedLean(lockedOrder))
        mockSumUpTerminal()
        refundSumUpTransactionMock.mockResolvedValue({ success: true })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: true })
        expect(refundSumUpTransactionMock).toHaveBeenCalledWith({
            transactionId: "transaction-1",
            apiKey: "plain-api-key"
        })
        expect(transitionClaimedOrderStockMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ _id: "order-1", status: "CANCELLED" }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: "CANCELLED",
                    "stornoMeta.status": "COMPLETED",
                    "stornoMeta.refundStatus": "DONE",
                    stockEffectStatus: "REVERTED"
                })
            })
        )
    })

    test("completes a lost-response refund from SumUp without a second POST", async () => {
        const lockedOrder = sumUpOrder({
            status: "IN_PROGRESS",
            refundStatus: "FAILED",
            refundTransactionId: "transaction-1"
        })
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(selectedLean(lockedOrder))
            .mockReturnValueOnce(selectedLean(lockedOrder))
        mockSumUpTerminal()
        getSumUpRefundStateMock.mockResolvedValue({ success: true, fullyRefunded: true })
        transitionClaimedOrderStockMock.mockResolvedValue({ success: true })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: true })
        expect(getSumUpRefundStateMock).toHaveBeenCalledWith({
            transactionId: "transaction-1",
            merchantCode: "merchant-1",
            apiKey: "plain-api-key"
        })
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                $set: expect.objectContaining({ "stornoMeta.refundStatus": "DONE" })
            })
        )
    })

    test("reconciles a lost POST response immediately and completes once", async () => {
        const lockedOrder = sumUpOrder()
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(selectedLean(lockedOrder))
            .mockReturnValueOnce(selectedLean(lockedOrder))
        mockSumUpTerminal()
        refundSumUpTransactionMock.mockResolvedValue({ success: false, error: "Risposta SumUp persa" })
        getSumUpRefundStateMock.mockResolvedValue({ success: true, fullyRefunded: true })
        transitionClaimedOrderStockMock.mockResolvedValue({ success: true })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: true })
        expect(refundSumUpTransactionMock).toHaveBeenCalledOnce()
        expect(getSumUpRefundStateMock).toHaveBeenCalledOnce()
        expect(transitionClaimedOrderStockMock).toHaveBeenCalledOnce()
    })

    test("does not take over an active storno lease", async () => {
        orderFindOneAndUpdateMock.mockReturnValueOnce(selectedLean(null))
        orderFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    status: "PAID",
                    stornoMeta: { status: "IN_PROGRESS", requestedAt: new Date() }
                })
            })
        })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: false, error: "Storno già in corso per questo ordine" })
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
        expect(transitionClaimedOrderStockMock).not.toHaveBeenCalled()
    })

    test("takes over a stale lease and reconciles before one retry", async () => {
        const lockedOrder = sumUpOrder({
            status: "IN_PROGRESS",
            requestedAt: new Date(0),
            refundStatus: "FAILED",
            refundTransactionId: "transaction-1"
        })
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(selectedLean(lockedOrder))
            .mockReturnValueOnce(selectedLean(lockedOrder))
        mockSumUpTerminal()
        getSumUpRefundStateMock.mockResolvedValue({ success: true, fullyRefunded: false })
        refundSumUpTransactionMock.mockResolvedValue({ success: true })
        transitionClaimedOrderStockMock.mockResolvedValue({ success: true })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: true })
        expect(orderFindOneAndUpdateMock.mock.calls[0][0]).toEqual(expect.objectContaining({
            $and: expect.arrayContaining([
                expect.objectContaining({
                    $or: expect.arrayContaining([
                        expect.objectContaining({
                            "stornoMeta.status": "IN_PROGRESS",
                            "stornoMeta.requestedAt": { $lte: expect.any(Date) }
                        })
                    ])
                })
            ])
        }))
        const renewedAt = orderFindOneAndUpdateMock.mock.calls[0][1].$set["stornoMeta.requestedAt"]
        expect(orderFindOneAndUpdateMock.mock.calls[1][0]).toEqual(expect.objectContaining({
            "stornoMeta.requestedAt": renewedAt
        }))
        expect(getSumUpRefundStateMock.mock.invocationCallOrder[0])
            .toBeLessThan(refundSumUpTransactionMock.mock.invocationCallOrder[0])
        expect(refundSumUpTransactionMock).toHaveBeenCalledOnce()
    })

    test("marks a lost-response attempt retryable without a second POST in the invocation", async () => {
        const lockedOrder = sumUpOrder()
        orderFindOneAndUpdateMock
            .mockReturnValueOnce(selectedLean(lockedOrder))
            .mockReturnValueOnce(selectedLean(lockedOrder))
        mockSumUpTerminal()
        refundSumUpTransactionMock.mockResolvedValue({ success: false, error: "Risposta SumUp persa" })
        getSumUpRefundStateMock.mockResolvedValue({ success: true, fullyRefunded: false })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: false, error: "Risposta SumUp persa" })
        expect(refundSumUpTransactionMock).toHaveBeenCalledOnce()
        expect(getSumUpRefundStateMock).toHaveBeenCalledOnce()
        expect(refundSumUpTransactionMock.mock.invocationCallOrder[0])
            .toBeLessThan(getSumUpRefundStateMock.mock.invocationCallOrder[0])
        expect(orderUpdateOneMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ "stornoMeta.status": "IN_PROGRESS" }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    "stornoMeta.status": "FAILED",
                    "stornoMeta.refundStatus": "FAILED",
                    "stornoMeta.refundTransactionId": "transaction-1"
                })
            })
        )
    })
})
