/** Normalizes a Host / X-Forwarded-Host / origin value to a bare hostname. */
export function normalizeHostname(value: string | null | undefined): string {
    const first = value?.split(",")[0]?.trim().toLowerCase() || "";
    if (!first) return "";
    try {
        return new URL(first.includes("://") ? first : `http://${first}`).hostname.toLowerCase();
    } catch {
        return "";
    }
}
