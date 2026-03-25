import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  ensureAdminSessionMock,
  dbConnectMock,
  findOneAndUpdateMock,
  getBackupSettingsViewMock,
  resolveBackupTargetPathMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  ensureAdminSessionMock: vi.fn(),
  dbConnectMock: vi.fn(),
  findOneAndUpdateMock: vi.fn(),
  getBackupSettingsViewMock: vi.fn(),
  resolveBackupTargetPathMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/authz", () => ({
  ensureAdminSession: ensureAdminSessionMock,
}));

vi.mock("@/lib/mongoose", () => ({
  default: dbConnectMock,
}));

vi.mock("@/models/SystemSettings", () => ({
  default: {
    findOneAndUpdate: findOneAndUpdateMock,
  },
}));

vi.mock("@/lib/runtime-backup", () => ({
  DEFAULT_BACKUP_INTERVAL_HOURS: 24,
  DEFAULT_BACKUP_RETENTION_COUNT: 30,
  getBackupSettingsView: getBackupSettingsViewMock,
  resolveBackupTargetPath: resolveBackupTargetPathMock,
  runConfiguredBackupNow: vi.fn(),
}));

import { saveBackupPolicyAction } from "./actions";

describe("backup settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureAdminSessionMock.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", username: "admin", role: "ADMIN" },
    });
    dbConnectMock.mockResolvedValue(undefined);
    findOneAndUpdateMock.mockResolvedValue(undefined);
    getBackupSettingsViewMock.mockResolvedValue({
      periodicEnabled: true,
      intervalHours: 12,
      retentionCount: 20,
      targetRelativePath: "usb/drive-a",
      lastRunStatus: "IDLE",
    });
    resolveBackupTargetPathMock.mockReturnValue("/data/backup-targets/usb/drive-a");
  });

  test("opens the database connection before persisting the policy", async () => {
    const formData = new FormData();
    formData.set("periodicEnabled", "on");
    formData.set("intervalHours", "12");
    formData.set("retentionCount", "20");
    formData.set("targetRelativePath", "usb/drive-a");

    const result = await saveBackupPolicyAction(formData);

    expect(dbConnectMock).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { singletonKey: "default" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "backup.periodicEnabled": true,
          "backup.intervalHours": 12,
          "backup.retentionCount": 20,
          "backup.targetRelativePath": "usb/drive-a",
        }),
      }),
      { upsert: true }
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/settings/backups");
    expect(result).toMatchObject({
      success: "Politica backup aggiornata.",
      settings: {
        targetRelativePath: "usb/drive-a",
      },
    });
  });
});
