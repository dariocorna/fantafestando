import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensurePosAccessMock,
    posDeviceFindOneMock,
    cashSessionFindOneMock,
    productFindMock,
    orderCreateMock,
    orderFindOneMock,
    applyStockForPaidOrderMock,
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
    applyStockForPaidOrderMock: vi.fn(),
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
        findOne: orderFindOneMock
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
    validateStockForPendingOrder: vi.fn(),
    rollbackStockAdjustments: rollbackStockAdjustmentsMock
}))
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

describe("paid POS orders", () => {
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
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "claim-1", isTest: false })
        refreshCashSessionPaymentClaimMock.mockResolvedValue(true)
        releaseCashSessionPaymentClaimMock.mockResolvedValue(undefined)
        routeOrderToPrintersMock.mockResolvedValue([])
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

    describe("menu-only products in pending web orders", () => {
        const line = { productId: "product-1", snapshotName: "Panino", quantity: 1, selectedOptions: [] }
        const payment = { eventId: "event-1", posDeviceId: "pos-1", paymentMethod: "CASH" as const }
        const menuOnly = { ...product, salesChannels: ["MENU"] }

        beforeEach(() => {
            const order = pendingOrder()
            order.pickupNumber = 12
            orderFindOneMock.mockResolvedValue(order)
            productFindMock.mockReturnValue(queryResult([menuOnly]))
        })

        test("accepts an existing web line together with a new POS-only product", async () => {
            const extra = { ...product, _id: "product-2", name: "Bibita", salesChannels: ["POS"] }
            productFindMock.mockReturnValue(queryResult([menuOnly, extra]))
            const result = await completePendingOrderPayment({
                ...payment, orderId: "order-1", totalAmount: 10,
                cart: [line, { ...line, productId: "product-2", snapshotName: "Bibita" }]
            })

            expect(result).toMatchObject({ success: true })
            expect(applyStockForPaidOrderMock).toHaveBeenCalledOnce()
        })

        const rejectedCarts: Array<[string, NonNullable<Parameters<typeof completePendingOrderPayment>[0]["cart"]>]> = [
            ["larger quantity", [{ ...line, quantity: 2 }]],
            ["duplicate line", [line, line]],
            ["different variant", [{ ...line, selectedOptions: [{ name: "Extra", priceVariation: 0 }] }]],
            ["different menu choice", [{ ...line, menuSelections: [{ groupId: "side", productId: "p2" }] }]],
            ["different product", [{ ...line, productId: "product-2" }]]
        ]
        test.each(rejectedCarts)("rejects a %s outside the persisted cart", async (_, cart) => {
            if (cart[0].productId === "product-2") {
                productFindMock.mockReturnValue(queryResult([{ ...menuOnly, _id: "product-2" }]))
            }
            const result = await completePendingOrderPayment({
                ...payment, orderId: "order-1", cart
            })

            expect(result).toMatchObject({ success: false, error: "Alcuni prodotti non sono disponibili nel POS" })
            expect(applyStockForPaidOrderMock).not.toHaveBeenCalled()
        })

        test("keeps menu-only items out of direct POS sales and POS-origin pending orders", async () => {
            const direct = await createOrder({ ...payment, customer: {}, totalAmount: 5, cart: [line] })
            orderFindOneMock.mockResolvedValue(pendingOrder())
            const pending = await completePendingOrderPayment({ ...payment, orderId: "order-1", cart: [line] })

            expect(direct).toMatchObject({ success: false, error: "Alcuni prodotti non sono disponibili nel POS" })
            expect(pending).toMatchObject({ success: false, error: "Alcuni prodotti non sono disponibili nel POS" })
            expect(applyStockForPaidOrderMock).not.toHaveBeenCalled()
        })
    })
})
