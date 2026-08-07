import mongoose, { Schema, Document, Types } from "mongoose"

export interface ICashSession extends Document {
    eventId: Types.ObjectId
    posDeviceId: Types.ObjectId
    status: "OPEN" | "CLOSED"
    isTest: boolean
    stockEffectStatus: "APPLIED" | "REVERTED"
    transition?: {
        token: string
        type: "TO_TEST" | "TO_NORMAL" | "CLOSE" | "DELETE"
        status: "IN_PROGRESS" | "FAILED"
        claimedAt?: Date
        error?: string
    }
    paymentClaim?: {
        token: string
        claimedAt: Date
    }
    deletionStatus?: "IN_PROGRESS" | "FAILED"
    openedAt: Date
    openingFloatAmount: number
    openingNotes?: string
    closedAt?: Date
    closingCountedCashAmount?: number
    closingNotes?: string
    paidOrdersCount?: number
    cashSalesAmount?: number
    cardSalesAmount?: number
    otherSalesAmount?: number
    expectedCashAmount?: number
    varianceAmount?: number
    createdAt?: Date
    updatedAt?: Date
}

const CashSessionSchema = new Schema<ICashSession>({
    eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
    posDeviceId: { type: Schema.Types.ObjectId, ref: "PosDevice", required: true },
    status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN", required: true },
    isTest: { type: Boolean, default: false, required: true },
    stockEffectStatus: { type: String, enum: ["APPLIED", "REVERTED"], default: "APPLIED", required: true },
    transition: {
        token: { type: String },
        type: { type: String, enum: ["TO_TEST", "TO_NORMAL", "CLOSE", "DELETE"] },
        status: { type: String, enum: ["IN_PROGRESS", "FAILED"] },
        claimedAt: { type: Date },
        error: { type: String }
    },
    paymentClaim: {
        token: { type: String },
        claimedAt: { type: Date }
    },
    deletionStatus: { type: String, enum: ["IN_PROGRESS", "FAILED"] },
    openedAt: { type: Date, required: true, default: Date.now },
    openingFloatAmount: { type: Number, required: true, min: 0, default: 0 },
    openingNotes: { type: String },
    closedAt: { type: Date },
    closingCountedCashAmount: { type: Number, min: 0 },
    closingNotes: { type: String },
    paidOrdersCount: { type: Number, min: 0 },
    cashSalesAmount: { type: Number, min: 0 },
    cardSalesAmount: { type: Number, min: 0 },
    otherSalesAmount: { type: Number, min: 0 },
    expectedCashAmount: { type: Number, min: 0 },
    varianceAmount: { type: Number }
}, {
    timestamps: true
})

CashSessionSchema.index(
    { eventId: 1, posDeviceId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "OPEN" } }
)
CashSessionSchema.index({ eventId: 1, posDeviceId: 1, openedAt: -1 })

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.CashSession
}

export default mongoose.models.CashSession || mongoose.model<ICashSession>("CashSession", CashSessionSchema)
