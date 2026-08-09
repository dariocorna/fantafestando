import { formatDashboardDateTime, type DashboardOrderInput } from "./dashboard-stats"

export type DashboardTimeRangeMode = "realtime" | "evening" | "event" | "custom"

export interface DashboardTimeRange {
    mode: DashboardTimeRangeMode
    timezone: string
    startMs: number | null
    endMs: number | null
    startInput: string
    endInput: string
    label: string
    isRealtime: boolean
    isValid: boolean
    error?: string
}

interface ResolveDashboardTimeRangeOptions {
    mode?: string | null
    from?: string | null
    to?: string | null
    timezone?: string | null
    now?: Date | string
}

const DEFAULT_TIMEZONE = "Europe/Rome"

function isValidTimezone(value: string): boolean {
    try {
        new Intl.DateTimeFormat("it-IT", { timeZone: value }).format(new Date())
        return true
    } catch {
        return false
    }
}

function normalizeTimezone(value: string | null | undefined): string {
    const normalized = value?.trim()
    if (!normalized) return DEFAULT_TIMEZONE
    return isValidTimezone(normalized) ? normalized : DEFAULT_TIMEZONE
}

function parseDateToMs(value: Date | string | null | undefined): number | null {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    const dateMs = date.getTime()
    return Number.isFinite(dateMs) ? dateMs : null
}

function getOffsetMinutes(date: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        timeZoneName: "shortOffset",
        hour: "2-digit"
    })
    const zonePart = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT"
    const match = zonePart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
    if (!match) return 0

    const sign = match[1] === "-" ? -1 : 1
    const hours = Number(match[2] || 0)
    const minutes = Number(match[3] || 0)
    return sign * (hours * 60 + minutes)
}

function toUtcMsFromLocalInput(value: string, timezone: string): number | null {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
    if (!match) return null

    const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match
    const year = Number(yearRaw)
    const month = Number(monthRaw)
    const day = Number(dayRaw)
    const hour = Number(hourRaw)
    const minute = Number(minuteRaw)

    if ([year, month, day, hour, minute].some((part) => !Number.isFinite(part))) return null

    let utcMs = Date.UTC(year, month - 1, day, hour, minute)
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const offsetMinutes = getOffsetMinutes(new Date(utcMs), timezone)
        const nextUtcMs = Date.UTC(year, month - 1, day, hour, minute) - (offsetMinutes * 60 * 1000)
        if (nextUtcMs === utcMs) break
        utcMs = nextUtcMs
    }

    return utcMs
}

function resolveUtcMsFromLocalInput(
    value: string,
    timezone: string
): { utcMs: number | null, error?: string } {
    if (!value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)) {
        return { utcMs: null, error: "Inserisci data e ora valide." }
    }

    const naiveUtcMs = Date.parse(`${value}:00.000Z`)
    if (!Number.isFinite(naiveUtcMs)) {
        return { utcMs: null, error: "Inserisci data e ora valide." }
    }

    const offsets = new Set<number>()
    for (const hoursDelta of [-36, -24, -12, 0, 12, 24, 36]) {
        offsets.add(getOffsetMinutes(new Date(naiveUtcMs + (hoursDelta * 60 * 60 * 1000)), timezone))
    }

    const candidates = [...offsets]
        .map((offsetMinutes) => naiveUtcMs - (offsetMinutes * 60 * 1000))
        .filter((candidateUtcMs, index, allCandidates) => (
            toLocalDateTimeInput(candidateUtcMs, timezone) === value
            && allCandidates.indexOf(candidateUtcMs) === index
        ))
        .sort((left, right) => left - right)

    if (candidates.length === 1) {
        return { utcMs: candidates[0] }
    }

    if (candidates.length > 1) {
        return { utcMs: null, error: "L'orario selezionato è ambiguo nel fuso orario configurato. Scegli un'ora diversa." }
    }

    return { utcMs: null, error: "L'orario selezionato non esiste nel fuso orario configurato. Scegli un'ora diversa." }
}

function toLocalDateTimeInput(value: Date | string | number | null | undefined, timezone: string): string {
    const dateMs = typeof value === "number" ? value : parseDateToMs(value)
    if (dateMs === null) return ""

    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    })
    const parts = formatter.formatToParts(new Date(dateMs))
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

function getLocalDayInput(value: Date | string, timezone: string): string {
    const input = toLocalDateTimeInput(value, timezone)
    return input.slice(0, 10)
}

function addDaysToLocalDayInput(value: string, days: number): string {
    const [year, month, day] = value.split("-").map((part) => Number(part))
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function buildPresetBounds(mode: DashboardTimeRangeMode, now: Date, timezone: string) {
    if (mode === "event") {
        return { startMs: null, endMs: null }
    }

    const today = getLocalDayInput(now, timezone)
    const todayStartMs = toUtcMsFromLocalInput(`${today}T00:00`, timezone)
    if (todayStartMs === null) {
        return { startMs: null, endMs: null }
    }

    const nextDayLocal = addDaysToLocalDayInput(today, 1)
    const nextDayStartMs = toUtcMsFromLocalInput(`${nextDayLocal}T00:00`, timezone)

    return {
        startMs: todayStartMs,
        endMs: mode === "realtime" ? now.getTime() + 1 : nextDayStartMs
    }
}

export function resolveDashboardTimeRange(options: ResolveDashboardTimeRangeOptions): DashboardTimeRange {
    const timezone = normalizeTimezone(options.timezone)
    const nowMs = parseDateToMs(options.now ?? new Date()) ?? Date.now()
    const now = new Date(nowMs)
    const normalizedMode = (options.mode || "realtime").trim().toLowerCase()
    const mode: DashboardTimeRangeMode =
        normalizedMode === "custom"
            ? "custom"
            : normalizedMode === "event"
                ? "event"
                : normalizedMode === "evening"
                    ? "evening"
                    : "realtime"

    if (mode === "custom") {
        const startInput = options.from?.trim() || ""
        const endInput = options.to?.trim() || ""
        const startResolution = resolveUtcMsFromLocalInput(startInput, timezone)
        const endResolution = resolveUtcMsFromLocalInput(endInput, timezone)
        const startMs = startResolution.utcMs
        const endMs = endResolution.utcMs

        if (!startInput || !endInput) {
            return {
                mode,
                timezone,
                startMs: null,
                endMs: null,
                startInput,
                endInput,
                label: "Intervallo personalizzato non valido",
                isRealtime: false,
                isValid: false,
                error: "Inserisci data e ora iniziali e finali valide."
            }
        }

        if (startResolution.error) {
            return {
                mode,
                timezone,
                startMs: null,
                endMs: null,
                startInput,
                endInput,
                label: "Intervallo personalizzato non valido",
                isRealtime: false,
                isValid: false,
                error: `Data iniziale non valida: ${startResolution.error}`
            }
        }

        if (endResolution.error) {
            return {
                mode,
                timezone,
                startMs: null,
                endMs: null,
                startInput,
                endInput,
                label: "Intervallo personalizzato non valido",
                isRealtime: false,
                isValid: false,
                error: `Data finale non valida: ${endResolution.error}`
            }
        }

        if (startMs === null || endMs === null) {
            return {
                mode,
                timezone,
                startMs: null,
                endMs: null,
                startInput,
                endInput,
                label: "Intervallo personalizzato non valido",
                isRealtime: false,
                isValid: false,
                error: "Inserisci data e ora iniziali e finali valide."
            }
        }

        if (startMs >= endMs) {
            return {
                mode,
                timezone,
                startMs,
                endMs,
                startInput,
                endInput,
                label: "Intervallo personalizzato non valido",
                isRealtime: false,
                isValid: false,
                error: "La data finale deve essere successiva a quella iniziale."
            }
        }

        return {
            mode,
            timezone,
            startMs,
            endMs,
            startInput,
            endInput,
            label: `Intervallo personalizzato · ${formatDashboardDateTime(new Date(startMs), timezone)} → ${formatDashboardDateTime(new Date(endMs - 1), timezone)}`,
            isRealtime: false,
            isValid: true
        }
    }

    const { startMs, endMs } = buildPresetBounds(mode, now, timezone)
    const startInput = startMs === null ? "" : toLocalDateTimeInput(startMs, timezone)
    const endInput = endMs === null ? "" : toLocalDateTimeInput(Math.ceil(endMs / 60_000) * 60_000, timezone)

    if (mode === "event") {
        return {
            mode,
            timezone,
            startMs,
            endMs,
            startInput,
            endInput,
            label: "Intera festa",
            isRealtime: false,
            isValid: true
        }
    }

    const presetLabel = mode === "realtime" ? "Tempo reale" : "Serata corrente"
    const labelStartMs = startMs ?? nowMs
    const labelEndMs = Math.max(labelStartMs, (endMs ?? nowMs + 1) - 1)
    return {
        mode,
        timezone,
        startMs,
        endMs,
        startInput,
        endInput,
        label: `${presetLabel} · ${formatDashboardDateTime(new Date(labelStartMs), timezone)} → ${formatDashboardDateTime(new Date(labelEndMs), timezone)}`,
        isRealtime: mode === "realtime",
        isValid: true
    }
}

export function getDashboardOrderOccurredAt(order: DashboardOrderInput): Date | string | null | undefined {
    return order.paidAt ?? order.createdAt
}

export function filterDashboardOrdersByTimeRange(
    orders: DashboardOrderInput[],
    range: Pick<DashboardTimeRange, "isValid" | "startMs" | "endMs">
): DashboardOrderInput[] {
    if (!range.isValid) return []

    return orders.filter((order) => {
        const occurredAtMs = parseDateToMs(getDashboardOrderOccurredAt(order))
        if (occurredAtMs === null) return false
        if (range.startMs !== null && occurredAtMs < range.startMs) return false
        if (range.endMs !== null && occurredAtMs >= range.endMs) return false
        return true
    })
}
