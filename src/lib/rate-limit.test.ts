import { beforeEach, describe, expect, test } from "vitest";
import { consumeRateLimit, isRateLimited, resetRateLimit, resolveClientKey } from "@/lib/rate-limit";

describe("rate limit", () => {
    beforeEach(() => resetRateLimit());

    test("blocks once the limit is exceeded inside the window", () => {
        const now = 1_000;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            expect(consumeRateLimit("k", 3, 60_000, now).allowed).toBe(true);
        }
        const blocked = consumeRateLimit("k", 3, 60_000, now);
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSeconds).toBe(60);
    });

    test("reopens after the window expires", () => {
        consumeRateLimit("k", 1, 60_000, 1_000);
        expect(consumeRateLimit("k", 1, 60_000, 1_000).allowed).toBe(false);
        expect(consumeRateLimit("k", 1, 60_000, 62_000).allowed).toBe(true);
    });

    test("isRateLimited does not consume the bucket", () => {
        consumeRateLimit("k", 2, 60_000, 1_000);
        expect(isRateLimited("k", 2, 1_000).allowed).toBe(true);
        expect(isRateLimited("k", 2, 1_000).allowed).toBe(true);
        consumeRateLimit("k", 2, 60_000, 1_000);
        expect(isRateLimited("k", 2, 1_000).allowed).toBe(false);
    });

    test("keys are independent and resolvable from proxy headers", () => {
        consumeRateLimit("a", 1, 60_000, 1_000);
        expect(consumeRateLimit("b", 1, 60_000, 1_000).allowed).toBe(true);
        expect(resolveClientKey(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
        expect(resolveClientKey(new Headers())).toBe("unknown");
        expect(resolveClientKey(undefined)).toBe("unknown");
    });
});
