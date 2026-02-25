import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IOrder extends Document {
    eventId: Types.ObjectId;
    cashSessionId?: Types.ObjectId;
    pickupNumber?: number;
    status: "PENDING" | "PAID" | "CANCELLED";
    customer: {
        name?: string;
        table?: string;
    };
    totalAmount: number;
    discountApplied: number;
    discountMeta?: {
        type: "NONE" | "PERCENT" | "FIXED";
        label?: string;
        value?: number;
        baseAmount?: number;
        scope?: "ORDER";
    };
    cart: Array<{
        productId: Types.ObjectId;
        snapshotName: string;
        customKitchenNotes?: string;
        quantity: number;
        discountApplied?: number;
        discountMeta?: {
            type: "NONE" | "PERCENT" | "FIXED";
            label?: string;
            value?: number;
            baseUnitAmount?: number;
        };
        selectedOptions: Array<{
            name: string;
            priceVariation: number;
        }>;
    }>;
    paymentMethod: "CASH" | "CARD" | "OTHER";
    sumupCheckoutId?: string;
    sumupPaymentId?: string;
    posDeviceId?: Types.ObjectId;
    stockOverrideApproved?: boolean;
    stornoMeta?: {
        status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
        reason?: string;
        requestedAt?: Date;
        completedAt?: Date;
        requestedBy?: string;
        refundRequired?: boolean;
        refundStatus?: "SKIPPED" | "DONE" | "FAILED";
        refundTransactionId?: string;
        refundError?: string;
    };
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
    discountMeta: {
        type: {
            type: String,
            enum: ["NONE", "PERCENT", "FIXED"]
        },
        label: { type: String },
        value: { type: Number, min: 0 },
        baseAmount: { type: Number, min: 0 },
        scope: {
            type: String,
            enum: ["ORDER"]
        }
    },
    cart: [{
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        snapshotName: { type: String, required: true },
        customKitchenNotes: { type: String },
        quantity: { type: Number, required: true, min: 1 },
        discountApplied: { type: Number, min: 0, default: 0 },
        discountMeta: {
            type: {
                type: String,
                enum: ["NONE", "PERCENT", "FIXED"]
            },
            label: { type: String },
            value: { type: Number, min: 0 },
            baseUnitAmount: { type: Number, min: 0 }
        },
        selectedOptions: [{
            name: { type: String, required: true },
            priceVariation: { type: Number, required: true }
        }]
    }],
    paymentMethod: { type: String, enum: ["CASH", "CARD", "OTHER"], default: "CASH" },
    sumupCheckoutId: { type: String },
    sumupPaymentId: { type: String },
    posDeviceId: { type: Schema.Types.ObjectId, ref: 'PosDevice' },
    cashSessionId: { type: Schema.Types.ObjectId, ref: 'CashSession' },
    stockOverrideApproved: { type: Boolean, default: false },
    stornoMeta: {
        status: {
            type: String,
            enum: ["IN_PROGRESS", "COMPLETED", "FAILED"]
        },
        reason: { type: String },
        requestedAt: { type: Date },
        completedAt: { type: Date },
        requestedBy: { type: String },
        refundRequired: { type: Boolean },
        refundStatus: {
            type: String,
            enum: ["SKIPPED", "DONE", "FAILED"]
        },
        refundTransactionId: { type: String },
        refundError: { type: String }
    }
}, {
    timestamps: true
});

OrderSchema.index({ eventId: 1, pickupNumber: 1 }, { unique: true, sparse: true });

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Order;
}
export default mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
