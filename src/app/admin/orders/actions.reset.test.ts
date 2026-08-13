import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensureAdminSessionMock,
    getAdminContextEventIdMock,
    orderExistsMock,
    orderFindMock,
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    orderExistsMock: vi.fn(),
    orderFindMock: vi.fn(),
}))

vi.mock("@/lib/authz", () => ({ ensureAdminSession: ensureAdminSessionMock }))
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }))
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }))
vi.mock("@/models/Order", () => ({ default: {
    exists: orderExistsMock,
    find: orderFindMock,
    deleteMany: vi.fn(),
} }))
vi.mock("@/models/OrderCounter", () => ({ default: { deleteMany: vi.fn() } }))
vi.mock("@/models/PrintJob", () => ({ default: { deleteMany: vi.fn() } }))
vi.mock("@/models/CashSession", () => ({ default: { deleteMany: vi.fn() } }))
vi.mock("@/models/PosDevice", () => ({ default: {} }))
vi.mock("@/models/Peripheral", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({ PrinterService: {} }))
vi.mock("@/lib/print-queue", () => ({ recoverStaleManualPrintRetryClaims: vi.fn() }))
vi.mock("@/lib/secrets", () => ({ decryptSecret: vi.fn() }))
vi.mock("@/lib/sumup", () => ({}))
vi.mock("@/lib/sumup-refund", () => ({}))
vi.mock("@/lib/sumup-order-finalization", () => ({}))
vi.mock("@/lib/sumup-order-stock", () => ({}))
vi.mock("@/lib/cash-session-stock", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { resetEventOrdersAction } from "./actions"

describe("resetEventOrdersAction SumUp guard", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensureAdminSessionMock.mockResolvedValue({ ok: true })
        getAdminContextEventIdMock.mockResolvedValue("event-1")
    })

    test("does not delete an event while a certified SumUp payment is unresolved", async () => {
        orderExistsMock.mockResolvedValue({ _id: "sumup-order-1" })
        const formData = new FormData()
        formData.set("confirmationToken", "RESET")

        const result = await resetEventOrdersAction(formData)

        expect(result).toEqual({
            success: false,
            error: "Completa o rimborsa tutti i pagamenti SumUp prima di azzerare gli ordini della festa",
        })
        expect(orderExistsMock).toHaveBeenCalledWith({
            eventId: "event-1",
            $or: expect.arrayContaining([
                expect.objectContaining({ status: "PENDING", sumupCheckoutId: expect.any(Object) }),
                expect.objectContaining({ status: "PAID" }),
                expect.objectContaining({
                    status: "CANCELLED",
                    sumupRecoveryCancelledAt: expect.any(Object),
                    sumupRecoveryResolvedAt: { $exists: false }
                }),
            ]),
        })
        expect(orderFindMock).not.toHaveBeenCalled()
    })
})
