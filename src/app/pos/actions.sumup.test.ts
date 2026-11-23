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
    encryptSecretMock,
    productFindMock,
    planStockAdjustmentsForPaymentMock,
    transitionSumUpOrderStockMock,
    claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaimMock,
    claimSumUpEventOperationMock,
    releaseSumUpEventOperationMock,
    refreshSumUpEventOperationMock,
    startSumUpEventOperationHeartbeatMock,
    ensureEventOperationOwnedMock,
    stopEventOperationHeartbeatMock
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
    encryptSecretMock: vi.fn(),
    productFindMock: vi.fn(),
    planStockAdjustmentsForPaymentMock: vi.fn(),
    transitionSumUpOrderStockMock: vi.fn(),
    claimCashSessionPaymentMock: vi.fn(),
    refreshCashSessionPaymentClaimMock: vi.fn(),
    releaseCashSessionPaymentClaimMock: vi.fn(),
    claimSumUpEventOperationMock: vi.fn(),
    releaseSumUpEventOperationMock: vi.fn(),
    refreshSumUpEventOperationMock: vi.fn(),
    startSumUpEventOperationHeartbeatMock: vi.fn(),
    ensureEventOperationOwnedMock: vi.fn(),
    stopEventOperationHeartbeatMock: vi.fn()
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
vi.mock("@/lib/sumup-event-operation", () => ({
    claimSumUpEventOperation: claimSumUpEventOperationMock,
    releaseSumUpEventOperation: releaseSumUpEventOperationMock,
    refreshSumUpEventOperation: refreshSumUpEventOperationMock,
    startSumUpEventOperationHeartbeat: startSumUpEventOperationHeartbeatMock
}))
vi.mock("@/lib/secrets", () => ({
    decryptSecret: decryptSecretMock,
    encryptSecret: encryptSecretMock,
    isEncryptedSecret: vi.fn()
}))
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

function setupOrderPayment() {
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
}

const orderInput = {
    eventId: "event-1",
    customer: {},
    totalAmount: 5,
    cart: [{ productId: "product-1", snapshotName: "Panino", quantity: 1, selectedOptions: [] }],
    paymentMethod: "CARD" as const,
    posDeviceId: "pos-1"
}
const pendingPaymentInput = {
    eventId: "event-1",
    orderId: "order-1",
    paymentMethod: "CARD" as const,
    posDeviceId: "pos-1"
}

beforeEach(() => {
    vi.resetAllMocks()
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
    claimSumUpEventOperationMock.mockResolvedValue("event-claim-1")
    releaseSumUpEventOperationMock.mockResolvedValue(undefined)
    refreshSumUpEventOperationMock.mockResolvedValue(true)
    ensureEventOperationOwnedMock.mockResolvedValue(true)
    startSumUpEventOperationHeartbeatMock.mockReturnValue({
        ensureOwned: ensureEventOperationOwnedMock,
        stop: stopEventOperationHeartbeatMock
    })
    planStockAdjustmentsForPaymentMock.mockResolvedValue({
        success: true,
        adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }]
    })
    transitionSumUpOrderStockMock.mockResolvedValue({ success: true })
    encryptSecretMock.mockReturnValue("enc:v1:ciphertext")
    decryptSecretMock.mockImplementation((value?: string) => {
        if (value === "enc-api-key") return "api-key-1"
        if (value === "enc-affiliate-key") return "affiliate-key-1"
        return undefined
    })
})

describe("triggerSumUpPayment", () => {
    test("creates a reader checkout using the configured terminal and order id", async () => {
        posDeviceFindOneMock
            .mockReturnValueOnce(populatedCapabilities())
            .mockReturnValueOnce(populatedSumUpTerminal())
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })

        const result = await triggerSumUpPayment(12.5, "event-1", "pos-1", "order-1")

        expect(result).toEqual({ success: true, checkoutId: "client-tx-1" })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            {
                _id: "order-1",
                eventId: "event-1",
                posDeviceId: "pos-1",
                status: "PENDING",
                sumupCheckoutId: "initiating:order-1",
                sumupRefundCredentials: { $exists: false }
            },
            {
                $set: {
                    sumupRefundCredentials: {
                        merchantCode: "merchant-1",
                        readerId: "reader-1",
                        apiKey: "enc:v1:ciphertext"
                    }
                }
            }
        )
        expect(encryptSecretMock).toHaveBeenCalledWith("enc-api-key")
        expect(JSON.stringify(orderUpdateOneMock.mock.calls[0])).not.toContain('"apiKey":"api-key-1"')
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
        expect(claimSumUpEventOperationMock).toHaveBeenCalledWith("event-1", true)
        expect(orderUpdateOneMock).toHaveBeenNthCalledWith(2, {
            _id: "order-1",
            eventId: "event-1",
            posDeviceId: "pos-1",
            status: "PENDING",
            sumupCheckoutId: "initiating:order-1"
        }, { $set: { sumupCheckoutId: "client-tx-1" } })
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", "event-claim-1")
        expect(startSumUpEventOperationHeartbeatMock).toHaveBeenCalledOnce()
        expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce()
    })

    test("does not call SumUp while the event lifecycle owns the lease", async () => {
        posDeviceFindOneMock
            .mockReturnValueOnce(populatedCapabilities())
            .mockReturnValueOnce(populatedSumUpTerminal())
        claimSumUpEventOperationMock.mockResolvedValue(null)

        const result = await triggerSumUpPayment(12.5, "event-1", "pos-1", "order-1")

        expect(result).toEqual({ success: false, error: "La festa è in fase di archiviazione o eliminazione" })
        expect(orderUpdateOneMock).not.toHaveBeenCalled()
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
    })

    test("rejects a terminal missing the new SumUp configuration shape", async () => {
        posDeviceFindOneMock
            .mockReturnValueOnce(populatedCapabilities())
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
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 0 })
        posDeviceFindOneMock
            .mockReturnValueOnce(populatedCapabilities())
            .mockReturnValueOnce(populatedSumUpTerminal())

        const result = await triggerSumUpPayment(12.5, "event-1", "pos-1", "order-1")

        expect(result).toEqual({ success: false, error: "Ordine SumUp non preparato" })
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
    })
})

describe("createOrder SumUp lifecycle", () => {
    const order = { _id: { toString: () => "order-1" }, status: "PENDING" }

    beforeEach(() => {
        setupOrderPayment()
        orderCreateMock.mockResolvedValue(order)
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
        expect(orderUpdateOneMock.mock.calls.filter(([, update]) =>
            update.$set?.sumupCheckoutId === "client-tx-1"
        )).toHaveLength(1)
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledBefore(createSumUpCheckoutMock)
        expect(claimSumUpEventOperationMock).toHaveBeenCalledOnce()
        expect(claimSumUpEventOperationMock).toHaveBeenCalledBefore(orderCreateMock)
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", "event-claim-1")
        expect(startSumUpEventOperationHeartbeatMock).toHaveBeenCalledOnce()
        expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce()
    })

    test("does not create an order or reserve stock while an event reset owns the lease", async () => {
        claimSumUpEventOperationMock.mockResolvedValue(null)

        const result = await createOrder(orderInput)

        expect(result).toEqual({ success: false, error: "La festa è in fase di archiviazione o eliminazione" })
        expect(orderCreateMock).not.toHaveBeenCalled()
        expect(planStockAdjustmentsForPaymentMock).not.toHaveBeenCalled()
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
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
        setupOrderPayment()
        order = pendingOrder()
        orderFindOneMock.mockResolvedValue(order)
    })

    test("reserves stock and links the checkout for an existing pending order", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })

        const result = await completePendingOrderPayment(pendingPaymentInput)

        expect(result).toMatchObject({ success: true, paymentCompleted: false, paymentPending: true })
        expect(order.save).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).toHaveBeenNthCalledWith(
            1,
            {
                _id: "order-1",
                eventId: "event-1",
                status: "PENDING",
                $nor: [
                    { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                    { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                ]
            },
            expect.objectContaining({
                $set: expect.objectContaining({
                    cart: expect.any(Array),
                    cashSessionId: "session-1",
                    sumupCheckoutId: "initiating:order-1",
                    sumupInitiatedAt: expect.any(Date),
                    stockEffectStatus: "REVERTED"
                })
            })
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
        expect(orderUpdateOneMock.mock.calls.filter(([, update]) =>
            update.$set?.sumupCheckoutId === "client-tx-1"
        )).toHaveLength(1)
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledBefore(createSumUpCheckoutMock)
        expect(claimSumUpEventOperationMock).toHaveBeenCalledOnce()
        expect(claimSumUpEventOperationMock).toHaveBeenCalledBefore(planStockAdjustmentsForPaymentMock)
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", "event-claim-1")
        expect(startSumUpEventOperationHeartbeatMock).toHaveBeenCalledOnce()
        expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce()
    })

    test("does not claim or reserve a pending order while event maintenance owns the lease", async () => {
        claimSumUpEventOperationMock.mockResolvedValue(null)

        const result = await completePendingOrderPayment(pendingPaymentInput)

        expect(result).toEqual({ success: false, error: "La festa è in fase di archiviazione o eliminazione" })
        expect(planStockAdjustmentsForPaymentMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).not.toHaveBeenCalled()
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
    })

    test("does not reserve stock or call SumUp when the atomic order claim is lost", async () => {
        orderUpdateOneMock.mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 })
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })

        const result = await completePendingOrderPayment(pendingPaymentInput)

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("non più in attesa") })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            {
                _id: "order-1",
                eventId: "event-1",
                status: "PENDING",
                $nor: [
                    { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                    { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                ]
            },
            expect.objectContaining({
                $set: expect.objectContaining({ sumupCheckoutId: "initiating:order-1" })
            })
        )
        expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
        expect(releaseCashSessionPaymentClaimMock).toHaveBeenCalledWith("session-1", "claim-1")
    })

    test("blocks the reader before planning stock in a TEST session", async () => {
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "claim-1", isTest: true })

        const result = await completePendingOrderPayment(pendingPaymentInput)

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("TEST") })
        expect(planStockAdjustmentsForPaymentMock).not.toHaveBeenCalled()
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
        expect(order.save).not.toHaveBeenCalled()
    })

    test("releases stock and removes the marker after a definite rejection", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: false, error: "reader offline", uncertain: false })

        const result = await completePendingOrderPayment(pendingPaymentInput)

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

        const result = await completePendingOrderPayment(pendingPaymentInput)

        expect(result).toMatchObject({ success: true, paymentCompleted: false, paymentUncertain: true })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledOnce()
        expect(orderUpdateOneMock).not.toHaveBeenCalledWith(
            expect.anything(),
            { $unset: { sumupCheckoutId: 1 } }
        )
    })

    test("treats a late checkout-link write failure as uncertain", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })
        orderUpdateOneMock
            .mockResolvedValueOnce({ acknowledged: true, matchedCount: 1 })
            .mockResolvedValueOnce({ acknowledged: true, matchedCount: 1 })
            .mockRejectedValueOnce(new Error("write failed"))

        const result = await completePendingOrderPayment(pendingPaymentInput)

        expect(result).toMatchObject({ success: true, orderId: "order-1", paymentCompleted: false, paymentUncertain: true })
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledOnce()
    })
})


describe.each([
    {
        action: "createOrder",
        pay: () => createOrder(orderInput),
        cleanup: { $set: { status: "CANCELLED" } }
    },
    {
        action: "completePendingOrderPayment",
        pay: () => completePendingOrderPayment(pendingPaymentInput),
        cleanup: { $unset: { sumupCheckoutId: 1 } }
    }
])("$action SumUp failure cleanup", ({ pay, cleanup }) => {
    beforeEach(() => {
        setupOrderPayment()
        const order = pendingOrder()
        orderCreateMock.mockResolvedValue(order)
        orderFindOneMock.mockResolvedValue(order)
    })

    test("does not call the reader when stock reservation fails", async () => {
        transitionSumUpOrderStockMock.mockResolvedValueOnce({ success: false, error: "reservation failed" })

        expect(await pay()).toEqual({ success: false, error: "reservation failed" })
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledOnce()
        expect(orderUpdateOneMock).toHaveBeenCalledWith(expect.anything(), cleanup)
        expect(releaseCashSessionPaymentClaimMock).toHaveBeenCalledWith("session-1", "claim-1")
    })

    test.each(["planning", "reservation", "snapshot"])("stops checkout when event ownership is lost during %s", async (stage) => {
        let owned = true
        ensureEventOperationOwnedMock.mockImplementation(async () => owned)
        refreshSumUpEventOperationMock.mockImplementation(async () => {
            if (!owned && stage === "snapshot") throw new Error("event lease refresh unavailable")
            return owned
        })
        createSumUpCheckoutMock.mockResolvedValue({ success: true, id: "client-tx-1" })
        if (stage === "planning") {
            planStockAdjustmentsForPaymentMock.mockImplementationOnce(async () => {
                owned = false
                return { success: true, adjustments: [{ entityType: "PRODUCT", entityId: "product-1", quantity: 1 }] }
            })
        } else if (stage === "reservation") {
            transitionSumUpOrderStockMock.mockImplementationOnce(async () => {
                owned = false
                return { success: true }
            })
        } else {
            orderUpdateOneMock.mockImplementation(async (_filter, update) => {
                if (update.$set?.sumupRefundCredentials) owned = false
                return { acknowledged: true, matchedCount: 1 }
            })
        }

        expect(await pay()).toMatchObject({ success: false })
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
        expect(startSumUpEventOperationHeartbeatMock).toHaveBeenCalledBefore(planStockAdjustmentsForPaymentMock)
        expect(stopEventOperationHeartbeatMock).toHaveBeenCalledOnce()
        expect(stopEventOperationHeartbeatMock).toHaveBeenCalledBefore(releaseSumUpEventOperationMock)
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", "event-claim-1")
        expect(releaseCashSessionPaymentClaimMock).toHaveBeenCalledWith("session-1", "claim-1")
        if (stage === "planning") {
            expect(orderCreateMock).not.toHaveBeenCalled()
            expect(orderUpdateOneMock).not.toHaveBeenCalled()
            expect(transitionSumUpOrderStockMock).not.toHaveBeenCalled()
        } else {
            expect(transitionSumUpOrderStockMock).toHaveBeenLastCalledWith(expect.objectContaining({ target: "REVERTED" }))
            expect(orderUpdateOneMock).toHaveBeenCalledWith(expect.anything(), cleanup)
            if (stage === "reservation") {
                expect(orderUpdateOneMock.mock.calls.some(([, update]) => update.$set?.sumupRefundCredentials)).toBe(false)
            } else {
                expect(orderUpdateOneMock).toHaveBeenCalledWith(
                    expect.objectContaining({ sumupCheckoutId: "initiating:order-1" }),
                    { $unset: { sumupRefundCredentials: 1 } }
                )
            }
        }
    })

    test.each(["reservation", "checkout"])("reports uncertainty when cleanup after %s failure cannot complete", async (stage) => {
        if (stage === "reservation") {
            transitionSumUpOrderStockMock.mockResolvedValueOnce({ success: false, error: "reservation failed" })
        }
        createSumUpCheckoutMock.mockResolvedValue({ success: false, error: "reader offline", uncertain: false })
        orderUpdateOneMock.mockImplementation(async (_filter, update) => ({
            acknowledged: true,
            matchedCount: JSON.stringify(update) === JSON.stringify(cleanup) ? 0 : 1
        }))

        expect(await pay()).toMatchObject({ success: true, orderId: "order-1", paymentCompleted: false, paymentUncertain: true })
        expect(orderUpdateOneMock).toHaveBeenCalledWith(expect.anything(), cleanup)
        expect(transitionSumUpOrderStockMock).toHaveBeenCalledTimes(stage === "reservation" ? 1 : 2)
        if (stage === "reservation") expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
        expect(releaseCashSessionPaymentClaimMock).toHaveBeenCalledWith("session-1", "claim-1")
    })

    test("keeps the marker when reserved stock cannot be released after a definite rejection", async () => {
        createSumUpCheckoutMock.mockResolvedValue({ success: false, error: "reader offline", uncertain: false })
        transitionSumUpOrderStockMock
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: "release failed" })

        expect(await pay()).toMatchObject({ success: true, orderId: "order-1", paymentCompleted: false, paymentUncertain: true })
        expect(transitionSumUpOrderStockMock).toHaveBeenLastCalledWith(expect.objectContaining({
            token: "SUMUP_RELEASE:order-1",
            target: "REVERTED"
        }))
        expect(orderUpdateOneMock).not.toHaveBeenCalledWith(expect.anything(), cleanup)
    })

    test("keeps the marker when stock reservation throws", async () => {
        transitionSumUpOrderStockMock.mockRejectedValueOnce(new Error("reservation interrupted"))

        expect(await pay()).toMatchObject({ success: true, orderId: "order-1", paymentCompleted: false, paymentUncertain: true })
        expect(createSumUpCheckoutMock).not.toHaveBeenCalled()
        expect(orderUpdateOneMock).not.toHaveBeenCalledWith(expect.anything(), cleanup)
        expect(releaseCashSessionPaymentClaimMock).toHaveBeenCalledWith("session-1", "claim-1")
    })
})
