import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const { authorizePosStockRequestMock, getPosStockSnapshotMock } = vi.hoisted(() => ({
    authorizePosStockRequestMock: vi.fn(),
    getPosStockSnapshotMock: vi.fn()
}))

vi.mock("@/lib/pos-stock", () => ({
    authorizePosStockRequest: authorizePosStockRequestMock,
    getPosStockSnapshot: getPosStockSnapshotMock
}))

import { GET } from "./route"

describe("GET /api/pos/stock", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        authorizePosStockRequestMock.mockResolvedValue({ ok: true, eventId: "event-1" })
        getPosStockSnapshotMock.mockResolvedValue({ eventId: "event-1", products: [] })
    })

    test("returns a non-cacheable stock snapshot", async () => {
        const request = new NextRequest("http://localhost/api/pos/stock?eventId=event-1")

        const response = await GET(request)

        expect(response.status).toBe(200)
        expect(response.headers.get("cache-control")).toBe("no-store")
        expect(response.headers.get("x-content-type-options")).toBe("nosniff")
        await expect(response.json()).resolves.toEqual({ eventId: "event-1", products: [] })
        expect(authorizePosStockRequestMock).toHaveBeenCalledWith("event-1", request.headers)
        expect(getPosStockSnapshotMock).toHaveBeenCalledWith("event-1")
    })

    test("returns the authorization error without reading products", async () => {
        authorizePosStockRequestMock.mockResolvedValue({ ok: false, status: 404, error: "Evento attivo non valido" })

        const response = await GET(new NextRequest("http://localhost/api/pos/stock?eventId=event-old"))

        expect(response.status).toBe(404)
        await expect(response.json()).resolves.toEqual({ error: "Evento attivo non valido" })
        expect(getPosStockSnapshotMock).not.toHaveBeenCalled()
    })
})
