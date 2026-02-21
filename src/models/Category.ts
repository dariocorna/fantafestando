import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICategory extends Document {
    eventId: Types.ObjectId;
    name: string;
    uiColor: string;
    printOrder: number;
    printerIp?: string;
}

const CategorySchema = new Schema<ICategory>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true },
    uiColor: { type: String, required: true },
    printOrder: { type: Number, default: 0 },
    printerIp: { type: String }
}, {
    timestamps: true
});

export default mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema);
