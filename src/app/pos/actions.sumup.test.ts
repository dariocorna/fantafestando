import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensurePosAccessMock,
    posDeviceFindOneMock,
    cashSessionFindOneMock,
    orderExistsMock,
    orderCreateMock,
    orderFindOneMock,
    orderUpdateOneMock,
    createSumUpCheckoutMock,
    decryptSecretMock,
    productFindMock,
    planStockAdjustmentsForPaymentMock,
    transitionSumUpOrderStockMock,
    claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaimMock
} = vi.hoisted(() => ({
    ensurePosAccessMock: vi.fn(),
    posDeviceFindOneMock: vi.fn(),
    cashSessionFindOneMock: vi.fn(),
    orderExistsMock: vi.fn(),
    orderCreateMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
    createSumUpCheckoutMock: vi.fn(),
    decryptSecretMock: vi.fn(),
    productFindMock: vi.fn(),
    planStockAdjustmentsForPaymentMock: vi.fn(),
    transitionSumUpOrderStockMock: vi.fn(),
    claimCashSessionPaymentMock: vi.fn(),
    refreshCashSessionPaymentClaimMock: vi.fn(),
    releaseCashSessionPaymentClaimMock: vi.fn()
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }))
vi.mock("@/lib/pos-access", () => ({ ensurePosAccess: ensurePosAccessMock }))
vi.mock("@/models/PosDevice", () => ({ default: { findOne: posDeviceFindOneMock } }))
vi.mock("@/models/CashSession", () => ({ default: { findOne: cashSessionFindOneMock } }))
vi.mock("@/models/Product", () => ({ default: { find: productFindMock } }))
vi.mock("@/models/Ingredient", () => ({ default: { find: vi.fn() } }))
vi.mock("@/models/Order", () => ({ default: {
    exists: orderExistsMock,
    create: orderCreateMock,
    findOne: orderFindOneMock,
    updateOne: orderUpdateOneMock
} }))
vi.mock("@/models/PrintJob", () => ({ default: {} }))
vi.mock("@/models/Event", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({ PrinterService: {} }))
vi.mock("@/lib/pizza-ticket", () => ({ resolveDishTicketsForCart: vi.fn() }))
vi.mock("@/lib/sumup", () => ({ createSumUpCheckout: createSumUpCheckoutMock }))
vi.mock("@/lib/secrets", () => ({ decryptSecret: decryptSecretMock }))
vi.mock("@/lib/stock-operations", () => ({
    applyStockForPaidOrder: vi.fn(),
    planStockAdjustmentsForPayment: planStockAdjustmentsForPaymentMock,
    rollbackStockAdjustments: vi.fn()
}))
vi.mock("@/lib/cash-session-payment-claim", () => ({
    claimCashSessionPayment: claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaim: refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaim: releaseCashSessionPaymentClaimMock,
    hasPendingSumUpCheckouts: vi.fn(),
    noActivePaymentClaim: vi.fn()
}))
vi.mock("@/lib/sumup-order-stock", () => ({ transitionSumUpOrderStock: transitionSumUpOrderStockMock }))
vi.mock("@/lib/pos-stock-realtime", () => ({ publishStockInvalidation: vi.fn() }))

import { completePendingOrderPayment, createOrder, triggerSumUpPayment } from "@/app/pos/actions"

function cashSessionQuery(session: unknown) {
    return {
        sort: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(session)
            })
        })
    }
}

function populatedCapabilities(type = "SUMUP") {
    return {
        populate: vi.fn().mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    paymentTerminalId: { _id: "terminal-1", type },
                    cashBoxId: null
                })
            })
        })
    }
}

function populatedSumUpTerminal() {
    return {
        populate: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue({
                name: "POS 1",
                paymentTerminalId: {
                    name: "SumUp Solo",
                    type: "SUMUP",
                    config: {
                        merchantCode: "merchant-1",
                        readerId: "reader-1",
                        apiKey: "enc-api-key",
                        affiliateAppId: "affiliate-app-1",
                        affiliateKey: "enc-affiliate-key"
                    }
                }
            })
        })
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
        status: "PENDING",
        totalAmount: 5,
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

describe("triggerSumUpPayment", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        posDeviceFindOneMock.mockReset()
        ensurePosAccessMock.mockResolvedValue({ ok: true, user: { id: "cashier-1", role: "CASHIER" } })
        cashSessionFindOneMock.mockReturnValue(cashSessionQuery({
            _id: { toString: () => "session-1" },
            openedAt: new Date("2026-08-12T00:00:00Z"),
            isTest: false
        }))
        orderExistsMock.mockResolvedValue({ _id: "order-1" })
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 })
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "claim-1", isTest: false })
        refreshCashSessionPaymentClaimMock.mockResolvedValue(true)
        releaseCashSessionPaymentClaimMock.mockResolvedValue(undefined)
        planStockAdjustmentsForPaymentMock.mockResolvedValue({
            success: true,
            adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }]
        })
        transitionSumUpOrderStockMock.mockResolvedValue({ success: true })
        decryptSecretMock.mockImplementation((value?: string) => {
            if (value === "enc-api-key") return "api-key-1"
            if (value === "enc-affiliate-key") return "affiliate-key-1"
            return undefined
        })
    })

    test("creates a reader checkout using the configured terminal and order id", async () => {
        posDeviceFindOneMock
            .mockReturnValueOnce({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            paymentTerminalId: { _id: "terminal-1", type: "SUMUP" },
                            cashBoxId: null
                        })
                    })
                })
            })
            .mockReturnValueOnce({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        name: "POS 1",
                        paymentTerminalId: {
                            name: "SumUp Solo",
                            type: "SUMUP",
                            config: {
                                merchantCode: "merchant-1",
                                readerId: "reader-1",
                                apiKey: "enc-api-key",
                                affiliateAppId: "affiliate-app-1",
                                affiliateKey: "enc-affiliate-key"
                            }
                        }
                    })
                })
            })
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })

        const result = await triggerSumUpPayment(12.5, "event-1", "pos-1", "order-1")

        expect(result).toEqual({ success: true, checkoutId: "client-tx-1" })
        expect(orderExistsMock).toHaveBeenCalledWith({
            _id: "order-1",
            eventId: "event-1",
            posDeviceId: "pos-1",
            status: "PENDING",
            sumupCheckoutId: "initiating:order-1"
        })
        expect(createSumUpCheckoutMock).toHaveBeenCalledWith({
            amount: 12.5,
            currency: "EUR",
            merchantCode: "merchant-1",
            readerId: "reader-1",
            apiKey: "api-key-1",
            affiliateAppId: "affiliate-app-1",
            affiliateKey: "affiliate-key-1",
            foreignTransactionId: "order-1"
        })
    })

    test("rejects a terminal missing the new SumUp configuration shape", async () => {
        posDeviceFindOneMock
            .mockReturnValueOnce({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            paymentTerminalId: { _id: "terminal-1", type: "SUMUP" },
                            cashBoxId: null
                        })
                    })
                })
            })
            .mockReturnValueOnce({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        paymentTerminalId: {
                            name: "SumUp Solo",
                            type: "SUMUP",
                            config: {
                                merchantCode: "merchant-1",
                                apiKey: "enc-api-key"
                            }
                        }
                    })
                })
            })

        const result = await triggerSumUpPayment(12.5, "event-1", "pos-1", "order-1")

        expect(result).toEqual({
            success: false,
            error: "Configurazione SumUp mancante nella periferica associata alla cassa"
        })
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
    })

    test("does not call SumUp for a TEST cash session", async () => {
        cashSessionFindOneMock.mockReturnValue(cashSessionQuery({
            _id: { toString: () => "session-1" },
            openedAt: new Date("2026-08-12T00:00:00Z"),
            isTest: true
        }))

        const result = await triggerSumUpPayment(12.5, "event-1", "pos-1", "order-1")

        expect(result).toEqual({
            success: false,
            error: "I pagamenti sul terminale SumUp sono bloccati nelle sessioni TEST"
        })
        expect(posDeviceFindOneMock).not.toHaveBeenCalled()
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
    })

    test("does not call SumUp unless the order owns the initiation marker", async () => {
        orderExistsMock.mockResolvedValue(null)
        posDeviceFindOneMock
            .mockReturnValueOnce({
                populate: vi.fn().mockReturnValue({
                    populate: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue({
                            paymentTerminalId: { _id: "terminal-1", type: "SUMUP" },
                            cashBoxId: null
                        })
                    })
                })
            })
            .mockReturnValueOnce({
                populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({}) })
            })

        const result = await triggerSumUpPayment(12.5, "event-1", "pos-1", "order-1")

        expect(result).toEqual({ success: false, error: "Ordine SumUp non preparato" })
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
    })
})

describe("createOrder SumUp lifecycle", () => {
    const order = { _id: { toString: () => "order-1" }, status: "PENDING" }
    const orderInput = {
        eventId: "event-1",
        customer: {},
        totalAmount: 5,
        cart: [{ productId: "product-1", snapshotName: "Panino", quantity: 1, selectedOptions: [] }],
        paymentMethod: "CARD" as const,
        posDeviceId: "pos-1"
    }

    beforeEach(() => {
        vi.clearAllMocks()
        posDeviceFindOneMock.mockReset()
        ensurePosAccessMock.mockResolvedValue({ ok: true, user: { id: "cashier-1", role: "CASHIER" } })
        cashSessionFindOneMock.mockReturnValue(cashSessionQuery({
            _id: { toString: () => "session-1" },
            openedAt: new Date("2026-08-12T00:00:00Z"),
            isTest: false
        }))
        posDeviceFindOneMock
            .mockReturnValueOnce(populatedCapabilities())
            .mockReturnValueOnce(populatedCapabilities())
            .mockReturnValueOnce(populatedSumUpTerminal())
        productFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([{
                    _id: "product-1",
                    name: "Panino",
                    basePrice: 5,
                    kind: "STANDARD",
                    salesChannels: ["POS", "MENU"],
                    variants: [],
                    recipeItems: []
                }])
            })
        })
        orderCreateMock.mockResolvedValue(order)
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 })
        orderExistsMock.mockResolvedValue({ _id: "order-1" })
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "claim-1", isTest: false })
        refreshCashSessionPaymentClaimMock.mockResolvedValue(true)
        releaseCashSessionPaymentClaimMock.mockResolvedValue(undefined)
        planStockAdjustmentsForPaymentMock.mockResolvedValue({
            success: true,
            adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }]
        })
        transitionSumUpOrderStockMock.mockResolvedValue({ success: true })
        decryptSecretMock.mockImplementation((value?: string) => value === "enc-api-key"
            ? "api-key-1"
            : value === "enc-affiliate-key" ? "affiliate-key-1" : undefined)
    })

    test("reserves stock, persists the marker and links the accepted checkout", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })

        const result = await createOrder(orderInput)

        expect(result).toMatchObject({ success: true, paymentCompleted: false, paymentPending: true })
        expect(orderCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            status: "PENDING",
            stockEffectStatus: "REVERTED",
            stockAdjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }]
        }))
        expect(orderUpdateOneMock).toHaveBeenNthCalledWith(
            1,
            { _id: order._id, eventId: "event-1", status: "PENDING" },
            { $set: { sumupCheckoutId: "initiating:order-1", sumupInitiatedAt: expect.any(Date) } }
        )
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledWith({
            eventId: "event-1",
            orderId: "order-1",
            token: "SUMUP_RESERVE:order-1",
            target: "APPLIED",
            adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }]
        })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({ sumupCheckoutId: "initiating:order-1" }),
            { $set: { sumupCheckoutId: "client-tx-1" } }
        )
    })

    test("releases reserved stock and cancels a definite checkout rejection", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: false, error: "reader offline", uncertain: false })

        const result = await createOrder(orderInput)

        expect(result).toMatchObject({ success: false, error: "reader offline" })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledTimes(2)
        expect(transitionSumUpOrderStockMock).toHaveBeenLastCalledWith(expect.objectContaining({
            token: "SUMUP_RELEASE:order-1",
            target: "REVERTED"
        }))
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: order._id, eventId: "event-1", status: "PENDING" },
            { $set: { status: "CANCELLED" } }
        )
    })

    test("keeps the reservation and marker for an uncertain checkout", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: false, error: "timeout", uncertain: true })

        const result = await createOrder(orderInput)

        expect(result).toMatchObject({ success: true, paymentCompleted: false, paymentUncertain: true })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledOnce()
        expect(orderUpdateOneMock).not.toHaveBeenCalledWith(
            expect.anything(),
            { $set: { status: "CANCELLED" } }
        )
    })

    test("treats a checkout-link conflict as uncertain without releasing stock", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })
        orderUpdateOneMock
            .mockResolvedValueOnce({ acknowledged: true, matchedCount: 1 })
            .mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 })

        const result = await createOrder(orderInput)

        expect(result).toMatchObject({ success: true, paymentCompleted: false, paymentUncertain: true })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledOnce()
    })

    test("treats a late checkout-link write failure as uncertain", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })
        orderUpdateOneMock
            .mockResolvedValueOnce({ acknowledged: true, matchedCount: 1 })
            .mockRejectedValueOnce(new Error("write failed"))

        const result = await createOrder(orderInput)

        expect(result).toMatchObject({ success: true, orderId: "order-1", paymentCompleted: false, paymentUncertain: true })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledOnce()
    })
})

describe("completePendingOrderPayment SumUp lifecycle", () => {
    let order: ReturnType<typeof pendingOrder>

    beforeEach(() => {
        vi.clearAllMocks()
        posDeviceFindOneMock.mockReset()
        order = pendingOrder()
        ensurePosAccessMock.mockResolvedValue({ ok: true, user: { id: "cashier-1", role: "CASHIER" } })
        cashSessionFindOneMock.mockReturnValue(cashSessionQuery({
            _id: { toString: () => "session-1" },
            openedAt: new Date("2026-08-12T00:00:00Z"),
            isTest: false
        }))
        posDeviceFindOneMock
            .mockReturnValueOnce(populatedCapabilities())
            .mockReturnValueOnce(populatedCapabilities())
            .mockReturnValueOnce(populatedSumUpTerminal())
        productFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([{
                    _id: "product-1",
                    name: "Panino",
                    basePrice: 5,
                    kind: "STANDARD",
                    salesChannels: ["POS", "MENU"],
                    variants: [],
                    recipeItems: []
                }])
            })
        })
        orderFindOneMock.mockResolvedValue(order)
        orderExistsMock.mockResolvedValue({ _id: "order-1" })
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 })
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "claim-1", isTest: false })
        refreshCashSessionPaymentClaimMock.mockResolvedValue(true)
        releaseCashSessionPaymentClaimMock.mockResolvedValue(undefined)
        planStockAdjustmentsForPaymentMock.mockResolvedValue({
            success: true,
            adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }]
        })
        transitionSumUpOrderStockMock.mockResolvedValue({ success: true })
        decryptSecretMock.mockImplementation((value?: string) => value === "enc-api-key"
            ? "api-key-1"
            : value === "enc-affiliate-key" ? "affiliate-key-1" : undefined)
    })

    test("reserves stock and links the checkout for an existing pending order", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CARD",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: true, paymentCompleted: false, paymentPending: true })
        expect(order.save).toHaveBeenCalledOnce()
        expect(order.set).toHaveBeenCalledWith("sumupCheckoutId", "initiating:order-1")
        expect(order.set).toHaveBeenCalledWith("sumupInitiatedAt", expect.any(Date))
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledWith({
            eventId: "event-1",
            orderId: "order-1",
            token: "SUMUP_RESERVE:order-1",
            target: "APPLIED",
            adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }]
        })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({ sumupCheckoutId: "initiating:order-1" }),
            { $set: { sumupCheckoutId: "client-tx-1" } }
        )
    })

    test("blocks the reader before planning stock in a TEST session", async () => {
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "claim-1", isTest: true })

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CARD",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("TEST") })
        expect(planStockAdjustmentsForPaymentMock).not.toHaveBeenCalled()
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
        expect(order.save).not.toHaveBeenCalled()
    })

    test("releases stock and removes the marker after a definite rejection", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: false, error: "reader offline", uncertain: false })

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CARD",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: false, error: "reader offline" })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledTimes(2)
        expect(transitionSumUpOrderStockMock).toHaveBeenLastCalledWith(expect.objectContaining({
            token: "SUMUP_RELEASE:order-1",
            target: "REVERTED"
        }))
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({ sumupCheckoutId: "initiating:order-1" }),
            { $unset: { sumupCheckoutId: 1 } }
        )
    })

    test("keeps the pending order protected when the checkout outcome is uncertain", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: false, error: "timeout", uncertain: true })

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CARD",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: true, paymentCompleted: false, paymentUncertain: true })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledOnce()
        expect(orderUpdateOneMock).not.toHaveBeenCalledWith(
            expect.anything(),
            { $unset: { sumupCheckoutId: 1 } }
        )
    })

    test("treats a failed release after a definite rejection as uncertain", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: false, error: "reader offline", uncertain: false })
        transitionSumUpOrderStockMock
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: "release failed" })

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CARD",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: true, orderId: "order-1", paymentCompleted: false, paymentUncertain: true })
        expect(orderUpdateOneMock).not.toHaveBeenCalledWith(
            expect.anything(),
            { $unset: { sumupCheckoutId: 1 } }
        )
    })

    test("treats a late checkout-link write failure as uncertain", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })
        orderUpdateOneMock.mockRejectedValueOnce(new Error("write failed"))

        const result = await completePendingOrderPayment({
            eventId: "event-1",
            orderId: "order-1",
            paymentMethod: "CARD",
            posDeviceId: "pos-1"
        })

        expect(result).toMatchObject({ success: true, orderId: "order-1", paymentCompleted: false, paymentUncertain: true })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledOnce()
    })
})
