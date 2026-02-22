import mongoose from 'mongoose';

function getMongoUri(): string {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error('Please define the MONGODB_URI environment variable');
    }
    return mongoUri;
}

interface MongooseCache {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
}

const g = global as { mongoose?: MongooseCache };

if (!g.mongoose) {
    g.mongoose = { conn: null, promise: null };
}

const cached = g.mongoose;

async function dbConnect() {
    if (cached.conn) {
        return cached.conn;
    }

    if (!cached.promise) {
        const opts = {
            bufferCommands: false,
        };

        cached.promise = mongoose.connect(getMongoUri(), opts).then((mongoose) => {
            return mongoose;
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }

    return cached.conn;
}

export default dbConnect;
