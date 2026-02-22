import crypto from "crypto";

const ENCRYPTED_PREFIX = "enc:v1:";

function getEncryptionSeed(): string {
    const seed =
        process.env.EVENT_SETTINGS_ENCRYPTION_KEY
        || process.env.NEXTAUTH_SECRET
        || process.env.AUTH_SECRET
        || process.env.MONGODB_URI;

    if (!seed) {
        throw new Error("Missing encryption seed for secret storage.");
    }

    return seed;
}

function deriveKey(): Buffer {
    return crypto.createHash("sha256").update(getEncryptionSeed()).digest();
}

export function isEncryptedSecret(value?: string | null): boolean {
    return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(value: string): string {
    const plain = value.trim();
    if (!plain) return "";
    if (isEncryptedSecret(plain)) return plain;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${ENCRYPTED_PREFIX}${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value?: string | null): string | undefined {
    if (!value) return undefined;
    if (!isEncryptedSecret(value)) return value;

    const payload = value.slice(ENCRYPTED_PREFIX.length);
    const [ivPart, authTagPart, encryptedPart] = payload.split(".");
    if (!ivPart || !authTagPart || !encryptedPart) {
        return undefined;
    }

    try {
        const iv = Buffer.from(ivPart, "base64url");
        const authTag = Buffer.from(authTagPart, "base64url");
        const encrypted = Buffer.from(encryptedPart, "base64url");

        const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString("utf8");
    } catch {
        return undefined;
    }
}
