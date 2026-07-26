import { createHash, randomBytes } from "node:crypto";

export interface OrderAccessTokenPair {
    token: string;
    hash: string;
}

export function hashOrderAccessToken(token: string): string {
    return createHash("sha256")
        .update(token.trim())
        .digest("hex");
}

export function createOrderAccessToken(): OrderAccessTokenPair {
    const token = randomBytes(24).toString("base64url");
    return {
        token,
        hash: hashOrderAccessToken(token)
    };
}
