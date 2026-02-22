import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPosDevice extends Document {
    eventId: Types.ObjectId;
    name: string;
    printerId: Types.ObjectId;
}

const PosDeviceSchema = new Schema<IPosDevice>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true },
    printerId: { type: Schema.Types.ObjectId, ref: 'Printer', required: true }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.PosDevice;
}
export default mongoose.models.PosDevice || mongoose.model<IPosDevice>('PosDevice', PosDeviceSchema);
