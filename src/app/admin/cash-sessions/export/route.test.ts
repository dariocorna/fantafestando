import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const {
    ensureAdminSessionMock,
    adminUnauthorizedJsonMock,
    getAdminContextEventMock,
    dbConnectMock,
    cashSessionFindMock,
    posDeviceFindMock,
    orderFindMock,
    productFindMock,
    categoryFindMock,
    buildCashSessionsWorkbookMock
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    adminUnauthorizedJsonMock: vi.fn(),
    getAdminContextEventMock: vi.fn(),
    dbConnectMock: vi.fn(),
    cashSessionFindMock: vi.fn(),
    posDeviceFindMock: vi.fn(),
    orderFindMock: vi.fn(),
    productFindMock: vi.fn(),
    categoryFindMock: vi.fn(),
    buildCashSessionsWorkbookMock: vi.fn()
}))

vi.mock("@/lib/authz", () => ({
    ensureAdminSession: ensureAdminSessionMock,
    adminUnauthorizedJson: adminUnauthorizedJsonMock
}))
vi.mock("@/lib/events", () => ({ getAdminContextEvent: getAdminContextEventMock }))
vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }))
vi.mock("@/models/CashSession", () => ({ default: { find: cashSessionFindMock } }))
vi.mock("@/models/Order", () => ({ default: { find: orderFindMock } }))
vi.mock("@/models/PosDevice", () => ({ default: { find: posDeviceFindMock } }))
vi.mock("@/models/Product", () => ({ default: { find: productFindMock } }))
vi.mock("@/models/Category", () => ({ default: { find: categoryFindMock } }))
vi.mock("@/lib/excel-report", () => ({
    buildCashSessionWorkbook: vi.fn(),
    buildCashSessionsWorkbook: buildCashSessionsWorkbookMock
}))

import { GET } from "./route"

const EVENT_ID = "507f1f77bcf86cd799439010"
const SESSION_ID_1 = "507f1f77bcf86cd799439011"
const SESSION_ID_2 = "507f1f77bcf86cd799439012"

function request(query = "") {
    return new NextRequest(`http://localhost/admin/cash-sessions/export${query}`)
}

function mockSessions(sessions: unknown[]) {
    cashSessionFindMock.mockReturnValue({
        lean: vi.fn().mockResolvedValue(sessions)
    })
}

function mockSelectedFind(findMock: ReturnType<typeof vi.fn>, result: unknown[]) {
    findMock.mockReturnValue({
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(result)
        })
    })
}

function mockSortedSelectedFind(findMock: ReturnType<typeof vi.fn>, result: unknown[]) {
    findMock.mockReturnValue({
        sort: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(result)
            })
        })
    })
}

describe("GET /admin/cash-sessions/export", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensureAdminSessionMock.mockResolvedValue({ ok: true, user: { id: "admin" } })
        adminUnauthorizedJsonMock.mockImplementation((sessionCheck) =>
            Response.json({ error: sessionCheck.error }, { status: sessionCheck.status })
        )
        getAdminContextEventMock.mockResolvedValue({ _id: EVENT_ID, name: "Festa" })
    })

    test("rejects unauthenticated requests before database access", async () => {
        ensureAdminSessionMock.mockResolvedValue({ ok: false, status: 401, error: "Autenticazione richiesta" })

        const response = await GET(request(`?sessionId=${SESSION_ID_1}&format=xlsx`))

        expect(response.status).toBe(401)
        expect(getAdminContextEventMock).not.toHaveBeenCalled()
        expect(dbConnectMock).not.toHaveBeenCalled()
        expect(cashSessionFindMock).not.toHaveBeenCalled()
    })

    test.each([
        ["missing", "?format=xlsx"],
        ["malformed", `?sessionId=${SESSION_ID_1}&sessionId=invalid&format=xlsx`],
        ["empty", `?sessionId=${SESSION_ID_1}&sessionId=&format=xlsx`]
    ])("rejects %s session identifiers", async (_label, query) => {
        const response = await GET(request(query))

        expect(response.status).toBe(400)
        expect(cashSessionFindMock).not.toHaveBeenCalled()
    })

    test("rejects a multi-session CSV export", async () => {
        const response = await GET(request(`?sessionId=${SESSION_ID_1}&sessionId=${SESSION_ID_2}&format=csv`))

        expect(response.status).toBe(400)
        expect(cashSessionFindMock).not.toHaveBeenCalled()
    })

    test("deduplicates identifiers and scopes the query to the selected event", async () => {
        mockSessions([])

        const response = await GET(request(`?sessionId=${SESSION_ID_1}&sessionId=${SESSION_ID_1.toUpperCase()}&format=xlsx`))

        expect(response.status).toBe(404)
        expect(cashSessionFindMock).toHaveBeenCalledWith({
            _id: { $in: [SESSION_ID_1] },
            eventId: EVENT_ID
        })
    })

    test("rejects partial or cross-event selections", async () => {
        mockSessions([{ _id: SESSION_ID_1, status: "CLOSED" }])

        const response = await GET(request(`?sessionId=${SESSION_ID_1}&sessionId=${SESSION_ID_2}&format=xlsx`))

        expect(response.status).toBe(404)
    })

    test("rejects the whole export when any selected session is open", async () => {
        mockSessions([
            { _id: SESSION_ID_1, status: "CLOSED" },
            { _id: SESSION_ID_2, status: "OPEN" }
        ])

        const response = await GET(request(`?sessionId=${SESSION_ID_1}&sessionId=${SESSION_ID_2}&format=xlsx`))

        expect(response.status).toBe(400)
    })

    test("builds one scoped workbook with reports ordered like the selected identifiers", async () => {
        const posId1 = "507f1f77bcf86cd799439021"
        const posId2 = "507f1f77bcf86cd799439022"
        mockSessions([
            { _id: SESSION_ID_1, eventId: EVENT_ID, posDeviceId: posId1, status: "CLOSED", paidOrdersCount: 1, cashSalesAmount: 4 },
            { _id: SESSION_ID_2, eventId: EVENT_ID, posDeviceId: posId2, status: "CLOSED", paidOrdersCount: 1, cardSalesAmount: 6 }
        ])
        mockSelectedFind(posDeviceFindMock, [
            { _id: posId1, name: "Cassa 1" },
            { _id: posId2, name: "Cassa 2" }
        ])
        mockSortedSelectedFind(orderFindMock, [
            { _id: "order-1", cashSessionId: SESSION_ID_1, pickupNumber: 1, status: "PAID", paymentMethod: "CASH", totalAmount: 4, cart: [] },
            { _id: "order-2", cashSessionId: SESSION_ID_2, pickupNumber: 2, status: "PAID", paymentMethod: "CARD", totalAmount: 6, cart: [] }
        ])
        mockSelectedFind(categoryFindMock, [])
        buildCashSessionsWorkbookMock.mockResolvedValue(Buffer.from("xlsx"))

        const response = await GET(request(`?sessionId=${SESSION_ID_2}&sessionId=${SESSION_ID_1}&format=xlsx`))

        expect(response.status).toBe(200)
        expect(orderFindMock).toHaveBeenCalledWith({
            eventId: EVENT_ID,
            cashSessionId: { $in: [SESSION_ID_2, SESSION_ID_1] },
            status: "PAID"
        })
        const reports = buildCashSessionsWorkbookMock.mock.calls[0][0]
        expect(reports.map((report: { sessionId: string }) => report.sessionId)).toEqual([SESSION_ID_2, SESSION_ID_1])
        expect(reports[0].orders).toEqual([expect.objectContaining({ id: "order-2" })])
        expect(reports[1].orders).toEqual([expect.objectContaining({ id: "order-1" })])
        expect(response.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        expect(response.headers.get("content-disposition")).toMatch(/cash-sessions-Festa-\d{8}-\d{4}\.xlsx/)
        expect(response.headers.get("cache-control")).toBe("no-store")
        expect(productFindMock).not.toHaveBeenCalled()
    })
})
