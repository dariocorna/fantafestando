#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

const dumpPath = path.resolve("docs/.tmp/oratorio-2026-catalog.ejson.json");
const mongoUri =
    process.env.MONGODB_URI ||
    "mongodb://root:password@localhost:27017/osgfest?authSource=admin";

function unwrapEjson(value) {
    if (Array.isArray(value)) return value.map(unwrapEjson);
    if (value && typeof value === "object") {
        if (typeof value.$oid === "string") return value.$oid;
        if (typeof value.$date === "string") return new Date(value.$date);

        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = unwrapEjson(v);
        }
        return out;
    }
    return value;
}

function normalizeVariants(variants) {
    if (!Array.isArray(variants)) return [];

    return variants
        .map((variant) => ({
            optionName: String(variant.optionName || "").trim(),
            priceVariation: Number(variant.priceVariation || 0),
            stockQuantity:
                variant.stockQuantity === null || variant.stockQuantity === undefined
                    ? null
                    : Number(variant.stockQuantity),
        }))
        .filter((variant) => variant.optionName.length > 0);
}

function normalizeEventName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

async function run() {
    if (!fs.existsSync(dumpPath)) {
        throw new Error(`Dump non trovato: ${dumpPath}`);
    }

    const raw = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
    const parsed = unwrapEjson(raw);

    const event = parsed.event;
    const categories = Array.isArray(parsed.categories) ? parsed.categories : [];
    const products = Array.isArray(parsed.products) ? parsed.products : [];

    if (!event?.name) throw new Error("Dump invalido: event.name mancante");

    await mongoose.connect(mongoUri, { bufferCommands: false });
    const db = mongoose.connection.db;

    const eventsCol = db.collection("events");
    const categoriesCol = db.collection("categories");
    const productsCol = db.collection("products");

    const canonicalName = normalizeEventName(event.name);
    const existingCandidates = await eventsCol
        .find({
            archived: { $ne: true },
            name: { $regex: /oratorio 2026/i },
        })
        .sort({ createdAt: 1 })
        .toArray();

    const existingEvent =
        existingCandidates.find((candidate) => normalizeEventName(candidate.name) === canonicalName) ||
        existingCandidates[0] ||
        null;
    let eventId;

    if (existingEvent) {
        eventId = existingEvent._id;
        await eventsCol.updateOne(
            { _id: eventId },
            {
                $set: {
                    active: Boolean(event.active),
                    archived: Boolean(event.archived),
                    settings: event.settings || {},
                    predefinedTables: Array.isArray(event.predefinedTables)
                        ? event.predefinedTables
                        : [],
                    updatedAt: new Date(),
                },
            }
        );
    } else {
        const insertEvent = await eventsCol.insertOne({
            name: event.name,
            active: Boolean(event.active),
            archived: Boolean(event.archived),
            settings: event.settings || {},
            predefinedTables: Array.isArray(event.predefinedTables)
                ? event.predefinedTables
                : [],
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        eventId = insertEvent.insertedId;
    }

    // Mirror remote catalog exactly for this event to avoid mixed legacy local data.
    await productsCol.deleteMany({ eventId });
    await categoriesCol.deleteMany({ eventId });

    const categoryIdMap = new Map();
    let upsertedCategories = 0;

    for (const category of categories) {
        const name = String(category.name || "").trim();
        if (!name) continue;

        await categoriesCol.updateOne(
            { eventId, name },
            {
                $set: {
                    uiColor: category.uiColor || "blue",
                    printOrder: Number(category.printOrder || 0),
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    eventId,
                    createdAt: new Date(),
                },
            },
            { upsert: true }
        );

        const stored = await categoriesCol.findOne({ eventId, name }, { projection: { _id: 1 } });
        if (stored?._id) {
            upsertedCategories += 1;
            categoryIdMap.set(String(category._id || ""), stored._id);
        }
    }

    let upsertedProducts = 0;

    for (const product of products) {
        const name = String(product.name || "").trim();
        if (!name) continue;

        const sourceCategoryId = String(product.categoryId || "");
        const mappedCategoryId = categoryIdMap.get(sourceCategoryId);
        if (!mappedCategoryId) continue;

        await productsCol.updateOne(
            { eventId, categoryId: mappedCategoryId, name },
            {
                $set: {
                    basePrice: Number(product.basePrice || 0),
                    isSoldOut: Boolean(product.isSoldOut),
                    stockQuantity:
                        product.stockQuantity === null || product.stockQuantity === undefined
                            ? null
                            : Number(product.stockQuantity),
                    availableDays: Array.isArray(product.availableDays)
                        ? product.availableDays.map((d) => String(d))
                        : [],
                    variants: normalizeVariants(product.variants),
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    eventId,
                    createdAt: new Date(),
                },
            },
            { upsert: true }
        );

        upsertedProducts += 1;
    }

    const finalCategories = await categoriesCol.countDocuments({ eventId });
    const finalProducts = await productsCol.countDocuments({ eventId });

    // Keep only one active event for the Oratorio 2026 family to avoid UI confusion.
    const duplicateIds = existingCandidates
        .map((candidate) => candidate._id)
        .filter((id) => String(id) !== String(eventId));
    if (duplicateIds.length > 0) {
        await eventsCol.updateMany(
            { _id: { $in: duplicateIds } },
            { $set: { active: false, updatedAt: new Date() } }
        );
    }

    console.log(
        JSON.stringify(
            {
                event: event.name,
                eventId: String(eventId),
                upsertedCategories,
                upsertedProducts,
                finalCategories,
                finalProducts,
            },
            null,
            2
        )
    );

    await mongoose.disconnect();
}

run().catch(async (error) => {
    console.error("[import-oratorio-2026-catalog] ERROR:", error.message);
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    process.exit(1);
});
