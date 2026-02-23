import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    username: string;
    passwordHash: string;
    role: 'ADMIN' | 'CASHIER';
}

const UserSchema = new Schema<IUser>({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['ADMIN', 'CASHIER'], default: 'CASHIER' }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.User;
}

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
