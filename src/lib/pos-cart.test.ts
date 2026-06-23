import { describe, expect, test } from "vitest"

import {
  buildProductQuantityMap,
  decrementProductQuantityInCart,
  getProductQuantityInCart,
  type PosCartLine,
} from "./pos-cart"

describe("pos-cart", () => {
  test("aggrega la quantita per prodotto escludendo gli sconti", () => {
    const cart: PosCartLine[] = [
      { lineId: "p1", productId: "prod-1", quantity: 2 },
      { lineId: "p1-config", productId: "prod-1", quantity: 1 },
      { lineId: "p2", productId: "prod-2", quantity: 3 },
      { lineId: "discount-line-1", productId: "discount-line-1", quantity: 1, isDiscount: true },
    ]

    const quantities = buildProductQuantityMap(cart)

    expect(quantities.get("prod-1")).toBe(3)
    expect(quantities.get("prod-2")).toBe(3)
    expect(quantities.has("discount-line-1")).toBe(false)
    expect(getProductQuantityInCart(cart, "prod-1")).toBe(3)
  })

  test("decrementa una riga con quantita maggiore di uno", () => {
    const cart: PosCartLine[] = [
      { lineId: "p1", productId: "prod-1", quantity: 3 },
    ]

    const nextCart = decrementProductQuantityInCart(cart, "prod-1")

    expect(nextCart).toEqual([{ lineId: "p1", productId: "prod-1", quantity: 2 }])
  })

  test("rimuove la riga quando la quantita arriva a zero", () => {
    const cart: PosCartLine[] = [
      { lineId: "p1", productId: "prod-1", quantity: 1 },
      { lineId: "p2", productId: "prod-2", quantity: 1 },
    ]

    const nextCart = decrementProductQuantityInCart(cart, "prod-1")

    expect(nextCart).toEqual([{ lineId: "p2", productId: "prod-2", quantity: 1 }])
  })

  test("decrementa l'ultima riga configurata dello stesso prodotto", () => {
    const cart: PosCartLine[] = [
      { lineId: "prod-menu:side-fries", productId: "prod-menu", quantity: 1 },
      { lineId: "prod-menu:side-salad", productId: "prod-menu", quantity: 2 },
    ]

    const nextCart = decrementProductQuantityInCart(cart, "prod-menu")

    expect(nextCart).toEqual([
      { lineId: "prod-menu:side-fries", productId: "prod-menu", quantity: 1 },
      { lineId: "prod-menu:side-salad", productId: "prod-menu", quantity: 1 },
    ])
  })

  test("non modifica il carrello quando il prodotto non e presente", () => {
    const cart: PosCartLine[] = [
      { lineId: "p1", productId: "prod-1", quantity: 1 },
    ]

    const nextCart = decrementProductQuantityInCart(cart, "prod-missing")

    expect(nextCart).toBe(cart)
  })
})
