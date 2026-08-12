import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensureAdminSessionMock,
    getAdminContextEventIdMock,
    orderFindOneAndUpdateMock,
    orderFindOneMock,
    orderUpdateOneMock,
    posDeviceFindOneMock,
    decryptSecretMock,
    isEncryptedSecretMock,
    getByClientMock,
    getByForeignMock,
    getReaderStatusMock,
    transitionSumUpOrderStockMock,
    finalizeClaimedSumUpOrderMock,
    sumUpTransactionMatchesOrderMock,
    sumUpTransactionsMatchMock,
    revalidatePathMock,
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    orderFindOneAndUpdateMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
    posDeviceFindOneMock: vi.fn(),
    decryptSecretMock: vi.fn(),
    isEncryptedSecretMock: vi.fn(),
    getByClientMock: vi.fn(),
    getByForeignMock: vi.fn(),
    getReaderStatusMock: vi.fn(),
    transitionSumUpOrderStockMock: vi.fn(),
    finalizeClaimedSumUpOrderMock: vi.fn(),
    sumUpTransactionMatchesOrderMock: vi.fn(),
    sumUpTransactionsMatchMock: vi.fn(),
    revalidatePathMock: vi.fn(),
}))

vi.mock("@/lib/authz", () => ({ ensureAdminSession: ensureAdminSessionMock }))
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }))
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }))
vi.mock("@/models/Order", () => ({ default: {
    findOneAndUpdate: orderFindOneAndUpdateMock,
    findOne: orderFindOneMock,
    updateOne: orderUpdateOneMock,
} }))
vi.mock("@/models/OrderCounter", () => ({ default: {} }))
vi.mock("@/models/PrintJob", () => ({ default: {} }))
vi.mock("@/models/CashSession", () => ({ default: {} }))
vi.mock("@/models/PosDevice", () => ({ default: { findOne: posDeviceFindOneMock } }))
vi.mock("@/models/Peripheral", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({ PrinterService: {} }))
vi.mock("@/lib/print-queue", () => ({ recoverStaleManualPrintRetryClaims: vi.fn() }))
vi.mock("@/lib/secrets", () => ({
    decryptSecret: decryptSecretMock,
    encryptSecret: vi.fn(),
    isEncryptedSecret: isEncryptedSecretMock
}))
vi.mock("@/lib/sumup", () => ({
    getSumUpReaderStatus: getReaderStatusMock,
    getSumUpTransactionByClientTransactionId: getByClientMock,
    getSumUpTransactionByForeignTransactionId: getByForeignMock,
    refundSumUpTransaction: vi.fn(),
    resolveSumUpTransactionIdByCheckout: vi.fn(),
}))
vi.mock("@/lib/sumup-refund", () => ({ getSumUpRefundState: vi.fn() }))
vi.mock("@/lib/sumup-order-finalization", () => ({
    finalizeClaimedSumUpOrder: finalizeClaimedSumUpOrderMock,
    sumUpTransactionMatchesOrder: sumUpTransactionMatchesOrderMock,
    sumUpTransactionsMatch: sumUpTransactionsMatchMock,
}))
vi.mock("@/lib/sumup-order-stock", () => ({ transitionSumUpOrderStock: transitionSumUpOrderStockMock }))
vi.mock("@/lib/cash-session-stock", () => ({ transitionClaimedOrderStock: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))

import { recoverUncertainSumUpOrderById } from "./actions"

const transaction = {
    id: "transaction-1",
    client_transaction_id: "client-1",
    foreign_transaction_id: "order-1",
    merchant_code: "merchant-1",
    currency: "EUR",
    amount: 10,
    simple_status: "SUCCESSFUL",
}

function recoverableOrder(overrides: Record<string, unknown> = {}) {
    return {
        _id: "order-1",
        status: "PENDING",
        totalAmount: 10,
        eventId: "event-1",
        cashSessionId: "session-1",
        posDeviceId: "pos-1",
        stockEffectStatus: "APPLIED",
        stockAdjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }],
        sumupCheckoutId: "initiating:order-1",
        sumupInitiatedAt: new Date("2026-08-12T11:00:00Z"),
        ...overrides,
    }
}

function selectLean(value: unknown) {
    return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) }
}

function claimQuery(value: unknown) {
    return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) }
}

function mockSumUpTerminal() {
    posDeviceFindOneMock.mockReturnValue({
        populate: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                paymentTerminalId: {
                    type: "SUMUP",
                    config: {
                        apiKey: "encrypted-api-key",
                        merchantCode: "merchant-1",
                        readerId: "reader-1",
                    },
                },
            }),
        }),
    })
    decryptSecretMock.mockReturnValue("api-key-1")
}

describe("recoverUncertainSumUpOrderById", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-08-12T11:30:00Z"))
        ensureAdminSessionMock.mockResolvedValue({ ok: true })
        getAdminContextEventIdMock.mockResolvedValue("event-1")
        orderFindOneAndUpdateMock.mockReturnValue(claimQuery(recoverableOrder()))
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 })
        transitionSumUpOrderStockMock.mockResolvedValue({ success: true })
        finalizeClaimedSumUpOrderMock.mockResolvedValue({ success: true, status: "PAID" })
        sumUpTransactionMatchesOrderMock.mockReturnValue(true)
        sumUpTransactionsMatchMock.mockReturnValue(true)
        mockSumUpTerminal()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    test("reconciles a verified foreign transaction and finalizes the claimed order", async () => {
        getByForeignMock.mockResolvedValue({ success: true, transaction })
        getByClientMock.mockResolvedValue({ success: true, transaction })

        const result = await recoverUncertainSumUpOrderById("order-1")

        expect(result).toEqual({
            success: true,
            status: "PAID",
            message: "Pagamento SumUp verificato e ordine completato",
        })
        expect(getByForeignMock).toHaveBeenCalledWith({
            foreignTransactionId: "order-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1",
        })
        expect(getByClientMock).toHaveBeenCalledWith({
            clientTransactionId: "client-1",
            merchantCode: "merchant-1",
            apiKey: "api-key-1",
        })
        expect(finalizeClaimedSumUpOrderMock).toHaveBeenCalledWith(expect.objectContaining({
            checkoutId: "client-1",
            order: expect.objectContaining({ _id: "order-1" }),
            transaction,
            claimToken: expect.any(String),
        }))
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
    })

    test("recovers with the order snapshot after its POS has been removed", async () => {
        const query = claimQuery(recoverableOrder({
            sumupRefundCredentials: {
                merchantCode: "merchant-1",
                readerId: "reader-1",
                apiKey: "enc:v1:snapshot"
            }
        }))
        orderFindOneAndUpdateMock.mockReturnValue(query)
        posDeviceFindOneMock.mockReset()
        isEncryptedSecretMock.mockReturnValue(true)
        decryptSecretMock.mockReturnValue("snapshot-api-key")
        getByForeignMock.mockResolvedValue({ success: true, transaction })
        getByClientMock.mockResolvedValue({ success: true, transaction })

        const result = await recoverUncertainSumUpOrderById("order-1")

        expect(result).toMatchObject({ success: true, status: "PAID" })
        expect(query.select).toHaveBeenCalledWith(expect.stringContaining("+sumupRefundCredentials"))
        expect(posDeviceFindOneMock).not.toHaveBeenCalled()
        expect(getByForeignMock).toHaveBeenCalledWith(expect.objectContaining({
            merchantCode: "merchant-1",
            apiKey: "snapshot-api-key"
        }))
    })

    test("releases stock only after two explicit misses and an online idle reader", async () => {
        getByForeignMock.mockResolvedValue({ success: false, notFound: true, error: "not found" })
        getReaderStatusMock.mockResolvedValue({ success: true, status: "ONLINE", state: "IDLE" })

        const result = await recoverUncertainSumUpOrderById("order-1")

        expect(result).toEqual({
            success: true,
            status: "CANCELLED",
            message: "Nessuna transazione SumUp trovata: prenotazione scorte rilasciata e ordine annullato",
        })
        expect(getByForeignMock).toHaveBeenCalledTimes(2)
        expect(getReaderStatusMock).toHaveBeenCalledWith({
            merchantCode: "merchant-1",
            readerId: "reader-1",
            apiKey: "api-key-1",
        })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledWith({
            eventId: "event-1",
            orderId: "order-1",
            token: "SUMUP_RECOVERY_CANCEL:order-1",
            target: "REVERTED",
            adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }],
        })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: "order-1",
                status: "PENDING",
                sumupCheckoutId: "initiating:order-1",
                sumupWebhookClaimToken: expect.any(String),
            }),
            {
                $set: { status: "CANCELLED", sumupRecoveryCancelledAt: expect.any(Date) },
                $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 },
            },
        )
    })

    test("fails closed on a lookup error that is not an explicit 404", async () => {
        getByForeignMock.mockResolvedValue({ success: false, error: "SumUp unavailable" })

        await expect(recoverUncertainSumUpOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "SumUp unavailable",
        })
        expect(getReaderStatusMock).not.toHaveBeenCalled()
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
    })

    test("keeps the order reserved while the reader is busy or offline", async () => {
        getByForeignMock.mockResolvedValue({ success: false, notFound: true, error: "not found" })
        getReaderStatusMock.mockResolvedValue({ success: true, status: "ONLINE", state: "WAITING_FOR_CARD" })

        await expect(recoverUncertainSumUpOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Il reader SumUp non è online e libero: non è sicuro annullare l'ordine",
        })
        expect(getByForeignMock).toHaveBeenCalledOnce()
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
    })

    test("does not claim an order before the grace period expires", async () => {
        orderFindOneAndUpdateMock.mockReturnValue(claimQuery(null))
        orderFindOneMock.mockReturnValue(selectLean(recoverableOrder({
            sumupInitiatedAt: new Date("2026-08-12T11:20:00Z"),
        })))

        await expect(recoverUncertainSumUpOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Attendi almeno 15 minuti dall'avvio del pagamento prima del recupero",
        })
        expect(getByForeignMock).not.toHaveBeenCalled()
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
    })

    test("leaves the order pending when stock release fails", async () => {
        getByForeignMock.mockResolvedValue({ success: false, notFound: true, error: "not found" })
        getReaderStatusMock.mockResolvedValue({ success: true, status: "ONLINE", state: "IDLE" })
        transitionSumUpOrderStockMock.mockResolvedValue({ success: false, error: "stock busy" })

        await expect(recoverUncertainSumUpOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "stock busy",
        })
        expect(orderUpdateOneMock).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ $set: { status: "CANCELLED" } }),
        )
    })
})
