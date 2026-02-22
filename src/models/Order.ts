import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IOrder extends Document {
    eventId: Types.ObjectId;
    pickupNumber?: number;
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
    paymentMethod: "CASH" | "CARD" | "OTHER";
    sumupCheckoutId?: string;
    sumupPaymentId?: string;
    posDeviceId?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

const OrderSchema = new Schema<IOrder>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    pickupNumber: { type: Number, min: 1 },
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
    }],
    paymentMethod: { type: String, enum: ["CASH", "CARD", "OTHER"], default: "CASH" },
    sumupCheckoutId: { type: String },
    sumupPaymentId: { type: String },
    posDeviceId: { type: Schema.Types.ObjectId, ref: 'PosDevice' }
}, {
    timestamps: true
});

OrderSchema.index({ eventId: 1, pickupNumber: 1 }, { unique: true, sparse: true });

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Order;
}
export default mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
