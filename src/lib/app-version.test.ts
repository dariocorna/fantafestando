import { afterEach, describe, expect, test, vi } from "vitest";
import packageJson from "../../package.json";
import { getAppVersion, getAppVersionLabel } from "@/lib/app-version";

describe("app version", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    test("uses package version by default", () => {
        expect(getAppVersion()).toBe(packageJson.version);
        expect(getAppVersionLabel()).toBe(`v${packageJson.version}`);
    });

    test("supports APP_VERSION override", () => {
        vi.stubEnv("APP_VERSION", "2.1.0");

        expect(getAppVersion()).toBe("2.1.0");
        expect(getAppVersionLabel()).toBe("v2.1.0");
    });

    test("includes optional APP_BUILD label", () => {
        vi.stubEnv("APP_VERSION", "2.1.0");
        vi.stubEnv("APP_BUILD", "build-42");

        expect(getAppVersionLabel()).toBe("v2.1.0 (build-42)");
    });
});
