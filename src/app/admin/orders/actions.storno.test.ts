import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensureAdminSessionMock,
    getAdminContextEventIdMock,
    orderFindOneAndUpdateMock,
    orderUpdateOneMock,
    transitionClaimedOrderStockMock,
    refundSumUpTransactionMock
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    orderFindOneAndUpdateMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
    transitionClaimedOrderStockMock: vi.fn(),
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
vi.mock("@/models/PosDevice", () => ({ default: {} }))
vi.mock("@/models/Peripheral", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({ PrinterService: {} }))
vi.mock("@/lib/secrets", () => ({ decryptSecret: vi.fn() }))
vi.mock("@/lib/sumup", () => ({
    refundSumUpTransaction: refundSumUpTransactionMock,
    resolveSumUpTransactionIdByCheckout: vi.fn()
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
