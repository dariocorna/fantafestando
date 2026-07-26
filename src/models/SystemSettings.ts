import mongoose, { Document, Schema } from "mongoose";

export type BackupRunStatus = "IDLE" | "RUNNING" | "SUCCESS" | "ERROR";
export type BackupTrigger = "MANUAL" | "SCHEDULED";
export type RestoreRunStatus = "SUCCESS" | "ERROR";

export interface ISystemSettings extends Document {
    singletonKey: string;
    remoteAccess: {
        menuEnabled: boolean;
        adminEnabled: boolean;
        posEnabled: boolean;
        sshEnabled: boolean;
        posLanAuthenticationEnabled: boolean;
        appliedMenuEnabled: boolean;
        appliedAdminEnabled: boolean;
        appliedPosEnabled: boolean;
        appliedSshEnabled: boolean;
        requestedBy?: string;
        requestedAt?: Date;
        lastControllerAt?: Date;
        lastError?: string;
    };
    backup: {
        periodicEnabled: boolean;
        intervalHours: number;
        retentionCount: number;
        targetRelativePath?: string;
        lastRunStatus: BackupRunStatus;
        lastRunStartedAt?: Date;
        lastRunFinishedAt?: Date;
        lastSuccessAt?: Date;
        lastRunMessage?: string;
        lastBundleName?: string;
        lastTrigger?: BackupTrigger;
        lastRestoreAt?: Date;
        lastRestoreStatus?: RestoreRunStatus;
        lastRestoreMessage?: string;
    };
}

const SystemSettingsSchema = new Schema<ISystemSettings>({
    singletonKey: {
        type: String,
        required: true,
        unique: true,
        default: "default",
        immutable: true,
        trim: true
    },
    remoteAccess: {
        menuEnabled: { type: Boolean, default: true },
        adminEnabled: { type: Boolean, default: false },
        posEnabled: { type: Boolean, default: false },
        sshEnabled: { type: Boolean, default: false },
        posLanAuthenticationEnabled: { type: Boolean, default: true },
        appliedMenuEnabled: { type: Boolean, default: true },
        appliedAdminEnabled: { type: Boolean, default: false },
        appliedPosEnabled: { type: Boolean, default: false },
        appliedSshEnabled: { type: Boolean, default: false },
        requestedBy: { type: String, trim: true },
        requestedAt: { type: Date },
        lastControllerAt: { type: Date },
        lastError: { type: String, trim: true }
    },
    backup: {
        periodicEnabled: { type: Boolean, default: false },
        intervalHours: { type: Number, min: 1, max: 720, default: 24 },
        retentionCount: { type: Number, min: 1, max: 365, default: 30 },
        targetRelativePath: { type: String, trim: true },
        lastRunStatus: {
            type: String,
            enum: ["IDLE", "RUNNING", "SUCCESS", "ERROR"],
            default: "IDLE"
        },
        lastRunStartedAt: { type: Date },
        lastRunFinishedAt: { type: Date },
        lastSuccessAt: { type: Date },
        lastRunMessage: { type: String, trim: true },
        lastBundleName: { type: String, trim: true },
        lastTrigger: {
            type: String,
            enum: ["MANUAL", "SCHEDULED"]
        },
        lastRestoreAt: { type: Date },
        lastRestoreStatus: {
            type: String,
            enum: ["SUCCESS", "ERROR"]
        },
        lastRestoreMessage: { type: String, trim: true }
    }
}, {
    timestamps: true
});

if (process.env.NODE_ENV === "development") {
    delete mongoose.models.SystemSettings;
}

export default mongoose.models.SystemSettings || mongoose.model<ISystemSettings>("SystemSettings", SystemSettingsSchema);
