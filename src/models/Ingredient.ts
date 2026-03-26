import mongoose, { Document, Schema, Types } from "mongoose";

export interface IIngredient extends Document {
    eventId: Types.ObjectId;
    name: string;
    shortName?: string;
    sortOrder: number;
    active: boolean;
}

const IngredientSchema = new Schema<IIngredient>({
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    name: { type: String, required: true, trim: true },
    shortName: { type: String, trim: true, maxlength: 24 },
    sortOrder: { type: Number, required: true, min: 0, default: 0 },
    active: { type: Boolean, default: true },
}, {
    timestamps: true
});

IngredientSchema.index({ eventId: 1, sortOrder: 1, name: 1 });
IngredientSchema.index({ eventId: 1, shortName: 1 });

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.Ingredient;
}

export default mongoose.models.Ingredient || mongoose.model<IIngredient>("Ingredient", IngredientSchema);
