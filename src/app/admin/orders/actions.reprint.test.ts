import { beforeEach, describe, expect, test, vi } from "vitest"

const {
    dbConnectMock,
    ensureAdminSessionMock,
    getAdminContextEventIdMock,
    orderFindOneMock,
    printJobFindMock,
    routeOrderToPrintersMock,
    retryPrintJobByIdMock,
    revalidatePathMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    ensureAdminSessionMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    printJobFindMock: vi.fn(),
    routeOrderToPrintersMock: vi.fn(),
    retryPrintJobByIdMock: vi.fn(),
    revalidatePathMock: vi.fn()
}))

vi.mock("@/lib/authz", () => ({ ensureAdminSession: ensureAdminSessionMock }))
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }))
vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }))
vi.mock("@/models/Order", () => ({ default: { findOne: orderFindOneMock } }))
vi.mock("@/models/OrderCounter", () => ({ default: {} }))
vi.mock("@/models/PrintJob", () => ({ default: { find: printJobFindMock } }))
vi.mock("@/models/CashSession", () => ({ default: {} }))
vi.mock("@/models/PosDevice", () => ({ default: {} }))
vi.mock("@/models/Peripheral", () => ({ default: {} }))
vi.mock("@/lib/printer", () => ({
    PrinterService: {
        routeOrderToPrinters: routeOrderToPrintersMock,
        retryPrintJobById: retryPrintJobByIdMock
    }
}))
vi.mock("@/lib/secrets", () => ({ decryptSecret: vi.fn() }))
vi.mock("@/lib/sumup", () => ({
    refundSumUpTransaction: vi.fn(),
    resolveSumUpTransactionIdByCheckout: vi.fn()
}))
vi.mock("@/lib/cash-session-stock", () => ({ transitionClaimedOrderStock: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))

import { reprintOrderById } from "./actions"

function mockOrder(order: { posDeviceId?: string | { toString(): string } } | null) {
    const leanMock = vi.fn().mockResolvedValue(order)
    const selectMock = vi.fn().mockReturnValue({ lean: leanMock })
    orderFindOneMock.mockReturnValue({ select: selectMock })
    return { selectMock, leanMock }
}

function failedJobsQuery(rows: Array<{ _id: string | { toString(): string } }>) {
    return {
        sort: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(rows)
            })
        })
    }
}

describe("reprintOrderById", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensureAdminSessionMock.mockResolvedValue({ ok: true })
        getAdminContextEventIdMock.mockResolvedValue("event-1")
        dbConnectMock.mockResolvedValue(undefined)
        printJobFindMock.mockReturnValue(failedJobsQuery([]))
        routeOrderToPrintersMock.mockResolvedValue([true])
        retryPrintJobByIdMock.mockResolvedValue({ success: true })
    })

    test("rejects unauthenticated requests before reading the event", async () => {
        ensureAdminSessionMock.mockResolvedValue({ ok: false, error: "Accesso negato" })

        await expect(reprintOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Accesso negato"
        })
        expect(getAdminContextEventIdMock).not.toHaveBeenCalled()
        expect(dbConnectMock).not.toHaveBeenCalled()
    })

    test("rejects an empty order id", async () => {
        await expect(reprintOrderById("   ")).resolves.toEqual({
            success: false,
            error: "Ordine non valido"
        })
        expect(getAdminContextEventIdMock).not.toHaveBeenCalled()
    })

    test("requires an event in the admin context", async () => {
        getAdminContextEventIdMock.mockResolvedValue(null)

        await expect(reprintOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Nessuna festa selezionata nel contesto admin"
        })
        expect(dbConnectMock).not.toHaveBeenCalled()
        expect(orderFindOneMock).not.toHaveBeenCalled()
    })

    test("reprints a paid order from the selected event on its POS device", async () => {
        const posDeviceId = { toString: vi.fn().mockReturnValue("pos-1") }
        const { selectMock } = mockOrder({ posDeviceId })
        routeOrderToPrintersMock.mockResolvedValue([true, true])

        await expect(reprintOrderById("  order-1  ")).resolves.toEqual({ success: true })

        expect(dbConnectMock).toHaveBeenCalledTimes(1)
        expect(orderFindOneMock).toHaveBeenCalledWith({
            _id: "order-1",
            eventId: "event-1",
            status: "PAID"
        })
        expect(selectMock).toHaveBeenCalledWith("posDeviceId")
        expect(routeOrderToPrintersMock).toHaveBeenCalledWith("order-1", "pos-1")
        expect(revalidatePathMock).toHaveBeenCalledWith("/admin/orders")
    })

    test("returns an error when the paid order is not in the selected event", async () => {
        mockOrder(null)

        await expect(reprintOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Ordine pagato non trovato nella festa selezionata"
        })
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled()
        expect(revalidatePathMock).not.toHaveBeenCalled()
    })

    test("returns an error when routing generates no prints", async () => {
        mockOrder({ posDeviceId: "pos-1" })
        routeOrderToPrintersMock.mockResolvedValue([])

        await expect(reprintOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Nessuna stampa generata per l'ordine"
        })
        expect(revalidatePathMock).not.toHaveBeenCalled()
    })

    test("returns an error when routing returns no result", async () => {
        mockOrder({ posDeviceId: "pos-1" })
        routeOrderToPrintersMock.mockResolvedValue(undefined)

        await expect(reprintOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Nessuna stampa generata per l'ordine"
        })
        expect(revalidatePathMock).not.toHaveBeenCalled()
    })

    test("returns an error when any routed print fails", async () => {
        mockOrder({ posDeviceId: "pos-1" })
        routeOrderToPrintersMock.mockResolvedValue([true, false, true])

        await expect(reprintOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Ristampa non completata. Riprova: verranno reinviate solo le copie fallite."
        })
        expect(revalidatePathMock).not.toHaveBeenCalled()
    })

    test("retries existing failed copies without routing the whole order again", async () => {
        mockOrder({ posDeviceId: "pos-1" })
        const firstJobId = { toString: vi.fn().mockReturnValue("job-1") }
        printJobFindMock.mockReturnValue(failedJobsQuery([
            { _id: firstJobId },
            { _id: "job-2" }
        ]))

        await expect(reprintOrderById("order-1")).resolves.toEqual({ success: true })

        expect(printJobFindMock).toHaveBeenCalledWith({
            eventId: "event-1",
            orderId: "order-1",
            source: "ORDER",
            status: "FAILED"
        })
        expect(retryPrintJobByIdMock).toHaveBeenNthCalledWith(1, "event-1", "job-1")
        expect(retryPrintJobByIdMock).toHaveBeenNthCalledWith(2, "event-1", "job-2")
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled()
        expect(revalidatePathMock).toHaveBeenCalledWith("/admin/orders")
    })

    test("keeps only unsuccessful copies eligible for the next retry", async () => {
        mockOrder({ posDeviceId: "pos-1" })
        printJobFindMock
            .mockReturnValueOnce(failedJobsQuery([]))
            .mockReturnValueOnce(failedJobsQuery([{ _id: "job-2" }]))
        routeOrderToPrintersMock.mockResolvedValue([true, false])
        retryPrintJobByIdMock.mockResolvedValue({ success: true })

        await expect(reprintOrderById("order-1")).resolves.toMatchObject({ success: false })
        await expect(reprintOrderById("order-1")).resolves.toEqual({ success: true })

        expect(routeOrderToPrintersMock).toHaveBeenCalledTimes(1)
        expect(retryPrintJobByIdMock).toHaveBeenCalledTimes(1)
        expect(retryPrintJobByIdMock).toHaveBeenCalledWith("event-1", "job-2")
    })

    test("reports failed copy retries without creating a new print batch", async () => {
        mockOrder({ posDeviceId: "pos-1" })
        printJobFindMock.mockReturnValue(failedJobsQuery([{ _id: "job-1" }, { _id: "job-2" }]))
        retryPrintJobByIdMock
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: "offline" })

        await expect(reprintOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Reinvio non completato: 1 copia non inviata. Riprova."
        })
        expect(routeOrderToPrintersMock).not.toHaveBeenCalled()
        expect(revalidatePathMock).toHaveBeenCalledWith("/admin/orders")
    })

    test("returns a clear error when routing throws", async () => {
        mockOrder({ posDeviceId: "pos-1" })
        routeOrderToPrintersMock.mockRejectedValue(new Error("printer offline"))
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

        await expect(reprintOrderById("order-1")).resolves.toEqual({
            success: false,
            error: "Errore interno durante la ristampa dell'ordine"
        })
        expect(consoleErrorSpy).toHaveBeenCalledWith("Order reprint error:", expect.any(Error))
        expect(revalidatePathMock).not.toHaveBeenCalled()
        consoleErrorSpy.mockRestore()
    })
})
