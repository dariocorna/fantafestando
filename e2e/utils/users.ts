import bcrypt from "bcryptjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import dbConnect from "../../src/lib/mongoose";
import User from "../../src/models/User";

export interface E2EUserCredentials {
    username: string;
    password: string;
}

export interface E2ECredentials {
    admin: E2EUserCredentials;
    cashier: E2EUserCredentials;
}

function normalizeUsername(value: string): string {
    return value.trim().toLowerCase();
}

export function resolveE2ECredentials(): E2ECredentials {
    return {
        admin: {
            username: normalizeUsername(process.env.E2E_ADMIN_USERNAME || "admin"),
            password: process.env.E2E_ADMIN_PASSWORD || "admin"
        },
        cashier: {
            username: normalizeUsername(process.env.E2E_CASHIER_USERNAME || "cashier"),
            password: process.env.E2E_CASHIER_PASSWORD || "cashier"
        }
    };
}

function loadLocalEnvFile() {
    if (process.env.MONGODB_URI) return;

    const envPath = path.join(process.cwd(), ".env.local");
    if (!existsSync(envPath)) return;

    const envContent = readFileSync(envPath, "utf8");
    for (const rawLine of envContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) continue;

        const key = line.slice(0, separatorIndex).trim();
        if (!key || process.env[key]) continue;

        let value = line.slice(separatorIndex + 1).trim();
        const isQuoted =
            (value.startsWith("\"") && value.endsWith("\""))
            || (value.startsWith("'") && value.endsWith("'"));
        if (isQuoted) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}

async function upsertE2EUser(params: {
    username: string;
    password: string;
    role: "ADMIN" | "CASHIER";
}) {
    const passwordHash = await bcrypt.hash(params.password, 10);
    await User.updateOne(
        { username: params.username },
        {
            $set: {
                username: params.username,
                passwordHash,
                role: params.role
            }
        },
        { upsert: true }
    );
}

export async function ensureE2EUsers(): Promise<E2ECredentials> {
    loadLocalEnvFile();

    const credentials = resolveE2ECredentials();
    if (!process.env.MONGODB_URI) {
        console.warn("[e2e] MONGODB_URI assente nel processo test: seed utenti E2E saltato.");
        return credentials;
    }

    await dbConnect();
    await upsertE2EUser({ ...credentials.admin, role: "ADMIN" });
    await upsertE2EUser({ ...credentials.cashier, role: "CASHIER" });

    return credentials;
}
