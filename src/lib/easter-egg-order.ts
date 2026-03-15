import { createHash, randomBytes } from "node:crypto";

export interface EasterEggUploadTokenPair {
    token: string;
    hash: string;
}

export function hashEasterEggUploadToken(token: string): string {
    return createHash("sha256")
        .update(token.trim())
        .digest("hex");
}

export function createEasterEggUploadToken(): EasterEggUploadTokenPair {
    const token = randomBytes(24).toString("base64url");
    return {
        token,
        hash: hashEasterEggUploadToken(token)
    };
}
