import mongoose, { Document, Schema, Types } from "mongoose";

export interface IOrderCounter extends Document {
    eventId: Types.ObjectId;
    scope: "PUBLIC_ORDER" | "PIZZA_ORDER";
    seq: number;
}

const OrderCounterSchema = new Schema<IOrderCounter>({
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    scope: { type: String, enum: ["PUBLIC_ORDER", "PIZZA_ORDER"], required: true },
    seq: { type: Number, required: true, default: 0, min: 0 }
}, {
    timestamps: true
});

OrderCounterSchema.index({ eventId: 1, scope: 1 }, { unique: true });

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.OrderCounter;
}

export default mongoose.models.OrderCounter || mongoose.model<IOrderCounter>("OrderCounter", OrderCounterSchema);
