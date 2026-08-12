import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"
import { publishStockInvalidation } from "@/lib/pos-stock-realtime"

const { authorizePosStockRequestMock } = vi.hoisted(() => ({
    authorizePosStockRequestMock: vi.fn()
}))

vi.mock("@/lib/pos-stock", () => ({ authorizePosStockRequest: authorizePosStockRequestMock }))

import { GET } from "./route"

const decoder = new TextDecoder()

describe("GET /api/pos/stock-stream", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        authorizePosStockRequestMock.mockResolvedValue({ ok: true, eventId: "event-1" })
    })

    test("streams an initial event and matching invalidations with proxy-safe headers", async () => {
        const abortController = new AbortController()
        const request = new NextRequest("http://localhost/api/pos/stock-stream?eventId=event-1", {
            signal: abortController.signal
        })

        const response = await GET(request)
        const reader = response.body!.getReader()

        expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8")
        expect(response.headers.get("cache-control")).toContain("no-store")
        expect(response.headers.get("connection")).toBe("keep-alive")
        expect(response.headers.get("x-accel-buffering")).toBe("no")
        expect(response.headers.get("x-content-type-options")).toBe("nosniff")
        expect(decoder.decode((await reader.read()).value)).toBe(
            "event: stock\ndata: {\"eventId\":\"event-1\"}\n\n"
        )

        publishStockInvalidation("event-2")
        const invalidation = reader.read()
        publishStockInvalidation("event-1")
        expect(decoder.decode((await invalidation).value)).toBe(
            "event: stock\ndata: {\"eventId\":\"event-1\"}\n\n"
        )

        abortController.abort()
        await expect(reader.read()).resolves.toMatchObject({ done: true })
    })

    test("returns request validation errors before opening a stream", async () => {
        authorizePosStockRequestMock.mockResolvedValue({ ok: false, status: 401, error: "Autenticazione richiesta" })

        const response = await GET(new NextRequest("http://localhost/api/pos/stock-stream?eventId=event-1"))

        expect(response.status).toBe(401)
        expect(response.headers.get("cache-control")).toBe("no-store")
        await expect(response.json()).resolves.toEqual({ error: "Autenticazione richiesta" })
    })
})
