import { NextResponse } from "next/server";
import { getAppVersion, getAppVersionLabel } from "@/lib/app-version";
import { ensureRuntimeBackupSchedulerStarted } from "@/lib/runtime-backup-scheduler";
import { normalizeAppSurface } from "@/lib/runtime-surface";

export async function GET() {
  ensureRuntimeBackupSchedulerStarted();

  return NextResponse.json({
    status: "ok",
    surface: normalizeAppSurface(process.env.APP_SURFACE),
    version: getAppVersion(),
    release: getAppVersionLabel(),
    timestamp: new Date().toISOString(),
  });
}
