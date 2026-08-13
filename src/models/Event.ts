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
        portalEasterEggEnabled?: boolean;
        portalEasterEggImageUrl?: string;
        portalEasterEggCrop?: {
            centerX: number;
            centerY: number;
            zoom: number;
            aspectRatio: "PORTRAIT_3_4" | "SQUARE_1_1" | "THERMAL_58";
        };
        portalEasterEggProcessing?: {
            autoEnhance: boolean;
            brightnessBoost: number;
            thresholdBase: number;
        };
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
        timezone?: string;
    };
    predefinedTables: string[];
    sumupOperationClaim?: {
        token: string;
        expiresAt: Date;
    };
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
        portalEasterEggEnabled: { type: Boolean, default: false },
        portalEasterEggImageUrl: { type: String, trim: true },
        portalEasterEggCrop: {
            centerX: { type: Number, min: 0, max: 100, default: 50 },
            centerY: { type: Number, min: 0, max: 100, default: 50 },
            zoom: { type: Number, min: 1, max: 4, default: 1.6 },
            aspectRatio: {
                type: String,
                enum: ["PORTRAIT_3_4", "SQUARE_1_1", "THERMAL_58"],
                default: "PORTRAIT_3_4"
            }
        },
        portalEasterEggProcessing: {
            autoEnhance: { type: Boolean, default: true },
            brightnessBoost: { type: Number, min: 0, max: 80, default: 20 },
            thresholdBase: { type: Number, min: 80, max: 220, default: 130 }
        },
        defaultCashierPrinterIp: { type: String },
        quickDiscountPresets: { type: [QuickDiscountPresetSchema], default: [] },
        quickStaffDiscountEnabled: { type: Boolean, default: false },
        quickStaffDiscountLabel: { type: String, default: "Staff" },
        quickStaffDiscountType: { type: String, enum: ["PERCENT", "FIXED"], default: "PERCENT" },
        quickStaffDiscountValue: { type: Number, min: 0, default: 50 },
        timezone: { type: String, trim: true, default: "Europe/Rome" }
    },
    predefinedTables: { type: [String], default: [] },
    sumupOperationClaim: {
        token: { type: String, required: true },
        expiresAt: { type: Date, required: true }
    }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Event;
}

export default mongoose.models.Event || mongoose.model<IEvent>('Event', EventSchema);
