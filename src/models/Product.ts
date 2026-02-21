import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IProduct extends Document {
    eventId: Types.ObjectId;
    categoryId: Types.ObjectId;
    name: string;
    basePrice: number;
    isSoldOut: boolean;
    variants: Array<{
        optionName: string;
        priceVariation: number;
    }>;
}

const ProductSchema = new Schema<IProduct>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true },
    basePrice: { type: Number, required: true },
    isSoldOut: { type: Boolean, default: false },
    variants: [{
        optionName: { type: String, required: true },
        priceVariation: { type: Number, required: true }
    }]
}, {
    timestamps: true
});

export default mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);
