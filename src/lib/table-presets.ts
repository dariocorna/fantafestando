export const MAX_PREDEFINED_TABLES = 150

export function normalizeTableValue(raw?: string | null): string {
    return (raw || "").trim().replace(/\s+/g, " ")
}

export function isTableValueValid(raw?: string | null): boolean {
    return normalizeTableValue(raw).length > 0
}

export function parsePredefinedTablesInput(raw?: string | null, maxItems = MAX_PREDEFINED_TABLES): string[] {
    const chunks = (raw || "").split(/[\n,]+/)
    const unique: string[] = []
    const seen = new Set<string>()

    for (const chunk of chunks) {
        const normalized = normalizeTableValue(chunk)
        if (!normalized) continue

        const dedupeKey = normalized.toLowerCase()
        if (seen.has(dedupeKey)) continue

        seen.add(dedupeKey)
        unique.push(normalized)

        if (unique.length >= maxItems) break
    }

    return unique
}

export function countDistinctPredefinedTables(raw?: string | null): number {
    const chunks = (raw || "").split(/[\n,]+/)
    const seen = new Set<string>()

    for (const chunk of chunks) {
        const normalized = normalizeTableValue(chunk)
        if (!normalized) continue
        seen.add(normalized.toLowerCase())
    }

    return seen.size
}

export function formatPredefinedTablesForTextarea(values?: string[] | null): string {
    if (!Array.isArray(values)) return ""
    return parsePredefinedTablesInput(values.join("\n"), Number.MAX_SAFE_INTEGER).join("\n")
}
