import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import SystemSettings from "../src/models/SystemSettings";
import { ensureAdminAuthenticated } from "./utils/auth";
import { ensureDbConnection } from "./utils/db";
import { uniqueSuffix } from "./utils/fixtures";

const backupTargetsRoot = process.env.BACKUP_TARGETS_ROOT || path.join(process.cwd(), "test-results", "e2e-backup-targets");

async function resetBackupSettings() {
  await ensureDbConnection();
  await SystemSettings.findOneAndUpdate(
    { singletonKey: "default" },
    {
      $set: {
        singletonKey: "default",
        "backup.periodicEnabled": false,
        "backup.intervalHours": 24,
        "backup.retentionCount": 30,
        "backup.lastRunStatus": "IDLE",
      },
      $unset: {
        "backup.targetRelativePath": 1,
        "backup.lastRunStartedAt": 1,
        "backup.lastRunFinishedAt": 1,
        "backup.lastSuccessAt": 1,
        "backup.lastRunMessage": 1,
        "backup.lastBundleName": 1,
        "backup.lastTrigger": 1,
        "backup.lastRestoreAt": 1,
        "backup.lastRestoreStatus": 1,
        "backup.lastRestoreMessage": 1,
      },
    },
    { upsert: true }
  );
}

async function listBackupBundles(targetDir: string) {
  const entries = await readdir(targetDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tar.gz"))
    .map((entry) => path.join(targetDir, entry.name))
    .sort();
}

test.describe("Admin runtime backups", () => {
  let targetRelativePath = "";
  let targetAbsolutePath = "";

  test.beforeEach(async ({ page }) => {
    targetRelativePath = `usb-e2e-${uniqueSuffix()}`;
    targetAbsolutePath = path.join(backupTargetsRoot, targetRelativePath);

    await rm(targetAbsolutePath, { recursive: true, force: true });
    await mkdir(targetAbsolutePath, { recursive: true });
    await resetBackupSettings();
    await ensureAdminAuthenticated(page, "/admin/settings/backups");
  });

  test.afterEach(async () => {
    await resetBackupSettings();
    await rm(targetAbsolutePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test("configures the backup policy, saves a bundle on target storage, downloads a manual bundle and validates restore guards", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Flusso validato su desktop");

    await page.goto("/admin/settings/backups");

    await expect(page.getByRole("heading", { name: /Backup e Ripristino/i })).toBeVisible();
    await page.locator("#targetRelativePath").selectOption(targetRelativePath);
    await page.locator("#periodicEnabled").check();
    await page.locator("#intervalHours").fill("6");
    await page.locator("#retentionCount").fill("2");
    await page.getByRole("button", { name: /Salva policy/i }).click();

    await expect(page.getByText(/Politica backup aggiornata/i)).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => {
      await ensureDbConnection();
      const settings = await SystemSettings.findOne({ singletonKey: "default" }).lean<{
        backup?: {
          periodicEnabled?: boolean;
          intervalHours?: number;
          retentionCount?: number;
          targetRelativePath?: string;
        };
      } | null>();
      return settings?.backup || null;
    }).toMatchObject({
      periodicEnabled: true,
      intervalHours: 6,
      retentionCount: 2,
      targetRelativePath,
    });

    await page.reload();
    await expect(page.locator("#targetRelativePath")).toHaveValue(targetRelativePath);
    await expect(page.locator("#intervalHours")).toHaveValue("6");
    await expect(page.locator("#retentionCount")).toHaveValue("2");

    await page.getByRole("button", { name: /Esegui backup ora sulla destinazione/i }).click();
    await expect(page.getByText(/Backup completato:/i).first()).toBeVisible({ timeout: 30000 });

    await expect.poll(async () => (await listBackupBundles(targetAbsolutePath)).length, {
      timeout: 30000,
    }).toBe(1);

    const [savedBundlePath] = await listBackupBundles(targetAbsolutePath);
    expect(savedBundlePath).toBeTruthy();
    const savedBundleListing = execFileSync("tar", ["-tzf", savedBundlePath], { encoding: "utf8" });
    expect(savedBundleListing).toContain("manifest.json");
    expect(savedBundleListing).toContain("mongo/events.jsonl");
    expect(savedBundleListing).toContain("/uploads/");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: /Scarica backup ora/i }).click(),
    ]);

    const downloadedBundlePath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(downloadedBundlePath);
    expect(existsSync(downloadedBundlePath)).toBe(true);
    const downloadedBundleListing = execFileSync("tar", ["-tzf", downloadedBundlePath], { encoding: "utf8" });
    expect(downloadedBundleListing).toContain("manifest.json");
    expect(downloadedBundleListing).toContain("mongo/events.jsonl");

    await page.getByRole("button", { name: /^Avvia restore$/i }).click();
    await expect(page.getByText(/Seleziona un file backup valido da ripristinare/i)).toBeVisible();

    const fakeBundlePath = testInfo.outputPath("fake-runtime-backup.tar.gz");
    await writeFile(fakeBundlePath, "not-a-real-backup");
    await page.locator("#bundleFile").setInputFiles(fakeBundlePath);
    await page.locator("#confirmation").fill("SBAGLIATO");
    await page.getByRole("button", { name: /^Avvia restore$/i }).click();
    await expect(page.getByText(/Conferma digitando RIPRISTINA/i)).toBeVisible();
  });
});
