import mongoose, { Schema, Document, Types } from 'mongoose';
import type { ProductKind } from './Product';

export interface IOrder extends Document {
    eventId: Types.ObjectId;
    cashSessionId?: Types.ObjectId;
    pickupNumber?: number;
    status: "PENDING" | "PAID" | "CANCELLED";
    paidAt?: Date;
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
    discountComponents?: Array<{
        scope: "VOLUNTEER" | "LINE" | "ORDER";
        type: "PERCENT" | "FIXED";
        label?: string;
        value: number;
        baseAmount: number;
        appliedAmount: number;
        productId?: Types.ObjectId;
    }>;
    pricingMode?: "STANDARD" | "VOLUNTEER";
    cart: Array<{
        productId: Types.ObjectId;
        snapshotName: string;
        customKitchenNotes?: string;
        splitPrintPerUnit?: boolean;
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
    dishTickets: Array<{
        productId: Types.ObjectId;
        snapshotName: string;
        pizzaNumber: number;
        state: "QUEUED" | "READY" | "REMOVED";
        readyAt?: Date;
    }>;
    paymentMethod: "CASH" | "CARD" | "OTHER";
    sumupCheckoutId?: string;
    sumupPaymentId?: string;
    sumupRefundCredentials?: {
        merchantCode: string;
        readerId?: string;
        apiKey: string;
    };
    sumupInitiatedAt?: Date;
    sumupRecoveryCancelledAt?: Date;
    sumupRecoveryResolvedAt?: Date;
    sumupLateSuccessDetectedAt?: Date;
    sumupWebhookClaimToken?: string;
    sumupWebhookClaimedAt?: Date;
    posDeviceId?: Types.ObjectId;
    stockOverrideApproved?: boolean;
    stockAdjustments?: Array<{
        entityType: "PRODUCT" | "INGREDIENT";
        entityId: Types.ObjectId;
        quantity: number;
    }>;
    stockEffectStatus?: "APPLIED" | "REVERTED";
    stockEffectClaim?: {
        token: string;
        target: "APPLIED" | "REVERTED";
    };
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
    publicAccessTokenHash?: string;
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

const SumUpRefundCredentialsSchema = new Schema({
    merchantCode: { type: String, required: true, trim: true },
    readerId: { type: String, trim: true },
    apiKey: { type: String, required: true, trim: true }
}, { _id: false });

const OrderSchema = new Schema<IOrder>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    pickupNumber: { type: Number, min: 1 },
    status: { type: String, enum: ["PENDING", "PAID", "CANCELLED"], default: "PENDING" },
    paidAt: { type: Date },
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
    discountComponents: [{
        scope: {
            type: String,
            enum: ["VOLUNTEER", "LINE", "ORDER"],
            required: true
        },
        type: {
            type: String,
            enum: ["PERCENT", "FIXED"],
            required: true
        },
        label: { type: String },
        value: { type: Number, min: 0, required: true },
        baseAmount: { type: Number, min: 0, required: true },
        appliedAmount: { type: Number, min: 0, required: true },
        productId: { type: Schema.Types.ObjectId, ref: "Product" }
    }],
    pricingMode: { type: String, enum: ["STANDARD", "VOLUNTEER"], default: "STANDARD" },
    cart: [{
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        snapshotName: { type: String, required: true },
        customKitchenNotes: { type: String },
        splitPrintPerUnit: { type: Boolean, default: false },
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
    dishTickets: [{
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        snapshotName: { type: String, required: true },
        pizzaNumber: { type: Number, required: true, min: 1 },
        state: {
            type: String,
            enum: ["QUEUED", "READY", "REMOVED"],
            required: true,
            default: "QUEUED"
        },
        readyAt: { type: Date }
    }],
    paymentMethod: { type: String, enum: ["CASH", "CARD", "OTHER"], default: "CASH" },
    sumupCheckoutId: { type: String },
    sumupPaymentId: { type: String },
    sumupRefundCredentials: {
        type: SumUpRefundCredentialsSchema,
        select: false
    },
    sumupInitiatedAt: { type: Date },
    sumupRecoveryCancelledAt: { type: Date },
    sumupRecoveryResolvedAt: { type: Date },
    sumupLateSuccessDetectedAt: { type: Date },
    sumupWebhookClaimToken: { type: String },
    sumupWebhookClaimedAt: { type: Date },
    posDeviceId: { type: Schema.Types.ObjectId, ref: 'PosDevice' },
    cashSessionId: { type: Schema.Types.ObjectId, ref: 'CashSession' },
    stockOverrideApproved: { type: Boolean, default: false },
    stockAdjustments: [{
        entityType: { type: String, enum: ["PRODUCT", "INGREDIENT"], required: true },
        entityId: { type: Schema.Types.ObjectId, required: true },
        quantity: { type: Number, required: true, min: 1 }
    }],
    stockEffectStatus: { type: String, enum: ["APPLIED", "REVERTED"], default: "APPLIED" },
    stockEffectClaim: {
        token: { type: String },
        target: { type: String, enum: ["APPLIED", "REVERTED"] }
    },
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
    publicAccessTokenHash: { type: String, trim: true, select: false },
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
