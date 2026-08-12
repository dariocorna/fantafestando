import { describe, expect, test, vi } from "vitest"
import { publishStockInvalidation, subscribeStockInvalidation } from "@/lib/pos-stock-realtime"

describe("POS stock invalidation bus", () => {
    test("publishes only to listeners of the matching event", () => {
        const eventOne = vi.fn()
        const eventTwo = vi.fn()
        const unsubscribeOne = subscribeStockInvalidation("event-1", eventOne)
        const unsubscribeTwo = subscribeStockInvalidation("event-2", eventTwo)

        publishStockInvalidation("event-1")

        expect(eventOne).toHaveBeenCalledWith("event-1")
        expect(eventTwo).not.toHaveBeenCalled()
        unsubscribeOne()
        unsubscribeTwo()
    })

    test("stops publishing after unsubscribe", () => {
        const listener = vi.fn()
        const unsubscribe = subscribeStockInvalidation("event-unsubscribe", listener)

        unsubscribe()
        publishStockInvalidation("event-unsubscribe")

        expect(listener).not.toHaveBeenCalled()
    })

    test("drops a failed listener without blocking the others", () => {
        const failed = vi.fn(() => { throw new Error("stream closed") })
        const healthy = vi.fn()
        const unsubscribeFailed = subscribeStockInvalidation("event-failure", failed)
        const unsubscribeHealthy = subscribeStockInvalidation("event-failure", healthy)

        expect(() => publishStockInvalidation("event-failure")).not.toThrow()
        publishStockInvalidation("event-failure")

        expect(failed).toHaveBeenCalledTimes(1)
        expect(healthy).toHaveBeenCalledTimes(2)
        unsubscribeFailed()
        unsubscribeHealthy()
    })
})
