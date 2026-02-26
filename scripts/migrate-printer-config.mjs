#!/usr/bin/env node

import mongoose from "mongoose";

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
    console.error("[migrate-printer-config] MONGODB_URI is required");
    process.exit(1);
}

async function run() {
    await mongoose.connect(mongoUri);
    const printers = mongoose.connection.collection("printers");

    const backfillResult = await printers.updateMany(
        {
            $or: [
                { port: { $exists: false } },
                { isVirtual: { $exists: false } }
            ]
        },
        {
            $set: {
                port: 9100,
                isVirtual: false
            }
        }
    );

    const cleanupResult = await printers.updateMany(
        {
            isVirtual: false,
            emulatorSlot: { $exists: true }
        },
        {
            $unset: {
                emulatorSlot: ""
            }
        }
    );

    console.log("[migrate-printer-config] backfill matched:", backfillResult.matchedCount);
    console.log("[migrate-printer-config] backfill modified:", backfillResult.modifiedCount);
    console.log("[migrate-printer-config] cleanup matched:", cleanupResult.matchedCount);
    console.log("[migrate-printer-config] cleanup modified:", cleanupResult.modifiedCount);
}

run()
    .then(async () => {
        await mongoose.disconnect();
        process.exit(0);
    })
    .catch(async (error) => {
        console.error("[migrate-printer-config] error:", error);
        await mongoose.disconnect();
        process.exit(1);
    });
