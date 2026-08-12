import { beforeEach, describe, expect, test, vi } from "vitest"

const { ensurePosAccessMock, getActiveEventIdMock, productFindMock } = vi.hoisted(() => ({
    ensurePosAccessMock: vi.fn(),
    getActiveEventIdMock: vi.fn(),
    productFindMock: vi.fn()
}))

vi.mock("@/lib/pos-access", () => ({ ensurePosAccess: ensurePosAccessMock }))
vi.mock("@/lib/events", () => ({ getActiveEventId: getActiveEventIdMock }))
vi.mock("@/models/Product", () => ({ default: { find: productFindMock } }))

import { authorizePosStockRequest, getPosStockSnapshot } from "@/lib/pos-stock"

describe("POS stock API helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ensurePosAccessMock.mockResolvedValue({ ok: true, user: null })
        getActiveEventIdMock.mockResolvedValue("event-1")
    })

    test("rejects unauthorized requests before reading the active event", async () => {
        ensurePosAccessMock.mockResolvedValue({ ok: false, status: 401, error: "Autenticazione richiesta" })

        const result = await authorizePosStockRequest("event-1", new Headers())

        expect(result).toEqual({ ok: false, status: 401, error: "Autenticazione richiesta" })
        expect(getActiveEventIdMock).not.toHaveBeenCalled()
    })

    test("requires an event id and the current active event", async () => {
        await expect(authorizePosStockRequest(" ", new Headers())).resolves.toEqual({
            ok: false,
            status: 400,
            error: "Evento non valido"
        })
        expect(getActiveEventIdMock).not.toHaveBeenCalled()

        await expect(authorizePosStockRequest("event-old", new Headers())).resolves.toEqual({
            ok: false,
            status: 404,
            error: "Evento attivo non valido"
        })
    })

    test("returns the normalized product stock DTO", async () => {
        productFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    {
                        _id: { toString: () => "product-1" },
                        stockQuantity: 2,
                        isSoldOut: false,
                        variants: [{ optionName: "Grande", priceVariation: 1.5, stockQuantity: 0 }]
                    },
                    {
                        _id: "product-2",
                        stockQuantity: null,
                        isSoldOut: true,
                        variants: [{ optionName: "", priceVariation: undefined, stockQuantity: undefined }]
                    }
                ])
            })
        })

        const result = await getPosStockSnapshot("event-1")

        expect(productFindMock).toHaveBeenCalledWith({ eventId: "event-1" })
        expect(result).toEqual({
            eventId: "event-1",
            products: [
                {
                    _id: "product-1",
                    stockQuantity: 2,
                    isSoldOut: false,
                    stockStatus: "LOW",
                    variants: [{ optionName: "Grande", priceVariation: 1.5, stockQuantity: 0 }]
                },
                {
                    _id: "product-2",
                    stockQuantity: null,
                    isSoldOut: true,
                    stockStatus: "OUT",
                    variants: [{ optionName: "", priceVariation: 0, stockQuantity: null }]
                }
            ]
        })
    })
})
