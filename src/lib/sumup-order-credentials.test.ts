import { afterAll, beforeEach, describe, expect, test, vi } from "vitest"

import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/lib/secrets"
import { buildSumUpRefundCredentialsSnapshot, resolveSumUpCredentialsForOrder } from "@/lib/sumup-order-credentials"
import Order from "@/models/Order"

const { posDeviceFindOneMock } = vi.hoisted(() => ({
    posDeviceFindOneMock: vi.fn()
}))

vi.mock("@/models/PosDevice", () => ({
    default: { findOne: posDeviceFindOneMock }
}))

describe("SumUp refund credential snapshot", () => {
    const originalEncryptionKey = process.env.EVENT_SETTINGS_ENCRYPTION_KEY

    beforeEach(() => {
        process.env.EVENT_SETTINGS_ENCRYPTION_KEY = "sumup-refund-snapshot-test-key"
        posDeviceFindOneMock.mockReset()
    })

    afterAll(() => {
        if (originalEncryptionKey === undefined) {
            delete process.env.EVENT_SETTINGS_ENCRYPTION_KEY
        } else {
            process.env.EVENT_SETTINGS_ENCRYPTION_KEY = originalEncryptionKey
        }
    })

    describe("buildSumUpRefundCredentialsSnapshot", () => {
        test("is excluded from normal Order projections", () => {
            expect(Order.schema.path("sumupRefundCredentials").options.select).toBe(false)
        })

        test("encrypts a legacy plaintext API key and preserves enc:v1 ciphertext", () => {
            const snapshot = buildSumUpRefundCredentialsSnapshot({
                merchantCode: " merchant-1 ",
                readerId: " reader-1 ",
                apiKey: "plain-api-key"
            })

            expect(snapshot).toEqual({
                merchantCode: "merchant-1",
                readerId: "reader-1",
                apiKey: expect.stringMatching(/^enc:v1:/)
            })
            expect(snapshot?.apiKey).not.toBe("plain-api-key")
            expect(isEncryptedSecret(snapshot?.apiKey)).toBe(true)
            expect(decryptSecret(snapshot?.apiKey)).toBe("plain-api-key")
        })

        test("preserves a pre-existing encrypted API key", () => {
            const snapshot = buildSumUpRefundCredentialsSnapshot({
                merchantCode: "merchant-1",
                readerId: "reader-1",
                apiKey: "enc:v1:already-encrypted"
            })

            expect(snapshot).toEqual({
                merchantCode: "merchant-1",
                readerId: "reader-1",
                apiKey: "enc:v1:already-encrypted"
            })
            expect(snapshot?.apiKey).toMatch(/^enc:v1:/)
            expect(decryptSecret(snapshot?.apiKey)).toBeUndefined()
        })

        test("returns null for incomplete data", () => {
            expect(buildSumUpRefundCredentialsSnapshot({ merchantCode: "", readerId: "reader-1", apiKey: "api-key" })).toBeNull()
            expect(buildSumUpRefundCredentialsSnapshot({ merchantCode: "merchant-1", readerId: "reader-1", apiKey: "" })).toBeNull()
            expect(buildSumUpRefundCredentialsSnapshot({ merchantCode: "merchant-1", readerId: "reader-1", apiKey: undefined })).toBeNull()
        })
    })

    describe("resolveSumUpCredentialsForOrder", () => {
        test("uses snapshot and skips PosDevice lookup", async () => {
            const snapshot = buildSumUpRefundCredentialsSnapshot({
                merchantCode: "merchant-1",
                readerId: "reader-1",
                apiKey: "plain-api-key"
            })
            if (!snapshot) {
                throw new Error("snapshot should exist")
            }

            const result = await resolveSumUpCredentialsForOrder({
                eventId: "event-1",
                posDeviceId: "pos-1",
                sumupRefundCredentials: snapshot
            })

            expect(result).toEqual({
                success: true,
                apiKey: "plain-api-key",
                merchantCode: "merchant-1",
                readerId: "reader-1"
            })
            expect(posDeviceFindOneMock).not.toHaveBeenCalled()
        })

        test("fails closed when snapshot is corrupted and does not fallback", async () => {
            const result = await resolveSumUpCredentialsForOrder({
                eventId: "event-1",
                posDeviceId: "pos-1",
                sumupRefundCredentials: {
                    merchantCode: "merchant-1",
                    readerId: "reader-1",
                    apiKey: "invalid-ciphertext"
                }
            })

            expect(result).toEqual({ success: false, error: "Snapshot credenziali SumUp non valido" })
            expect(posDeviceFindOneMock).not.toHaveBeenCalled()
        })

        test("falls back to PosDevice terminal when snapshot is missing", async () => {
            const terminalApiKey = encryptSecret("terminal-plain-api-key")

            posDeviceFindOneMock.mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        paymentTerminalId: {
                            type: "SUMUP",
                            config: {
                                merchantCode: " terminal-merchant ",
                                readerId: " terminal-reader ",
                                apiKey: terminalApiKey
                            }
                        }
                    })
                })
            })

            const result = await resolveSumUpCredentialsForOrder({
                eventId: "event-1",
                posDeviceId: "pos-1",
                sumupRefundCredentials: null
            })

            expect(posDeviceFindOneMock).toHaveBeenCalledWith({ _id: "pos-1", eventId: "event-1" })
            expect(result).toEqual({
                success: true,
                apiKey: "terminal-plain-api-key",
                merchantCode: "terminal-merchant",
                readerId: "terminal-reader"
            })
        })

        test("falls back rejected with non-SumUp terminal", async () => {
            posDeviceFindOneMock.mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue({
                        paymentTerminalId: {
                            type: "MANUAL",
                            config: {
                                merchantCode: "merchant-1",
                                readerId: "reader-1",
                                apiKey: "enc:v1:manual"
                            }
                        }
                    })
                })
            })

            const result = await resolveSumUpCredentialsForOrder({
                eventId: "event-1",
                posDeviceId: "pos-1",
                sumupRefundCredentials: undefined
            })

            expect(result).toEqual({ success: false, error: "Terminale SumUp non disponibile per l'ordine" })
        })
    })
})
