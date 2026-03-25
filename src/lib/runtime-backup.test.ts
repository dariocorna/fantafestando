import { afterEach, describe, expect, test } from "vitest";
import { isBackupDue, resolveBackupTargetPath } from "@/lib/runtime-backup";

const originalBackupTargetsRoot = process.env.BACKUP_TARGETS_ROOT;

afterEach(() => {
  if (typeof originalBackupTargetsRoot === "string") {
    process.env.BACKUP_TARGETS_ROOT = originalBackupTargetsRoot;
    return;
  }

  delete process.env.BACKUP_TARGETS_ROOT;
});

describe("runtime backup scheduling", () => {
  test("runs immediately when there is no previous completion time", () => {
    expect(isBackupDue(undefined, 24, new Date("2026-03-25T10:00:00.000Z"))).toBe(true);
  });

  test("waits for the configured interval before running again", () => {
    const now = new Date("2026-03-25T10:00:00.000Z");
    expect(isBackupDue("2026-03-25T05:30:00.000Z", 6, now)).toBe(false);
    expect(isBackupDue("2026-03-25T03:59:59.000Z", 6, now)).toBe(true);
  });
});

describe("backup target resolution", () => {
  test("resolves relative paths within the configured root", () => {
    process.env.BACKUP_TARGETS_ROOT = "/tmp/fantafestando-backups";

    expect(resolveBackupTargetPath(".")).toBe("/tmp/fantafestando-backups");
    expect(resolveBackupTargetPath("usb/drive-a")).toBe("/tmp/fantafestando-backups/usb/drive-a");
  });

  test("rejects traversal outside the configured root", () => {
    process.env.BACKUP_TARGETS_ROOT = "/tmp/fantafestando-backups";

    expect(() => resolveBackupTargetPath("../etc/passwd")).toThrow("Destinazione backup non valida.");
  });

  test("fails when no backup root is configured", () => {
    delete process.env.BACKUP_TARGETS_ROOT;

    expect(() => resolveBackupTargetPath("usb/drive-a")).toThrow(
      "Nessuna root backup configurata nel container."
    );
  });
});
