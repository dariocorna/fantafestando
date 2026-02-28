import mongoose, { Schema, Document } from 'mongoose';

const QuickDiscountPresetSchema = new Schema({
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ["PERCENT", "FIXED"], required: true },
    value: { type: Number, min: 0, required: true }
}, { _id: false });

export interface IEvent extends Document {
    name: string;
    active: boolean;
    archived: boolean;
    settings: {
        askName: boolean;
        askTable: boolean;
        posCatalogLayout?: "COMPACT_COLUMNS" | "MODERN_TABS";
        menuHeaderLogoUrl?: string;
        receiptHeaderLogoUrl?: string;
        defaultCashierPrinterIp?: string;
        quickDiscountPresets?: Array<{
            label: string;
            type: "PERCENT" | "FIXED";
            value: number;
        }>;
        quickStaffDiscountEnabled?: boolean;
        quickStaffDiscountLabel?: string;
        quickStaffDiscountType?: "PERCENT" | "FIXED";
        quickStaffDiscountValue?: number;
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
        posCatalogLayout: { type: String, enum: ["COMPACT_COLUMNS", "MODERN_TABS"], default: "COMPACT_COLUMNS" },
        menuHeaderLogoUrl: { type: String, trim: true },
        receiptHeaderLogoUrl: { type: String, trim: true },
        defaultCashierPrinterIp: { type: String },
        quickDiscountPresets: { type: [QuickDiscountPresetSchema], default: [] },
        quickStaffDiscountEnabled: { type: Boolean, default: false },
        quickStaffDiscountLabel: { type: String, default: "Staff" },
        quickStaffDiscountType: { type: String, enum: ["PERCENT", "FIXED"], default: "PERCENT" },
        quickStaffDiscountValue: { type: Number, min: 0, default: 50 }
    },
    predefinedTables: { type: [String], default: [] }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Event;
}

export default mongoose.models.Event || mongoose.model<IEvent>('Event', EventSchema);
