import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    ensureAdminSessionMock,
    getAdminContextEventIdMock,
    orderExistsMock,
    orderFindMock,
    claimSumUpEventOperationMock,
    releaseSumUpEventOperationMock,
    startSumUpEventOperationHeartbeatMock,
    ensureOwnedMock,
    stopHeartbeatMock,
    orderDeleteManyMock,
    counterDeleteManyMock,
    printJobDeleteManyMock,
    cashSessionDeleteManyMock,
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    orderExistsMock: vi.fn(),
    orderFindMock: vi.fn(),
    claimSumUpEventOperationMock: vi.fn(),
    releaseSumUpEventOperationMock: vi.fn(),
    startSumUpEventOperationHeartbeatMock: vi.fn(),
    ensureOwnedMock: vi.fn(),
    stopHeartbeatMock: vi.fn(),
    orderDeleteManyMock: vi.fn(),
    counterDeleteManyMock: vi.fn(),
    printJobDeleteManyMock: vi.fn(),
    cashSessionDeleteManyMock: vi.fn(),
}))

vi.mock("@/lib/authz", () => ({ ensureAdminSession: ensureAdminSessionMock }))
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }))
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }))
vi.mock("@/models/Order", () => ({ default: {
    exists: orderExistsMock,
    find: orderFindMock,
    deleteMany: orderDeleteManyMock,
} }))
vi.mock("@/models/OrderCounter", () => ({ default: { deleteMany: counterDeleteManyMock } }))
vi.mock("@/models/PrintJob", () => ({ default: { deleteMany: printJobDeleteManyMock } }))
vi.mock("@/models/CashSession", () => ({ default: { deleteMany: cashSessionDeleteManyMock } }))
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
vi.mock("@/lib/sumup-event-operation", () => ({
    claimSumUpEventOperation: claimSumUpEventOperationMock,
    releaseSumUpEventOperation: releaseSumUpEventOperationMock,
    startSumUpEventOperationHeartbeat: startSumUpEventOperationHeartbeatMock,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { resetEventOrdersAction } from "./actions"

function resetForm() {
    const formData = new FormData()
    formData.set("confirmationToken", "RESET")
    return formData
}

describe("resetEventOrdersAction SumUp guard", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensureAdminSessionMock.mockResolvedValue({ ok: true })
        getAdminContextEventIdMock.mockResolvedValue("event-1")
        claimSumUpEventOperationMock.mockResolvedValue("event-operation-1")
        releaseSumUpEventOperationMock.mockResolvedValue(undefined)
        startSumUpEventOperationHeartbeatMock.mockReturnValue({ ensureOwned: ensureOwnedMock, stop: stopHeartbeatMock })
        ensureOwnedMock.mockResolvedValue(true)
        orderExistsMock.mockResolvedValue(false)
        orderFindMock.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) })
        for (const deleteMany of [orderDeleteManyMock, counterDeleteManyMock, printJobDeleteManyMock, cashSessionDeleteManyMock]) {
            deleteMany.mockResolvedValue({ deletedCount: 1 })
        }
    })

    test("does not delete an event while a certified SumUp payment is unresolved", async () => {
        orderExistsMock.mockResolvedValue({ _id: "sumup-order-1" })
        const result = await resetEventOrdersAction(resetForm())

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
        expect(claimSumUpEventOperationMock).toHaveBeenCalledWith("event-1")
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", "event-operation-1")
    })

    test("does not inspect or delete orders when another SumUp operation owns the event", async () => {
        claimSumUpEventOperationMock.mockResolvedValue(null)
        await expect(resetEventOrdersAction(resetForm())).resolves.toEqual({
            success: false,
            error: expect.stringMatching(/già in corso/i),
        })

        expect(orderExistsMock).not.toHaveBeenCalled()
        expect(orderFindMock).not.toHaveBeenCalled()
        expect(releaseSumUpEventOperationMock).not.toHaveBeenCalled()
    })

    test.each([false, true])("holds the lease until every deletion settles (early failure: %s)", async (earlyFailure) => {
        let finishDelete!: (result: { deletedCount: number }) => void
        let notifyStarted!: () => void
        const deletesStarted = new Promise<void>((resolve) => { notifyStarted = resolve })
        orderDeleteManyMock.mockReturnValue(new Promise<{ deletedCount: number }>((resolve) => { finishDelete = resolve }))
        cashSessionDeleteManyMock.mockImplementation(() => {
            notifyStarted()
            return earlyFailure ? Promise.reject(new Error("session deletion failed")) : Promise.resolve({ deletedCount: 1 })
        })
        const pendingReset = resetEventOrdersAction(resetForm())
        await deletesStarted
        // Drain promise continuations without resolving the slow deletion.
        await new Promise<void>((resolve) => setImmediate(resolve))

        expect(startSumUpEventOperationHeartbeatMock).toHaveBeenCalledWith("event-1", "event-operation-1")
        expect(stopHeartbeatMock).not.toHaveBeenCalled()
        expect(releaseSumUpEventOperationMock).not.toHaveBeenCalled()

        finishDelete({ deletedCount: 2 })
        const result = await pendingReset
        expect(result.success).toBe(!earlyFailure)
        if (!earlyFailure && result.success) expect(result.summary.deletedOrders).toBe(2)
        expect(stopHeartbeatMock).toHaveBeenCalledTimes(1)
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", "event-operation-1")
        expect(stopHeartbeatMock.mock.invocationCallOrder[0]).toBeLessThan(releaseSumUpEventOperationMock.mock.invocationCallOrder[0])
    })

    test.each(["before", "after"])("reports lost ownership %s the deletion cascade", async (phase) => {
        if (phase === "after") ensureOwnedMock.mockResolvedValueOnce(true)
        ensureOwnedMock.mockResolvedValue(false)

        await expect(resetEventOrdersAction(resetForm())).resolves.toEqual({
            success: false,
            error: "Operazione SumUp non più esclusiva: riprova"
        })

        for (const deleteMany of [orderDeleteManyMock, counterDeleteManyMock, printJobDeleteManyMock, cashSessionDeleteManyMock]) {
            expect(deleteMany).toHaveBeenCalledTimes(phase === "before" ? 0 : 1)
        }
        expect(stopHeartbeatMock).toHaveBeenCalledTimes(1)
        expect(releaseSumUpEventOperationMock).toHaveBeenCalledWith("event-1", "event-operation-1")
    })

})
