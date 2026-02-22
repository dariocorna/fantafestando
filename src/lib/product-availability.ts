export const DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const

export type DayCode = (typeof DAY_CODES)[number]

export const DAY_LABELS_IT: Record<DayCode, string> = {
    MON: "LUN",
    TUE: "MAR",
    WED: "MER",
    THU: "GIO",
    FRI: "VEN",
    SAT: "SAB",
    SUN: "DOM"
}

const SHORT_WEEKDAY_TO_CODE: Record<string, DayCode> = {
    Mon: "MON",
    Tue: "TUE",
    Wed: "WED",
    Thu: "THU",
    Fri: "FRI",
    Sat: "SAT",
    Sun: "SUN"
}

export function normalizeAvailableDays(raw?: string[] | string | null): DayCode[] {
    const chunks = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
            ? raw.split(/[\n,;]+/)
            : []

    const selected = new Set<DayCode>()

    for (const chunk of chunks) {
        const normalized = chunk.trim().toUpperCase()
        if (DAY_CODES.includes(normalized as DayCode)) {
            selected.add(normalized as DayCode)
        }
    }

    return DAY_CODES.filter((code) => selected.has(code))
}

export function serializeAvailableDays(days?: string[] | null): string {
    return normalizeAvailableDays(days || []).join(",")
}

export function parseAvailableDaysInput(raw?: string | null): DayCode[] {
    return normalizeAvailableDays(raw || "")
}

export function getCurrentDayCode(timeZone = "Europe/Rome", atDate = new Date()): DayCode {
    const weekdayShort = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone
    }).format(atDate)

    return SHORT_WEEKDAY_TO_CODE[weekdayShort] || "MON"
}

export function isProductAvailableToday(availableDays: string[] | null | undefined, currentDay: DayCode): boolean {
    const normalized = normalizeAvailableDays(availableDays || [])
    if (normalized.length === 0) return true
    return normalized.includes(currentDay)
}

export function formatAvailableDaysLabel(availableDays: string[] | null | undefined): string {
    const normalized = normalizeAvailableDays(availableDays || [])
    if (normalized.length === 0) return "Sempre"
    return normalized.map((day) => DAY_LABELS_IT[day]).join(" · ")
}
