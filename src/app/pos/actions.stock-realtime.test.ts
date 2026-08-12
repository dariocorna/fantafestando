import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensurePosAccessMock,
    posDeviceFindOneMock,
    cashSessionFindOneMock,
    productFindMock,
    orderCreateMock,
    orderFindOneMock,
    orderExistsMock,
    applyStockForPaidOrderMock,
    planStockAdjustmentsForPaymentMock,
    transitionSumUpOrderStockMock,
    rollbackStockAdjustmentsMock,
    claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaimMock,
    routeOrderToPrintersMock,
    publishStockInvalidationMock
} = vi.hoisted(() => ({
    ensurePosAccessMock: vi.fn(),
    posDeviceFindOneMock: vi.fn(),
    cashSessionFindOneMock: vi.fn(),
    productFindMock: vi.fn(),
    orderCreateMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderExistsMock: vi.fn(),
    applyStockForPaidOrderMock: vi.fn(),
    planStockAdjustmentsForPaymentMock: vi.fn(),
    transitionSumUpOrderStockMock: vi.fn(),
    rollbackStockAdjustmentsMock: vi.fn(),
    claimCashSessionPaymentMock: vi.fn(),
    refreshCashSessionPaymentClaimMock: vi.fn(),
    releaseCashSessionPaymentClaimMock: vi.fn(),
    routeOrderToPrintersMock: vi.fn(),
    publishStockInvalidationMock: vi.fn()
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }))
vi.mock("@/lib/pos-access", () => ({ ensurePosAccess: ensurePosAccessMock }))
vi.mock("@/models/PosDevice", () => ({ default: { findOne: posDeviceFindOneMock } }))
vi.mock("@/models/CashSession", () => ({ default: { findOne: cashSessionFindOneMock } }))
vi.mock("@/models/Product", () => ({ default: { find: productFindMock } }))
vi.mock("@/models/Ingredient", () => ({ default: { find: vi.fn() } }))
vi.mock("@/models/Order", () => ({
    default: {
        create: orderCreateMock,
        findOne: orderFindOneMock,
        exists: orderExistsMock
    }
}))
vi.mock("@/models/PrintJob", () => ({ default: {} }))
vi.mock("@/models/Event", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({
    PrinterService: { routeOrderToPrinters: routeOrderToPrintersMock }
}))
vi.mock("@/lib/pizza-ticket", () => ({ resolveDishTicketsForCart: vi.fn().mockResolvedValue([]) }))
vi.mock("@/lib/sumup", () => ({ createSumUpCheckout: vi.fn() }))
vi.mock("@/lib/secrets", () => ({ decryptSecret: vi.fn() }))
vi.mock("@/lib/stock-operations", () => ({
    applyStockForPaidOrder: applyStockForPaidOrderMock,
    planStockAdjustmentsForPayment: planStockAdjustmentsForPaymentMock,
    rollbackStockAdjustments: rollbackStockAdjustmentsMock
}))
vi.mock("@/lib/sumup-order-stock", () => ({ transitionSumUpOrderStock: transitionSumUpOrderStockMock }))
vi.mock("@/lib/cash-session-payment-claim", () => ({
    claimCashSessionPayment: claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaim: refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaim: releaseCashSessionPaymentClaimMock,
    hasPendingSumUpCheckouts: vi.fn(),
    noActivePaymentClaim: vi.fn()
}))
vi.mock("@/lib/pos-stock-realtime", () => ({ publishStockInvalidation: publishStockInvalidationMock }))

import { completePendingOrderPayment, createOrder } from "@/app/pos/actions"

const product = {
    _id: { toString: () => "product-1" },
    name: "Panino",
    basePrice: 5,
    kind: "STANDARD",
    salesChannels: ["POS", "MENU"],
    variants: [],
    recipeItems: []
}

function queryResult(value: unknown) {
    return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) }
}

function paidOrder() {
    return {
        _id: { toString: () => "order-1" },
        status: "PAID"
    }
}

function pendingOrder() {
    const order: Record<string, unknown> & {
        _id: { toString(): string }
        cart: Array<Record<string, unknown>>
        ingredientPlan: never[]
        dishTickets: never[]
        pricingMode: "STANDARD"
        set: ReturnType<typeof vi.fn>
        save: ReturnType<typeof vi.fn>
    } = {
        _id: { toString: () => "order-1" },
        cart: [{
            productId: { toString: () => "product-1" },
            snapshotName: "Panino",
            quantity: 1,
            selectedOptions: [],
            includedComponents: []
        }],
        ingredientPlan: [],
        dishTickets: [],
        pricingMode: "STANDARD",
        set: vi.fn((field: string, value: unknown) => { order[field] = value }),
        save: vi.fn().mockResolvedValue(undefined)
    }
    return order
}

describe("paid POS stock invalidations", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensurePosAccessMock.mockResolvedValue({ ok: true, user: { id: "cashier-1", role: "CASHIER" } })
        posDeviceFindOneMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({ cashBoxId: { _id: "cash-box-1" } })
                })
            })
        })
        cashSessionFindOneMock.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        _id: { toString: () => "session-1" },
                        openedAt: new Date("2026-08-12T00:00:00Z"),
                        isTest: false
                    })
                })
            })
        })
        productFindMock.mockReturnValue(queryResult([product]))
        applyStockForPaidOrderMock.mockResolvedValue({
            success: true,
            appliedAdjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }]
        })
        planStockAdjustmentsForPaymentMock.mockResolvedValue({ success: true, adjustments: [] })
        transitionSumUpOrderStockMock.mockResolvedValue({ success: true })
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "claim-1", isTest: false })
        refreshCashSessionPaymentClaimMock.mockResolvedValue(true)
        releaseCashSessionPaymentClaimMock.mockResolvedValue(undefined)
        routeOrderToPrintersMock.mockResolvedValue([])
        orderExistsMock.mockResolvedValue({ _id: "order-1" })
    })

    test("publishes after creating an immediately paid order", async () => {
        orderCreateMock.mockResolvedValue(paidOrder())

        const result = await createOrder({
            eventId: "event-1",
            customer: {},
            totalAmount: 5,
            cart: [{ productId: "product-1", snapshotName: "Panino", quantity: 1, selectedOptions: [] }],
            paymentMethod: "CASH",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: true, paymentCompleted: true })
        expect(publishStockInvalidationMock).toHaveBeenCalledWith("event-1")
    })

    test("does not publish when paid-order persistence fails and stock is rolled back", async () => {
        orderCreateMock.mockRejectedValue(new Error("write failed"))

        const result = await createOrder({
            eventId: "event-1",
            customer: {},
            totalAmount: 5,
            cart: [{ productId: "product-1", snapshotName: "Panino", quantity: 1, selectedOptions: [] }],
            paymentMethod: "CASH",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: false })
        expect(rollbackStockAdjustmentsMock).toHaveBeenCalled()
        expect(publishStockInvalidationMock).not.toHaveBeenCalled()
    })

    test("publishes after a pending order is persisted as paid", async () => {
        const order = pendingOrder()
        orderFindOneMock.mockResolvedValue(order)

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CASH",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: true, orderId: "order-1" })
        expect(order.save).toHaveBeenCalledOnce()
        expect(publishStockInvalidationMock).toHaveBeenCalledWith("event-1")
    })

    test("does not manually complete a pending order linked to SumUp", async () => {
        const order = pendingOrder()
        order.sumupCheckoutId = "checkout-1"
        orderFindOneMock.mockResolvedValue(order)

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CASH",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("SumUp") })
        expect(claimCashSessionPaymentMock).not.toHaveBeenCalled()
        expect(applyStockForPaidOrderMock).not.toHaveBeenCalled()
        expect(order.save).not.toHaveBeenCalled()
    })

    test("does not manually complete a pending order with a certified SumUp payment", async () => {
        const order = pendingOrder()
        order.sumupPaymentId = "payment-1"
        orderFindOneMock.mockResolvedValue(order)

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CASH",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("SumUp") })
        expect(claimCashSessionPaymentMock).not.toHaveBeenCalled()
        expect(applyStockForPaidOrderMock).not.toHaveBeenCalled()
        expect(order.save).not.toHaveBeenCalled()
    })

    test("rechecks the pending order after claiming the cash session", async () => {
        const order = pendingOrder()
        orderFindOneMock.mockResolvedValue(order)
        orderExistsMock.mockResolvedValueOnce(null)

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CASH",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("SumUp") })
        expect(orderExistsMock).toHaveBeenCalledWith({
            _id: "order-1",
            eventId: "event-1",
            status: "PENDING",
            $nor: [
                { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
            ]
        })
        expect(releaseCashSessionPaymentClaimMock).toHaveBeenCalledWith("session-1", "claim-1")
        expect(applyStockForPaidOrderMock).not.toHaveBeenCalled()
        expect(order.save).not.toHaveBeenCalled()
    })
})
