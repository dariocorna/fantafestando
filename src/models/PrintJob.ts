import mongoose, { Schema, Document, Types } from "mongoose";

export type PrintJobSource = "ORDER" | "CASH_SESSION" | "MANUAL_TEST";
export type PrintJobStatus = "QUEUED" | "HELD" | "SENT" | "FAILED";
export type PrintJobType =
    | "CUSTOMER_ORDER"
    | "KITCHEN_ORDER"
    | "CASHIER_SUMMARY"
    | "CASH_SESSION_SUMMARY"
    | "EASTER_EGG_IMAGE"
    | "MANUAL_TEST";

export interface IPrintJob extends Document {
    eventId: Types.ObjectId;
    printerId?: Types.ObjectId;
    orderId?: Types.ObjectId;
    source: PrintJobSource;
    printType: PrintJobType;
    queueRecoverable: boolean;
    idempotencyKey?: string;
    status: PrintJobStatus;
    destinationHost: string;
    destinationPort: number;
    isVirtual: boolean;
    copies: number;
    automaticRetryCount: number;
    document: Record<string, unknown>;
    rawCapturePath?: string;
    errorMessage?: string;
    retryClaimedAt?: Date;
    liveClaimExpiresAt?: Date;
    heldSince?: Date;
    queueClaimToken?: string;
    queueClaimExpiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const PrintJobSchema = new Schema<IPrintJob>({
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    printerId: { type: Schema.Types.ObjectId, ref: "Printer" },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    source: {
        type: String,
        enum: ["ORDER", "CASH_SESSION", "MANUAL_TEST"],
        required: true,
        default: "ORDER"
    },
    printType: {
        type: String,
        enum: ["CUSTOMER_ORDER", "KITCHEN_ORDER", "CASHIER_SUMMARY", "CASH_SESSION_SUMMARY", "EASTER_EGG_IMAGE", "MANUAL_TEST"],
        required: true,
        default: "CUSTOMER_ORDER"
    },
    queueRecoverable: { type: Boolean, required: true, default: false },
    idempotencyKey: { type: String, trim: true },
    status: {
        type: String,
        enum: ["QUEUED", "HELD", "SENT", "FAILED"],
        required: true,
        default: "QUEUED"
    },
    destinationHost: { type: String, required: true, trim: true },
    destinationPort: { type: Number, required: true, min: 1, max: 65535, default: 9100 },
    isVirtual: { type: Boolean, required: true, default: false },
    copies: { type: Number, required: true, default: 1, min: 1, max: 5 },
    automaticRetryCount: { type: Number, required: true, default: 0, min: 0, max: 10 },
    document: { type: Schema.Types.Mixed, required: true },
    rawCapturePath: { type: String, trim: true },
    errorMessage: { type: String, trim: true },
    retryClaimedAt: { type: Date },
    liveClaimExpiresAt: { type: Date },
    heldSince: { type: Date },
    queueClaimToken: { type: String, trim: true },
    queueClaimExpiresAt: { type: Date }
}, {
    timestamps: true
});

PrintJobSchema.index({ eventId: 1, createdAt: -1 });
PrintJobSchema.index({ eventId: 1, status: 1, createdAt: -1 });
PrintJobSchema.index({ printerId: 1, createdAt: -1 });
PrintJobSchema.index({ printerId: 1, status: 1, createdAt: 1, _id: 1 });
PrintJobSchema.index(
    { eventId: 1, source: 1, orderId: 1, idempotencyKey: 1 },
    {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: "string" } }
    }
);

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.PrintJob;
}

export default mongoose.models.PrintJob || mongoose.model<IPrintJob>("PrintJob", PrintJobSchema);
