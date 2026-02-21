import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IOrder extends Document {
    eventId: Types.ObjectId;
    status: "PENDING" | "PAID" | "CANCELLED";
    customer: {
        name?: string;
        table?: string;
    };
    totalAmount: number;
    discountApplied: number;
    cart: Array<{
        productId: Types.ObjectId;
        snapshotName: string;
        customKitchenNotes?: string;
        quantity: number;
        selectedOptions: Array<{
            name: string;
            priceVariation: number;
        }>;
    }>;
}

const OrderSchema = new Schema<IOrder>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    status: { type: String, enum: ["PENDING", "PAID", "CANCELLED"], default: "PENDING" },
    customer: {
        name: { type: String },
        table: { type: String }
    },
    totalAmount: { type: Number, required: true },
    discountApplied: { type: Number, default: 0 },
    cart: [{
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        snapshotName: { type: String, required: true },
        customKitchenNotes: { type: String },
        quantity: { type: Number, required: true, min: 1 },
        selectedOptions: [{
            name: { type: String, required: true },
            priceVariation: { type: Number, required: true }
        }]
    }]
}, {
    timestamps: true
});

export default mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
