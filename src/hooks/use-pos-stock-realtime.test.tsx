import { act, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
    POS_STOCK_POLL_INTERVAL_MS,
    POS_STOCK_RECONCILE_INTERVAL_MS,
    mergePosStockSnapshot,
    usePosStockRealtime,
    type PosStockSnapshotProduct,
} from "@/hooks/use-pos-stock-realtime"

class FakeEventSource {
    static instances: FakeEventSource[] = []

    readonly url: string
    onopen: (() => void) | null = null
    onerror: (() => void) | null = null
    closed = false
    private listeners = new Map<string, Set<() => void>>()

    constructor(url: string | URL) {
        this.url = String(url)
        FakeEventSource.instances.push(this)
    }

    addEventListener(type: string, listener: () => void) {
        const listeners = this.listeners.get(type) || new Set()
        listeners.add(listener)
        this.listeners.set(type, listeners)
    }

    removeEventListener(type: string, listener: () => void) {
        this.listeners.get(type)?.delete(listener)
    }

    emit(type: string) {
        this.listeners.get(type)?.forEach((listener) => listener())
    }

    close() {
        this.closed = true
    }
}

const initialProducts = [{
    _id: "product-1",
    name: "Salamella",
    basePrice: 6,
    stockQuantity: 5,
    isSoldOut: false,
    stockStatus: "OK" as const,
    variants: [{ optionName: "Doppia", priceVariation: 2, stockQuantity: 3 }],
}]

const snapshot: PosStockSnapshotProduct[] = [{
    _id: "product-1",
    stockQuantity: 0,
    isSoldOut: true,
    stockStatus: "OUT",
    variants: [{ optionName: "Doppia", priceVariation: 99, stockQuantity: 1 }],
}]

function Harness({ eventId = "event-1" }: { eventId?: string }) {
    const [products, setProducts] = useState(initialProducts)
    const status = usePosStockRealtime(eventId, setProducts)

    return (
        <>
            <p data-testid="status">{status}</p>
            <p data-testid="products">{JSON.stringify(products)}</p>
        </>
    )
}

describe("POS stock realtime", () => {
    beforeEach(() => {
        FakeEventSource.instances = []
        vi.stubGlobal("EventSource", FakeEventSource)
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ eventId: "event-1", products: snapshot }),
        }))
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    test("fonde soltanto i campi scorta e conserva i metadati catalogo", () => {
        const result = mergePosStockSnapshot(initialProducts, snapshot)

        expect(result[0]).toMatchObject({
            name: "Salamella",
            basePrice: 6,
            stockQuantity: 0,
            isSoldOut: true,
            stockStatus: "OUT",
        })
        expect(result[0].variants).toEqual([
            { optionName: "Doppia", priceVariation: 2, stockQuantity: 1 },
        ])
        expect(initialProducts[0].stockQuantity).toBe(5)
    })

    test("si riallinea all'apertura e alle invalidazioni dello stream", async () => {
        const view = render(<Harness />)
        const source = FakeEventSource.instances[0]

        expect(source.url).toBe("/api/pos/stock-stream?eventId=event-1")
        expect(screen.getByTestId("status")).toHaveTextContent("connecting")

        act(() => source.onopen?.())

        await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("live"))
        await waitFor(() => expect(screen.getByTestId("products")).toHaveTextContent('"stockQuantity":0'))
        expect(fetch).toHaveBeenCalledWith("/api/pos/stock?eventId=event-1", { cache: "no-store" })

        act(() => source.emit("stock"))
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

        view.unmount()
        expect(source.closed).toBe(true)
    })

    test("mantiene una riconciliazione periodica anche quando SSE è live e la ferma al cleanup", async () => {
        vi.useFakeTimers()
        const view = render(<Harness />)
        const source = FakeEventSource.instances[0]

        await act(async () => {
            source.onopen?.()
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(screen.getByTestId("status")).toHaveTextContent("live")
        expect(fetch).toHaveBeenCalledTimes(1)

        await act(async () => {
            vi.advanceTimersByTime(POS_STOCK_RECONCILE_INTERVAL_MS)
            await Promise.resolve()
        })
        expect(fetch).toHaveBeenCalledTimes(2)

        view.unmount()

        await act(async () => {
            vi.advanceTimersByTime(POS_STOCK_RECONCILE_INTERVAL_MS * 2)
            await Promise.resolve()
        })
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(source.closed).toBe(true)
    })

    test("usa polling senza sovrapporre richieste e lo ferma alla riconnessione", async () => {
        vi.useFakeTimers()
        let resolveFetch!: (value: { ok: boolean; json: () => Promise<unknown> }) => void
        vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => {
            resolveFetch = resolve
        }) as Promise<Response>)
        const view = render(<Harness />)
        const source = FakeEventSource.instances[0]

        act(() => source.onerror?.())
        expect(screen.getByTestId("status")).toHaveTextContent("polling")
        expect(fetch).toHaveBeenCalledTimes(1)

        act(() => vi.advanceTimersByTime(POS_STOCK_POLL_INTERVAL_MS))
        expect(fetch).toHaveBeenCalledTimes(1)

        await act(async () => {
            resolveFetch({
                ok: true,
                json: async () => ({ eventId: "event-1", products: snapshot }),
            })
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(fetch).toHaveBeenCalledTimes(2)

        await act(async () => {
            vi.advanceTimersByTime(POS_STOCK_POLL_INTERVAL_MS)
            await Promise.resolve()
        })
        expect(fetch).toHaveBeenCalledTimes(3)

        act(() => source.onopen?.())
        expect(screen.getByTestId("status")).toHaveTextContent("live")
        const callsAtReconnect = vi.mocked(fetch).mock.calls.length
        act(() => vi.advanceTimersByTime(POS_STOCK_POLL_INTERVAL_MS * 2))
        expect(fetch).toHaveBeenCalledTimes(callsAtReconnect)

        view.unmount()
    })

    test("accoda una sola lettura quando arrivano invalidazioni durante uno snapshot", async () => {
        let resolveFirst!: (value: { ok: boolean; json: () => Promise<unknown> }) => void
        vi.mocked(fetch)
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveFirst = resolve
            }) as Promise<Response>)
            .mockResolvedValue({
                ok: true,
                json: async () => ({ eventId: "event-1", products: snapshot }),
            } as Response)
        render(<Harness />)
        const source = FakeEventSource.instances[0]

        act(() => source.onopen?.())
        act(() => {
            source.emit("stock")
            source.emit("stock")
        })
        expect(fetch).toHaveBeenCalledTimes(1)

        await act(async () => {
            resolveFirst({
                ok: true,
                json: async () => ({ eventId: "event-1", products: initialProducts }),
            })
            await Promise.resolve()
            await Promise.resolve()
        })

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(screen.getByTestId("products")).toHaveTextContent('"stockQuantity":0'))
    })

    test("torna live dopo uno snapshot fallito quando SSE è ancora connesso", async () => {
        vi.useFakeTimers()
        vi.mocked(fetch)
            .mockRejectedValueOnce(new Error("errore temporaneo"))
            .mockResolvedValue({
                ok: true,
                json: async () => ({ eventId: "event-1", products: snapshot }),
            } as Response)
        render(<Harness />)
        const source = FakeEventSource.instances[0]

        await act(async () => {
            source.onopen?.()
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(screen.getByTestId("status")).toHaveTextContent("polling")

        await act(async () => {
            vi.advanceTimersByTime(POS_STOCK_POLL_INTERVAL_MS)
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(screen.getByTestId("status")).toHaveTextContent("live")
        expect(fetch).toHaveBeenCalledTimes(2)

        act(() => vi.advanceTimersByTime(POS_STOCK_POLL_INTERVAL_MS * 2))
        expect(fetch).toHaveBeenCalledTimes(2)
    })
})
