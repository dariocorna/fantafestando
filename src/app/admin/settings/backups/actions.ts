"use server";

import { revalidatePath } from "next/cache";
import { ensureAdminSession } from "@/lib/authz";
import dbConnect from "@/lib/mongoose";
import SystemSettings from "@/models/SystemSettings";
import {
  DEFAULT_BACKUP_INTERVAL_HOURS,
  DEFAULT_BACKUP_RETENTION_COUNT,
  getBackupSettingsView,
  resolveBackupTargetPath,
  runConfiguredBackupNow,
  type BackupSettingsView,
} from "@/lib/runtime-backup";

export interface BackupAdminActionState {
  success?: string;
  error?: string;
  settings?: BackupSettingsView;
}

async function requireAdminAuthorization() {
  const sessionCheck = await ensureAdminSession();
  if (!sessionCheck.ok) {
    return { error: sessionCheck.error } as const;
  }
  return null;
}

function parseIntegerInput(value: FormDataEntryValue | null, fallback: number) {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBackupTargetSelection(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function saveBackupPolicyAction(formData: FormData): Promise<BackupAdminActionState> {
  const authError = await requireAdminAuthorization();
  if (authError) return authError;

  const periodicEnabled = formData.get("periodicEnabled") === "on";
  const intervalHours = Math.min(
    720,
    Math.max(1, parseIntegerInput(formData.get("intervalHours"), DEFAULT_BACKUP_INTERVAL_HOURS))
  );
  const retentionCount = Math.min(
    365,
    Math.max(1, parseIntegerInput(formData.get("retentionCount"), DEFAULT_BACKUP_RETENTION_COUNT))
  );
  const targetRelativePath = parseBackupTargetSelection(formData.get("targetRelativePath"));

  if (periodicEnabled && !targetRelativePath) {
    return {
      error: "Seleziona una destinazione di backup prima di attivare la policy periodica.",
      settings: await getBackupSettingsView(),
    };
  }

  if (targetRelativePath) {
    try {
      resolveBackupTargetPath(targetRelativePath);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Destinazione backup non valida.",
        settings: await getBackupSettingsView(),
      };
    }
  }

  await dbConnect();
  const update: {
    $set: Record<string, unknown>;
    $unset?: Record<string, 1>;
  } = {
    $set: {
      singletonKey: "default",
      "backup.periodicEnabled": periodicEnabled,
      "backup.intervalHours": intervalHours,
      "backup.retentionCount": retentionCount,
    },
  };

  if (targetRelativePath) {
    update.$set["backup.targetRelativePath"] = targetRelativePath;
  } else {
    update.$unset = { "backup.targetRelativePath": 1 };
  }

  await SystemSettings.findOneAndUpdate({ singletonKey: "default" }, update, { upsert: true });

  revalidatePath("/admin/settings/backups");
  return {
    success: "Politica backup aggiornata.",
    settings: await getBackupSettingsView(),
  };
}

export async function runConfiguredBackupNowAction(): Promise<BackupAdminActionState> {
  const authError = await requireAdminAuthorization();
  if (authError) return authError;

  try {
    const result = await runConfiguredBackupNow("MANUAL");
    revalidatePath("/admin/settings/backups");
    return {
      success: `Backup completato: ${result.fileName}`,
      settings: await getBackupSettingsView(),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Errore durante il backup manuale.",
      settings: await getBackupSettingsView(),
    };
  }
}
