import { vi } from "vitest"
import {
    EMPTY_STORED_MENU_CART_ITEMS,
    getStoredMenuCartItemsForEvent,
    parseStoredMenuCart,
} from "@/app/menu/cart-storage"

describe("menu cart storage", () => {
    test("supports legacy array payloads when paired with the stored event id", () => {
        const payload = parseStoredMenuCart(
            JSON.stringify([
                { _id: "p1", name: "Pizza", basePrice: 8, quantity: 2 },
            ]),
            "event-1",
        )

        expect(payload).toEqual({
            eventId: "event-1",
            items: [
                { lineId: "p1", _id: "p1", name: "Pizza", basePrice: 8, quantity: 2, selectedOptions: [], menuSelections: [] },
            ],
        })
        expect(getStoredMenuCartItemsForEvent(payload, "event-1")).toEqual(payload.items)
    })

    test("rejects carts from a different event", () => {
        const payload = parseStoredMenuCart(
            JSON.stringify({
                eventId: "event-a",
                items: [
                    { _id: "p1", name: "Pizza", basePrice: 8, quantity: 1 },
                ],
            }),
            null,
        )

        expect(getStoredMenuCartItemsForEvent(payload, "event-b")).toBe(EMPTY_STORED_MENU_CART_ITEMS)
    })

    test("drops malformed items during parsing", () => {
        const payload = parseStoredMenuCart(
            JSON.stringify({
                eventId: "event-a",
                items: [
                    { _id: "p1", name: "Pizza", basePrice: 8, quantity: 1 },
                    { _id: "", name: "Broken", basePrice: 4, quantity: 1 },
                    { _id: "p2", name: "Bad Qty", basePrice: 4, quantity: 0 },
                ],
            }),
            null,
        )

        expect(payload).toEqual({
            eventId: "event-a",
            items: [
                { lineId: "p1", _id: "p1", name: "Pizza", basePrice: 8, quantity: 1, selectedOptions: [], menuSelections: [] },
            ],
        })
    })

    test("returns an empty payload for invalid json", () => {
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
        const payload = parseStoredMenuCart("{", "event-1")

        expect(payload).toEqual({
            eventId: "event-1",
            items: [],
        })
        expect(consoleErrorSpy).toHaveBeenCalled()
        consoleErrorSpy.mockRestore()
    })
})
