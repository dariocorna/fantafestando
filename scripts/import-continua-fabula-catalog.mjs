#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

const dumpPath = process.env.CATALOG_PATH || path.resolve("docs/.tmp/continua-fabula-catalog.ejson.json");
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

    const eventData = parsed.event;
    const categories = Array.isArray(parsed.categories) ? parsed.categories : [];
    const products = Array.isArray(parsed.products) ? parsed.products : [];

    if (!eventData?.name) throw new Error("Dump invalido: event.name mancante");

    console.log(`Connecting to MongoDB: ${mongoUri.replace(/:([^:@]+)@/, ":****@")}`);
    await mongoose.connect(mongoUri, { bufferCommands: false });
    const db = mongoose.connection.db;

    const eventsCol = db.collection("events");
    const categoriesCol = db.collection("categories");
    const productsCol = db.collection("products");

    const canonicalName = normalizeEventName("Continua Fabula");

    // Search for existing event "Continua Fabula"
    const existingEvent = await eventsCol.findOne({
        name: { $regex: new RegExp(`^${canonicalName}$`, "i") },
        archived: { $ne: true }
    });

    let eventId;

    if (existingEvent) {
        eventId = existingEvent._id;
        console.log(`Updating existing event: ${existingEvent.name} (${eventId})`);
        await eventsCol.updateOne(
            { _id: eventId },
            {
                $set: {
                    active: true,
                    updatedAt: new Date(),
                    settings: {
                        ...existingEvent.settings,
                        ...eventData.settings
                    }
                }
            }
        );
    } else {
        console.log(`Creating new event: ${eventData.name}`);
        const insertEvent = await eventsCol.insertOne({
            name: eventData.name,
            active: true,
            archived: false,
            settings: eventData.settings || {},
            predefinedTables: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        eventId = insertEvent.insertedId;
    }

    // Clear existing products and categories for this event to avoid duplicates/confusion
    console.log(`Clearing existing catalog for eventId: ${eventId}`);
    await productsCol.deleteMany({ eventId });
    await categoriesCol.deleteMany({ eventId });

    const categoryIdMap = new Map();
    let upsertedCategories = 0;

    for (const category of categories) {
        const name = String(category.name || "").trim();
        if (!name) continue;

        const result = await categoriesCol.insertOne({
            eventId,
            name,
            uiColor: category.uiColor || "blue",
            printOrder: Number(category.printOrder || 0),
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        upsertedCategories += 1;
        categoryIdMap.set(String(category._id || ""), result.insertedId);
    }

    let upsertedProducts = 0;

    for (const product of products) {
        const name = String(product.name || "").trim();
        if (!name) continue;

        const sourceCategoryId = String(product.categoryId || "");
        const mappedCategoryId = categoryIdMap.get(sourceCategoryId);
        if (!mappedCategoryId) {
            console.warn(`Category not found for product: ${name}`);
            continue;
        }

        await productsCol.insertOne({
            eventId,
            categoryId: mappedCategoryId,
            name,
            shortName: String(product.shortName || "").trim() || undefined,
            description: product.description || "",
            basePrice: Number(product.basePrice || 0),
            isSoldOut: false,
            stockQuantity: null,
            availableDays: [],
            variants: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        upsertedProducts += 1;
    }

    console.log(
        JSON.stringify(
            {
                event: eventData.name,
                eventId: String(eventId),
                categories: upsertedCategories,
                products: upsertedProducts,
            },
            null,
            2
        )
    );

    await mongoose.disconnect();
}

run().catch(async (error) => {
    console.error("[import-continua-fabula-catalog] ERROR:", error.message);
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    process.exit(1);
});
