import { describe, expect, test } from "vitest"
import {
  buildCashReceivedSuggestions,
  formatCents,
  normalizeCashReceivedInput,
  toCents,
} from "./cash-change"

describe("cash change", () => {
  test("normalizza importi monetari digitati o incollati", () => {
    expect(normalizeCashReceivedInput("0012.345abc")).toBe("12,34")
    expect(normalizeCashReceivedInput(",5")).toBe("0,5")
    expect(normalizeCashReceivedInput("1,2,3")).toBe("1,23")
    // Importo incollato con separatore migliaia: il punto non deve azzerare il valore
    expect(normalizeCashReceivedInput("1.000,50")).toBe("1000,50")
    expect(normalizeCashReceivedInput("2.500")).toBe("2,50")
  })

  test("converte e formatta i centesimi senza errori floating point", () => {
    expect(toCents(18.5)).toBe(1850)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(formatCents(150)).toBe("1.50 €")
  })

  test("propone tagli superiori al totale senza duplicati", () => {
    expect(buildCashReceivedSuggestions(18.5)).toEqual([2000, 2500, 3000, 5000, 10000])
    expect(buildCashReceivedSuggestions(20)).toEqual([2500, 3000, 3500, 5000, 10000])
    expect(buildCashReceivedSuggestions(0)).toEqual([])
  })
})
