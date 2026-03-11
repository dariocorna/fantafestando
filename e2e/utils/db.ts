import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

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
        if (isQuoted) value = value.slice(1, -1);

        process.env[key] = value;
    }
}

async function ensureDbConnection() {
    if (mongoose.connection.readyState === 1) return;
    if (mongoose.connection.readyState === 2) {
        await mongoose.connection.asPromise();
        return;
    }

    loadLocalEnvFile();
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error("MONGODB_URI non configurato per il cleanup E2E.");
    }

    await mongoose.connect(mongoUri, { bufferCommands: false });
}

export async function cleanupEventArtifactsByName(eventName: string) {
    if (!eventName.trim()) return;

    await ensureDbConnection();
    const db = mongoose.connection.db;
    const event = await db.collection("events").findOne({ name: eventName });
    if (!event?._id) return;

    const eventId = event._id;
    await Promise.all([
        db.collection("printjobs").deleteMany({ eventId }),
        db.collection("cashsessions").deleteMany({ eventId }),
        db.collection("ordercounters").deleteMany({ eventId }),
        db.collection("orders").deleteMany({ eventId }),
        db.collection("posdevices").deleteMany({ eventId }),
        db.collection("peripherals").deleteMany({ eventId }),
        db.collection("printers").deleteMany({ eventId }),
        db.collection("products").deleteMany({ eventId }),
        db.collection("categories").deleteMany({ eventId }),
        db.collection("events").deleteOne({ _id: eventId })
    ]);
}
