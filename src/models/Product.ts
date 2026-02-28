import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProduct extends Document {
    eventId: Types.ObjectId;
    categoryId: Types.ObjectId;
    name: string;
    shortName?: string;
    description?: string;
    basePrice: number;
    isSoldOut: boolean;
    stockQuantity: number | null;
    availableDays: string[];
    variants: Array<{
        optionName: string;
        priceVariation: number;
        stockQuantity?: number | null;
    }>;
}

const ProductSchema = new Schema<IProduct>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true },
    shortName: { type: String, trim: true, maxlength: 24 },
    description: { type: String, trim: true },
    basePrice: { type: Number, required: true },
    isSoldOut: { type: Boolean, default: false },
    stockQuantity: { type: Number, default: null, min: 0 },
    availableDays: { type: [String], default: [] },
    variants: [{
        optionName: { type: String, required: true },
        priceVariation: { type: Number, required: true },
        stockQuantity: { type: Number, default: null, min: 0 }
    }]
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Product;
}

export default mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);
