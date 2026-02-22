import { describe, expect, it, beforeEach } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secrets";

describe("secrets", () => {
    beforeEach(() => {
        process.env.EVENT_SETTINGS_ENCRYPTION_KEY = "test-secret-key";
    });

    it("encrypts and decrypts secrets", () => {
        const encrypted = encryptSecret("sup_sk_test_123");
        expect(isEncryptedSecret(encrypted)).toBe(true);
        expect(decryptSecret(encrypted)).toBe("sup_sk_test_123");
    });

    it("supports legacy plaintext values", () => {
        expect(isEncryptedSecret("sup_sk_legacy")).toBe(false);
        expect(decryptSecret("sup_sk_legacy")).toBe("sup_sk_legacy");
    });

    it("returns undefined for malformed encrypted payload", () => {
        expect(decryptSecret("enc:v1:not.valid")).toBeUndefined();
    });
});
