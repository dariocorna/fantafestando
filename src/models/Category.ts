import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICategory extends Document {
    eventId: Types.ObjectId;
    name: string;
    uiColor: string;
    printOrder: number;
    printerId?: Types.ObjectId;
    skipKitchenPrint: boolean;
    printKitchenCopyAtCashier: boolean;
    pizzaFlowEnabled: boolean;
}

const CategorySchema = new Schema<ICategory>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true },
    uiColor: { type: String, required: true },
    printOrder: { type: Number, default: 0 },
    printerId: { type: Schema.Types.ObjectId, ref: 'Printer' },
    skipKitchenPrint: { type: Boolean, default: false },
    printKitchenCopyAtCashier: { type: Boolean, default: false },
    pizzaFlowEnabled: { type: Boolean, default: false }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Category;
}
export default mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema);
