export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { ensureRuntimeBackupSchedulerStarted } = await import("./lib/runtime-backup-scheduler");
  ensureRuntimeBackupSchedulerStarted();
}
