import mongoose, { Schema, Document, Types } from 'mongoose';
import type { ProductKind } from './Product';

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
        productKind?: ProductKind;
        unitBasePrice?: number;
        lineTotal?: number;
        discountApplied?: number;
        discountMeta?: {
            type: "NONE" | "PERCENT" | "FIXED";
            label?: string;
            value?: number;
            baseUnitAmount?: number;
        };
        includedComponents?: Array<{
            productId: Types.ObjectId;
            snapshotName: string;
            quantity: number;
            source: "FIXED_ITEM" | "CHOICE_OPTION";
            groupId?: string;
            groupName?: string;
        }>;
        selectedOptions: Array<{
            name: string;
            priceVariation: number;
        }>;
    }>;
    ingredientPlan: Array<{
        ingredientId?: Types.ObjectId;
        snapshotName: string;
        quantity: number;
        sourceProductId?: Types.ObjectId;
        sourceProductName?: string;
        legacy?: boolean;
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
    easterEggAttachment?: {
        uploadTokenHash?: string;
        rasterWidth?: number;
        rasterHeight?: number;
        rasterData?: Buffer;
        uploadedAt?: Date;
        printedAt?: Date;
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
        productKind: {
            type: String,
            enum: ["STANDARD", "FIXED_MENU"]
        },
        unitBasePrice: { type: Number, min: 0 },
        lineTotal: { type: Number, min: 0 },
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
        includedComponents: [{
            productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
            snapshotName: { type: String, required: true },
            quantity: { type: Number, required: true, min: 1 },
            source: {
                type: String,
                enum: ["FIXED_ITEM", "CHOICE_OPTION"],
                required: true
            },
            groupId: { type: String },
            groupName: { type: String }
        }],
        selectedOptions: [{
            name: { type: String, required: true },
            priceVariation: { type: Number, required: true }
        }]
    }],
    ingredientPlan: [{
        ingredientId: { type: Schema.Types.ObjectId, ref: "Ingredient" },
        snapshotName: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        sourceProductId: { type: Schema.Types.ObjectId, ref: "Product" },
        sourceProductName: { type: String },
        legacy: { type: Boolean, default: false }
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
    },
    easterEggAttachment: {
        uploadTokenHash: { type: String, trim: true },
        rasterWidth: { type: Number, min: 1, max: 576 },
        rasterHeight: { type: Number, min: 1, max: 4096 },
        rasterData: { type: Buffer },
        uploadedAt: { type: Date },
        printedAt: { type: Date }
    }
}, {
    timestamps: true
});

OrderSchema.index(
    { eventId: 1, pickupNumber: 1 },
    {
        unique: true,
        partialFilterExpression: { pickupNumber: { $type: "number" } }
    }
);

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Order;
}
export default mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
