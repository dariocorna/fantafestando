import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensureAdminSessionMock,
    getAdminContextEventIdMock,
    orderFindOneAndUpdateMock,
    orderUpdateOneMock,
    transitionClaimedOrderStockMock,
    posFindOneMock,
    resolveTransactionMock,
    refundSumUpTransactionMock
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    orderFindOneAndUpdateMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
    transitionClaimedOrderStockMock: vi.fn(),
    posFindOneMock: vi.fn(),
    resolveTransactionMock: vi.fn(),
    refundSumUpTransactionMock: vi.fn()
}))

vi.mock("@/lib/authz", () => ({ ensureAdminSession: ensureAdminSessionMock }))
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }))
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }))
vi.mock("@/models/Order", () => ({ default: {
    findOneAndUpdate: orderFindOneAndUpdateMock,
    updateOne: orderUpdateOneMock
} }))
vi.mock("@/models/OrderCounter", () => ({ default: {} }))
vi.mock("@/models/PrintJob", () => ({ default: {} }))
vi.mock("@/models/CashSession", () => ({ default: {} }))
vi.mock("@/models/PosDevice", () => ({ default: { findOne: posFindOneMock } }))
vi.mock("@/models/Peripheral", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({ PrinterService: {} }))
vi.mock("@/lib/secrets", () => ({ decryptSecret: () => "test-key" }))
vi.mock("@/lib/sumup", () => ({
    refundSumUpTransaction: refundSumUpTransactionMock,
    resolveSumUpTransactionIdByCheckout: resolveTransactionMock
}))
vi.mock("@/lib/cash-session-stock", () => ({ transitionClaimedOrderStock: transitionClaimedOrderStockMock }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { stornoPaidOrderById } from "./actions"

describe("stornoPaidOrderById stock claim", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensureAdminSessionMock.mockResolvedValue({ ok: true })
        getAdminContextEventIdMock.mockResolvedValue("event-1")
        orderUpdateOneMock.mockResolvedValue({ matchedCount: 1 })
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
            .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(lockedOrder) })
            .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) })

        const result = await stornoPaidOrderById("order-1")

        expect(result).toEqual({ success: false, error: "Modifica scorte già in corso per questo ordine: riprova tra poco" })
        expect(transitionClaimedOrderStockMock).not.toHaveBeenCalled()
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({ "stornoMeta.status": "IN_PROGRESS" }),
            expect.objectContaining({ $set: expect.objectContaining({ "stornoMeta.status": "FAILED" }) })
        )
    })
})

describe("stornoPaidOrderById electronic refunds", () => {
    const adjustment = { entityType: "PRODUCT", entityId: "p1", quantity: 1 }
    const order = {
        _id: "order-1", paymentMethod: "CARD", posDeviceId: "pos-1", totalAmount: 10,
        cart: [], stockAdjustments: [adjustment], stockEffectStatus: "APPLIED"
    }

    beforeEach(() => {
        vi.clearAllMocks()
        ensureAdminSessionMock.mockResolvedValue({ ok: true })
        getAdminContextEventIdMock.mockResolvedValue("event-1")
        transitionClaimedOrderStockMock.mockResolvedValue({ success: true })
        orderUpdateOneMock.mockResolvedValue({ matchedCount: 1 })
    })

    test("cancels a manual payment after a previous failed attempt and restores its stock", async () => {
        const manualOrder = { ...order, stornoMeta: { refundRequired: true, refundStatus: "FAILED" } }
        orderFindOneAndUpdateMock.mockReturnValue({ lean: async () => manualOrder })

        expect(await stornoPaidOrderById("order-1")).toMatchObject({ success: true, manualCardPayment: true })
        expect(posFindOneMock).not.toHaveBeenCalled()
        expect(resolveTransactionMock).not.toHaveBeenCalled()
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
        expect(transitionClaimedOrderStockMock).toHaveBeenCalledWith(expect.objectContaining({
            adjustments: [adjustment], target: "REVERTED"
        }))
        expect(orderUpdateOneMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            $set: expect.objectContaining({
                status: "CANCELLED", "stornoMeta.refundStatus": "SKIPPED", "stornoMeta.refundRequired": false
            }),
            $unset: expect.objectContaining({ stockEffectClaim: 1, "stornoMeta.refundError": 1 })
        }))
    })

    test.each([
        { sumupPaymentId: "transaction-1" },
        { sumupCheckoutId: "checkout-1" }
    ])("keeps a SumUp order paid when its refund fails (%j)", async (reference) => {
        orderFindOneAndUpdateMock.mockReturnValue({ lean: async () => ({ ...order, ...reference }) })
        posFindOneMock.mockReturnValue({ populate: () => ({ lean: async () => ({
            paymentTerminalId: { type: "SUMUP", config: { affiliateKey: "test" } }
        }) }) })
        resolveTransactionMock.mockResolvedValue({ success: true, transactionId: "transaction-1" })
        refundSumUpTransactionMock.mockResolvedValue({ success: false, error: "Rimborso rifiutato" })

        expect(await stornoPaidOrderById("order-1")).toMatchObject({ success: false })
        expect(refundSumUpTransactionMock).toHaveBeenCalledWith({
            transactionId: "transaction-1", amount: 10, apiKey: "test-key"
        })
        expect(transitionClaimedOrderStockMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).toHaveBeenCalledWith(expect.anything(), {
            $set: expect.objectContaining({ "stornoMeta.refundStatus": "FAILED", "stornoMeta.refundRequired": true })
        })
    })

    test("completes a previously refunded order with only a persisted refund transaction", async () => {
        const refunded = { ...order, stornoMeta: { refundStatus: "DONE", refundTransactionId: "transaction-1" } }
        orderFindOneAndUpdateMock.mockReturnValue({ lean: async () => refunded })

        expect(await stornoPaidOrderById("order-1")).toMatchObject({ success: true, manualCardPayment: false })
        expect(refundSumUpTransactionMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            $set: expect.objectContaining({
                status: "CANCELLED", "stornoMeta.refundStatus": "DONE", "stornoMeta.refundRequired": true
            })
        }))
    })
})
