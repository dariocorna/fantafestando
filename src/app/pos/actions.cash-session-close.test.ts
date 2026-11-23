import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensurePosAccessMock,
    dbConnectMock,
    posDeviceFindOneMock,
    cashSessionFindOneMock,
    cashSessionFindOneAndUpdateMock,
    cashSessionUpdateOneMock,
    orderExistsMock,
} = vi.hoisted(() => ({
    ensurePosAccessMock: vi.fn(),
    dbConnectMock: vi.fn(),
    posDeviceFindOneMock: vi.fn(),
    cashSessionFindOneMock: vi.fn(),
    cashSessionFindOneAndUpdateMock: vi.fn(),
    cashSessionUpdateOneMock: vi.fn(),
    orderExistsMock: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }))
vi.mock("@/lib/pos-access", () => ({ ensurePosAccess: ensurePosAccessMock }))
vi.mock("@/models/PosDevice", () => ({ default: { findOne: posDeviceFindOneMock } }))
vi.mock("@/models/CashSession", () => ({ default: {
    findOne: cashSessionFindOneMock,
    findOneAndUpdate: cashSessionFindOneAndUpdateMock,
    updateOne: cashSessionUpdateOneMock,
} }))
vi.mock("@/models/Order", () => ({ default: { exists: orderExistsMock } }))
vi.mock("@/models/Product", () => ({ default: {} }))
vi.mock("@/models/Ingredient", () => ({ default: {} }))
vi.mock("@/models/PrintJob", () => ({ default: {} }))
vi.mock("@/models/Event", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({ PrinterService: {} }))
vi.mock("@/lib/sumup", () => ({ createSumUpCheckout: vi.fn() }))
vi.mock("@/lib/secrets", () => ({ decryptSecret: vi.fn() }))
vi.mock("@/lib/pizza-ticket", () => ({ resolveDishTicketsForCart: vi.fn() }))
vi.mock("@/lib/stock-operations", () => ({
    applyStockForPaidOrder: vi.fn(),
    planStockAdjustmentsForPayment: vi.fn(),
    rollbackStockAdjustments: vi.fn(),
}))
vi.mock("@/lib/cash-session-stock", () => ({
    transitionCashSessionStock: vi.fn(),
    transitionClaimedOrderStock: vi.fn(),
}))
vi.mock("@/lib/pos-stock-realtime", () => ({ publishStockInvalidation: vi.fn() }))
vi.mock("@/lib/cash-session-payment-claim", () => ({
    claimCashSessionPayment: vi.fn(),
    refreshCashSessionPaymentClaim: vi.fn(),
    releaseCashSessionPaymentClaim: vi.fn(),
    hasPendingSumUpCheckouts: vi.fn().mockResolvedValue(false),
    noActivePaymentClaim: vi.fn().mockReturnValue({ $or: [{ paymentClaim: null }] }),
}))

import { closeCashSession } from "@/app/pos/actions"

function posCapabilitiesQuery() {
    return {
        populate: vi.fn().mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    paymentTerminalId: { _id: "terminal-1", type: "SUMUP" },
                    cashBoxId: null,
                }),
            }),
        }),
    }
}

describe("closeCashSession", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensurePosAccessMock.mockResolvedValue({ ok: true, user: { id: "cashier-1", role: "CASHIER" } })
        posDeviceFindOneMock.mockReturnValue(posCapabilitiesQuery())
        cashSessionFindOneMock.mockResolvedValue({
            _id: "session-1",
            status: "OPEN",
            isTest: true,
            openingFloatAmount: 0,
        })
        cashSessionFindOneAndUpdateMock.mockResolvedValue({
            _id: "session-1",
            status: "OPEN",
            isTest: true,
            openingFloatAmount: 0,
            transition: { token: "transition-1", type: "CLOSE", status: "IN_PROGRESS", claimedAt: new Date() },
        })
        cashSessionUpdateOneMock.mockResolvedValue({ matchedCount: 1 })
    })

    test("blocks closing a TEST session when a late SumUp success still needs refund", async () => {
        orderExistsMock.mockResolvedValue({ _id: "order-1" })

        const result = await closeCashSession({
            eventId: "event-1",
            posDeviceId: "pos-1",
            closingCountedCashAmount: 0,
        })

        expect(result).toEqual({
            success: false,
            error: "La sessione TEST contiene pagamenti SumUp: stornali e rimborsali prima della chiusura",
        })
        expect(orderExistsMock).toHaveBeenCalledWith({
            cashSessionId: "session-1",
            $or: [
                {
                    status: "PAID",
                    $or: [
                        { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                        { sumupPaymentId: { $exists: true, $nin: [null, ""] } },
                    ],
                },
                {
                    status: "CANCELLED",
                    sumupLateSuccessDetectedAt: { $exists: true, $ne: null },
                    "stornoMeta.refundStatus": { $ne: "DONE" },
                },
            ],
        })
        expect(cashSessionUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: "session-1",
                "transition.type": "CLOSE",
            }),
            { $unset: { transition: 1 } },
        )
    })
})
