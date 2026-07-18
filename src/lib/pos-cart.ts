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

export function decrementProductQuantityInCart<T extends PosCartLine>(
  cart: T[],
  productId: string,
  isCustomized?: (item: T) => boolean
): T[] {
  const matches = cart
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.isDiscount && item.productId === productId)
  if (matches.length === 0) return cart

  // Preferisci decrementare una riga non personalizzata: il pulsante del catalogo non deve
  // cancellare in silenzio una unità con note/comanda singola quando esiste un'unità normale.
  const plain = isCustomized ? matches.filter(({ item }) => !isCustomized(item)) : matches
  const pool = plain.length > 0 ? plain : matches
  const itemIndex = pool[pool.length - 1].index

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

export function replaceSingleCartUnit<T extends PosCartLine>(
  cart: T[],
  lineId: string,
  editedItem: T,
  getMergeKey: (item: T) => string
): T[] {
  const itemIndex = cart.findIndex((item) => item.lineId === lineId && !item.isDiscount)
  if (itemIndex < 0) return cart

  const item = cart[itemIndex]
  const quantity = normalizeQuantity(item.quantity)
  const replacement = { ...editedItem, quantity: 1 }
  const splitCart = quantity > 1
    ? cart.flatMap((entry, index) => (
      index === itemIndex
        ? [{ ...entry, quantity: quantity - 1 }, replacement]
        : [entry]
    ))
    : cart.map((entry, index) => index === itemIndex ? replacement : entry)

  const merged: T[] = []
  for (const entry of splitCart) {
    const entryQuantity = normalizeQuantity(entry.quantity)
    if (entryQuantity <= 0) continue
    if (entry.isDiscount) {
      merged.push({ ...entry, quantity: entryQuantity })
      continue
    }

    const mergeKey = getMergeKey(entry)
    const existingIndex = merged.findIndex((candidate) => !candidate.isDiscount && getMergeKey(candidate) === mergeKey)
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        quantity: merged[existingIndex].quantity + entryQuantity
      }
    } else {
      merged.push({ ...entry, quantity: entryQuantity })
    }
  }

  return merged
}
