import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPrinter extends Document {
    eventId: Types.ObjectId;
    name: string;
    ip: string;
    port: number;
    isVirtual: boolean;
    emulatorSlot?: number;
    type: "CASHIER" | "KITCHEN";
    printQueueLeaseToken?: string;
    printQueueLeaseExpiresAt?: Date;
}

const PrinterSchema = new Schema<IPrinter>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true },
    ip: { type: String, required: true },
    port: { type: Number, required: true, default: 9100, min: 1, max: 65535 },
    isVirtual: { type: Boolean, required: true, default: false },
    emulatorSlot: { type: Number, min: 1, max: 10 },
    type: { type: String, enum: ["CASHIER", "KITCHEN"], required: true, default: "KITCHEN" },
    printQueueLeaseToken: { type: String, trim: true },
    printQueueLeaseExpiresAt: { type: Date }
}, {
    timestamps: true
});

PrinterSchema.index({ eventId: 1, isVirtual: 1, emulatorSlot: 1 });

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Printer;
}
export default mongoose.models.Printer || mongoose.model<IPrinter>('Printer', PrinterSchema);
