import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPeripheral extends Document {
    eventId: Types.ObjectId;
    name: string;
    type: "SUMUP" | "CASH_BOX" | "ELECTRONIC_MANUAL" | "OTHER";
    config: {
        merchantCode?: string;
        readerId?: string;
        apiKey?: string;
        affiliateAppId?: string;
        affiliateKey?: string;
        [key: string]: unknown;
    };
    createdAt?: Date;
    updatedAt?: Date;
}

const PeripheralSchema = new Schema<IPeripheral>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ["SUMUP", "CASH_BOX", "ELECTRONIC_MANUAL", "OTHER"], required: true },
    config: { type: Schema.Types.Mixed, default: {} }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Peripheral;
}
export default mongoose.models.Peripheral || mongoose.model<IPeripheral>('Peripheral', PeripheralSchema);
