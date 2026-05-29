export interface PosCartLine {
  lineId: string
  productId: string
  quantity: number
  isDiscount?: boolean
}

function normalizeQuantity(quantity: number) {
  if (!Number.isFinite(quantity)) return 0
  return Math.max(0, Math.floor(quantity))
}

export function buildProductQuantityMap<T extends PosCartLine>(cart: T[]) {
  const quantities = new Map<string, number>()

  for (const item of cart) {
    if (item.isDiscount) continue
    const quantity = normalizeQuantity(item.quantity)
    if (quantity <= 0) continue
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + quantity)
  }

  return quantities
}

export function getProductQuantityInCart<T extends PosCartLine>(cart: T[], productId: string) {
  return buildProductQuantityMap(cart).get(productId) ?? 0
}

export function decrementProductQuantityInCart<T extends PosCartLine>(cart: T[], productId: string): T[] {
  const itemIndex = cart.findLastIndex((item) => !item.isDiscount && item.productId === productId)
  if (itemIndex < 0) return cart

  const item = cart[itemIndex]
  const quantity = normalizeQuantity(item.quantity)
  if (quantity <= 1) {
    return cart.filter((_, index) => index !== itemIndex)
  }

  return cart.map((entry, index) => (
    index === itemIndex
      ? { ...entry, quantity: quantity - 1 }
      : entry
  ))
}
