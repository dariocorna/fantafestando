#!/usr/bin/env node

import mongoose from "mongoose";

const mongoUri =
    process.env.MONGODB_URI ||
    "mongodb://root:password@localhost:27017/osgfest?authSource=admin";

const sourceEventName = process.env.SOURCE_EVENT || "Continua Fabula";
const targetEventName = process.env.TARGET_EVENT || "Festa AGE";

async function run() {
    console.log(`Connecting to MongoDB: ${mongoUri.replace(/:([^:@]+)@/, ":****@")}`);
    await mongoose.connect(mongoUri, { bufferCommands: false });
    const db = mongoose.connection.db;

    const eventsCol = db.collection("events");
    const categoriesCol = db.collection("categories");
    const productsCol = db.collection("products");

    console.log(`Searching for source event: "${sourceEventName}"`);
    const sourceEvent = await eventsCol.findOne({
        name: { $regex: new RegExp(`^${sourceEventName}$`, "i") },
        archived: { $ne: true }
    });

    if (!sourceEvent) {
        throw new Error(`Source event "${sourceEventName}" not found.`);
    }

    console.log(`Found source event: ${sourceEvent.name} (${sourceEvent._id})`);

    console.log(`Searching for target event: "${targetEventName}"`);
    let targetEvent = await eventsCol.findOne({
        name: { $regex: new RegExp(`^${targetEventName}$`, "i") },
        archived: { $ne: true }
    });

    let targetEventId;

    if (targetEvent) {
        targetEventId = targetEvent._id;
        console.log(`Target event exists: ${targetEvent.name} (${targetEventId})`);
    } else {
        console.log(`Creating target event: "${targetEventName}"`);
        const result = await eventsCol.insertOne({
            name: targetEventName,
            active: true,
            archived: false,
            settings: sourceEvent.settings || {},
            predefinedTables: sourceEvent.predefinedTables || [],
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        targetEventId = result.insertedId;
        console.log(`Created target event with ID: ${targetEventId}`);
    }

    // Clear target catalog
    console.log(`Clearing existing catalog for target event...`);
    await categoriesCol.deleteMany({ eventId: targetEventId });
    await productsCol.deleteMany({ eventId: targetEventId });

    // Copy Categories
    console.log(`Copying categories...`);
    const sourceCategories = await categoriesCol.find({ eventId: sourceEvent._id }).toArray();
    const categoryIdMap = new Map();

    for (const cat of sourceCategories) {
        const { _id, ...catData } = cat;
        const result = await categoriesCol.insertOne({
            ...catData,
            eventId: targetEventId,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        categoryIdMap.set(String(_id), result.insertedId);
    }
    console.log(`Copied ${sourceCategories.length} categories.`);

    // Copy Products
    console.log(`Copying products...`);
    const sourceProducts = await productsCol.find({ eventId: sourceEvent._id }).toArray();
    let copiedProducts = 0;

    for (const prod of sourceProducts) {
        const { _id, ...prodData } = prod;
        const newCategoryId = categoryIdMap.get(String(prod.categoryId));

        if (!newCategoryId) {
            console.warn(`Category mapping not found for product: ${prod.name}`);
            continue;
        }

        await productsCol.insertOne({
            ...prodData,
            eventId: targetEventId,
            categoryId: newCategoryId,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        copiedProducts++;
    }
    console.log(`Copied ${copiedProducts} products.`);

    console.log("Catalog copy completed successfully.");
    await mongoose.disconnect();
}

run().catch(async (error) => {
    console.error("[copy-catalog] ERROR:", error.message);
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    process.exit(1);
});
