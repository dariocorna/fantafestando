export const TABLE_CODE_LETTERS = ["A", "B", "C", "D", "E", "F"] as const

const TABLE_CODE_PATTERN = /^[A-F][0-9]{2}$/

function sanitizeRaw(raw?: string | null): string {
    return (raw || "").trim().toUpperCase()
}

export function sanitizeTableLetter(raw?: string | null): string {
    const match = sanitizeRaw(raw).match(/[A-F]/)
    return match ? match[0] : ""
}

export function sanitizeTableDigits(raw?: string | null): string {
    return sanitizeRaw(raw).replace(/\D/g, "").slice(0, 2)
}

export function buildTableCode(letterRaw?: string | null, digitsRaw?: string | null): string {
    const letter = sanitizeTableLetter(letterRaw)
    const digits = sanitizeTableDigits(digitsRaw)
    return `${letter}${digits}`
}

export function parseTableCode(raw?: string | null): { letter: string, digits: string, code: string } {
    const sanitized = sanitizeRaw(raw)
    const letter = sanitizeTableLetter(sanitized)
    const digits = sanitizeTableDigits(sanitized.replace(/[A-F]/g, ""))
    return {
        letter,
        digits,
        code: `${letter}${digits}`
    }
}

export function normalizeTableCode(raw?: string | null): string {
    return parseTableCode(raw).code
}

export function isValidTableCode(raw?: string | null): boolean {
    return TABLE_CODE_PATTERN.test(normalizeTableCode(raw))
}
