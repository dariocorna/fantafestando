import mongoose, { Schema, Document } from 'mongoose';

export interface IEvent extends Document {
    name: string;
    active: boolean;
    archived: boolean;
    settings: {
        askName: boolean;
        askTable: boolean;
        defaultCashierPrinterIp?: string;
    };
    predefinedTables: string[];
}

const EventSchema = new Schema<IEvent>({
    name: { type: String, required: true },
    active: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    settings: {
        askName: { type: Boolean, default: false },
        askTable: { type: Boolean, default: false },
        defaultCashierPrinterIp: { type: String }
    },
    predefinedTables: { type: [String], default: [] }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Event;
}

export default mongoose.models.Event || mongoose.model<IEvent>('Event', EventSchema);
