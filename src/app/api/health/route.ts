import { NextResponse } from "next/server";
import { getAppVersion, getAppVersionLabel } from "@/lib/app-version";
import { ensureRuntimeBackupSchedulerStarted } from "@/lib/runtime-backup-scheduler";
import { ensurePrintQueueSchedulerStarted } from "@/lib/print-queue-scheduler";
import { normalizeAppSurface } from "@/lib/runtime-surface";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureRuntimeBackupSchedulerStarted();
  ensurePrintQueueSchedulerStarted();

  return NextResponse.json({
    status: "ok",
    surface: normalizeAppSurface(process.env.APP_SURFACE),
    version: getAppVersion(),
    release: getAppVersionLabel(),
    timestamp: new Date().toISOString(),
  });
}
