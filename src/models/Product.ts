import mongoose, { Schema, Document, Types } from 'mongoose';

export type ProductKind = "STANDARD" | "FIXED_MENU";
export type SalesChannel = "POS" | "MENU";

export interface IProduct extends Document {
    eventId: Types.ObjectId;
    categoryId: Types.ObjectId;
    name: string;
    shortName?: string;
    description?: string;
    basePrice: number;
    volunteerPrice?: number | null;
    kind: ProductKind;
    availableOnlyInMenus: boolean;
    salesChannels: SalesChannel[];
    splitKitchenPrintPerUnit: boolean;
    isSoldOut: boolean;
    stockQuantity: number | null;
    availableDays: string[];
    recipeItems: Array<{
        ingredientId: Types.ObjectId;
        quantity: number;
    }>;
    menuComponents: Array<{
        productId: Types.ObjectId;
        quantity: number;
    }>;
    menuChoiceGroups: Array<{
        id: string;
        name: string;
        minSelections: number;
        maxSelections: number;
        options: Array<{
            productId: Types.ObjectId;
            quantity: number;
        }>;
    }>;
    variants: Array<{
        optionName: string;
        priceVariation: number;
        stockQuantity?: number | null;
    }>;
    stockOperationKeys?: string[];
}

const ProductSchema = new Schema<IProduct>({
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true },
    shortName: { type: String, trim: true, maxlength: 24 },
    description: { type: String, trim: true },
    basePrice: { type: Number, required: true },
    volunteerPrice: { type: Number, default: null, min: 0 },
    kind: { type: String, enum: ["STANDARD", "FIXED_MENU"], default: "STANDARD" },
    availableOnlyInMenus: { type: Boolean, default: false },
    salesChannels: {
        type: [String],
        enum: ["POS", "MENU"],
        default: ["POS", "MENU"]
    },
    splitKitchenPrintPerUnit: { type: Boolean, default: false },
    isSoldOut: { type: Boolean, default: false },
    stockQuantity: { type: Number, default: null, min: 0 },
    availableDays: { type: [String], default: [] },
    recipeItems: [{
        ingredientId: { type: Schema.Types.ObjectId, ref: 'Ingredient', required: true },
        quantity: { type: Number, required: true, min: 1, default: 1 }
    }],
    menuComponents: [{
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        quantity: { type: Number, required: true, min: 1, default: 1 }
    }],
    menuChoiceGroups: [{
        id: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        minSelections: { type: Number, required: true, min: 0, default: 1 },
        maxSelections: { type: Number, required: true, min: 1, default: 1 },
        options: [{
            productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
            quantity: { type: Number, required: true, min: 1, default: 1 }
        }]
    }],
    variants: [{
        optionName: { type: String, required: true },
        priceVariation: { type: Number, required: true },
        stockQuantity: { type: Number, default: null, min: 0 }
    }],
    stockOperationKeys: { type: [String], default: [], select: false }
}, {
    timestamps: true
});

ProductSchema.index({ eventId: 1, shortName: 1 });

ProductSchema.pre("validate", function () {
    if (this.volunteerPrice != null && this.volunteerPrice > Number(this.basePrice || 0)) {
        this.invalidate("volunteerPrice", "Il prezzo volontari non può superare il prezzo base");
    }
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Product;
}

export default mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);
