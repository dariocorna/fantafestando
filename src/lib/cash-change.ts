const COMMON_AMOUNTS_CENTS = [1000, 2000, 5000, 10000, 20000]

export function toCents(value: number) {
  return Math.round(value * 100)
}

export function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} €`
}

export function normalizeCashReceivedInput(value: string) {
  // Locale IT: se c'è la virgola (separatore decimale) i punti sono raggruppamenti migliaia
  // e vanno rimossi ("1.000,50" -> 1000,50); senza virgola un punto è trattato come decimale
  // (tolleranza per incollaggi stile US, es. "12.34").
  const unified = value.includes(",") ? value.replace(/\./g, "") : value.replace(".", ",")
  const normalized = unified.replace(/[^\d,]/g, "")
  const [integerRaw, ...decimalParts] = normalized.split(",")
  const integer = integerRaw.replace(/^0+(?=\d)/, "")
  if (decimalParts.length === 0) return integer

  return `${integer || "0"},${decimalParts.join("").slice(0, 2)}`
}

export function buildCashReceivedSuggestions(total: number) {
  const totalCents = toCents(total)
  if (totalCents <= 0) return []

  const nextFiveCents = Math.ceil((totalCents + 1) / 500) * 500
  return [...new Set([
    nextFiveCents,
    nextFiveCents + 500,
    nextFiveCents + 1000,
    ...COMMON_AMOUNTS_CENTS.filter((amount) => amount > totalCents),
  ])].sort((a, b) => a - b).slice(0, 5)
}
