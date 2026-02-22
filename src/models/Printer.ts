import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPrinter extends Document {
    eventId: Types.ObjectId;
    name: string;
    ip: string;
    type: "CASHIER" | "KITCHEN";
}

const PrinterSchema = new Schema<IPrinter>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true },
    ip: { type: String, required: true },
    type: { type: String, enum: ["CASHIER", "KITCHEN"], required: true, default: "KITCHEN" }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Printer;
}
export default mongoose.models.Printer || mongoose.model<IPrinter>('Printer', PrinterSchema);
