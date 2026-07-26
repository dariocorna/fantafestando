// ponytail: in-memory fixed window, per process. Enough for a single-container
// deployment; move to Mongo/Redis if the app is ever replicated.
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

export function consumeRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now()
): RateLimitResult {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        if (buckets.size > 10_000) {
            for (const [entryKey, entry] of buckets) {
                if (entry.resetAt <= now) buckets.delete(entryKey);
            }
        }
        return { allowed: true, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    if (bucket.count > limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    return { allowed: true, retryAfterSeconds: 0 };
}

/** Checks the bucket without consuming it (for failure-only counters). */
export function isRateLimited(
    key: string,
    limit: number,
    now: number = Date.now()
): RateLimitResult {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now || bucket.count < limit) {
        return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
}

export function resetRateLimit(key?: string) {
    if (key) buckets.delete(key);
    else buckets.clear();
}

/** Best-effort client identity: the edge proxy is the only trusted hop. */
export function resolveClientKey(requestHeaders?: Pick<Headers, "get"> | null): string {
    const forwarded = requestHeaders?.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || requestHeaders?.get("x-real-ip")?.trim() || "unknown";
}
