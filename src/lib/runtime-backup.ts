import "server-only";

import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants, createWriteStream } from "node:fs";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { EJSON } from "bson";
import { getAppVersion, getAppVersionLabel } from "@/lib/app-version";
import dbConnect from "@/lib/mongoose";
import CashSession from "@/models/CashSession";
import Category from "@/models/Category";
import Event from "@/models/Event";
import Order from "@/models/Order";
import OrderCounter from "@/models/OrderCounter";
import Peripheral from "@/models/Peripheral";
import PosDevice from "@/models/PosDevice";
import PrintJob from "@/models/PrintJob";
import Printer from "@/models/Printer";
import Product from "@/models/Product";
import SystemSettings, {
  type BackupRunStatus,
  type BackupTrigger,
  type ISystemSettings,
  type RestoreRunStatus,
} from "@/models/SystemSettings";
import User from "@/models/User";

export const ADMIN_BACKUP_FORMAT = "admin-runtime-backup-v1";
export const ADMIN_BACKUP_PREFIX = "fantafestando-admin-backup";
export const DEFAULT_BACKUP_INTERVAL_HOURS = 24;
export const DEFAULT_BACKUP_RETENTION_COUNT = 30;
const BACKUP_TARGET_SCAN_MAX_DEPTH = 2;
const ROOT_TARGET_RELATIVE_PATH = ".";

const COLLECTION_MODELS = [
  SystemSettings,
  User,
  Event,
  Category,
  Product,
  Printer,
  Peripheral,
  PosDevice,
  CashSession,
  OrderCounter,
  Order,
  PrintJob,
] as const;

type RuntimeBackupGlobalState = {
  activeBackupPromise: Promise<RuntimeBackupExecutionResult> | null;
  restoreInProgress: boolean;
};

interface CollectionBackupManifest {
  collectionName: string;
  fileName: string;
  documentCount: number;
}

interface UploadsBackupManifest {
  included: boolean;
  directoryName: string;
  fileCount: number;
}

export interface RuntimeBackupManifest {
  format: string;
  createdAt: string;
  source: "admin";
  appVersion: string;
  appRelease: string;
  bundleName: string;
  collections: CollectionBackupManifest[];
  uploads: UploadsBackupManifest;
}

export interface BackupTargetOption {
  relativePath: string;
  label: string;
  writable: boolean;
}

export interface BackupSettingsView {
  periodicEnabled: boolean;
  intervalHours: number;
  retentionCount: number;
  targetRelativePath: string;
  lastRunStatus: BackupRunStatus;
  lastRunStartedAt?: string;
  lastRunFinishedAt?: string;
  lastSuccessAt?: string;
  lastRunMessage?: string;
  lastBundleName?: string;
  lastTrigger?: BackupTrigger;
  lastRestoreAt?: string;
  lastRestoreStatus?: RestoreRunStatus;
  lastRestoreMessage?: string;
}

export interface BackupAdminPageData {
  settings: BackupSettingsView;
  targets: BackupTargetOption[];
  targetsRoot: string | null;
  downloadUrl: string;
  restoreUrl: string;
}

export interface RuntimeBackupExecutionResult {
  ok: true;
  fileName: string;
  outputPath?: string;
  manifest: RuntimeBackupManifest;
}

export interface GeneratedBackupBundle {
  fileName: string;
  filePath: string;
  manifest: RuntimeBackupManifest;
  cleanup: () => Promise<void>;
}

export interface RestoreRuntimeBackupResult {
  manifest: RuntimeBackupManifest;
  restoredCollections: number;
  restoredDocuments: number;
  restoredUploads: boolean;
}

type CollectionDefinition = {
  collectionName: string;
  fileName: string;
};

type StagedRestoreCollection = {
  collectionName: string;
  tempCollectionName: string;
  backupCollectionName: string;
  liveCollectionExists: boolean;
  documentCount: number;
};

type StagedUploadsRestore = {
  liveDirPath: string;
  stagedDirPath: string;
  backupDirPath: string;
};

const runtimeBackupGlobal = globalThis as typeof globalThis & {
  __fantafestandoRuntimeBackupState?: RuntimeBackupGlobalState;
};

function getRuntimeBackupGlobalState(): RuntimeBackupGlobalState {
  if (!runtimeBackupGlobal.__fantafestandoRuntimeBackupState) {
    runtimeBackupGlobal.__fantafestandoRuntimeBackupState = {
      activeBackupPromise: null,
      restoreInProgress: false,
    };
  }

  return runtimeBackupGlobal.__fantafestandoRuntimeBackupState;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function getBackupTargetsRoot(): string | null {
  const raw = process.env.BACKUP_TARGETS_ROOT?.trim();
  if (!raw) return null;
  return path.resolve(raw);
}

function isPathWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatBackupTimestamp(date: Date) {
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const min = `${date.getMinutes()}`.padStart(2, "0");
  const sec = `${date.getSeconds()}`.padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isWritable(targetPath: string) {
  try {
    await access(targetPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function countFilesRecursively(targetPath: string): Promise<number> {
  if (!(await pathExists(targetPath))) {
    return 0;
  }

  const stats = await stat(targetPath);
  if (!stats.isDirectory()) {
    return 1;
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await countFilesRecursively(entryPath);
    } else if (entry.isFile()) {
      total += 1;
    }
  }

  return total;
}

function requireMongoDb() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Connessione MongoDB non disponibile.");
  }
  return db;
}

async function runTarArchive(bundleRootDir: string, bundleDirName: string, outputFilePath: string) {
  await mkdir(path.dirname(outputFilePath), { recursive: true });

  const child = spawn("tar", ["-czf", outputFilePath, "-C", bundleRootDir, bundleDirName], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = (await once(child, "close")) as [number];
  if (code !== 0) {
    throw new Error(stderr.trim() || "Impossibile creare l'archivio compresso del backup.");
  }
}

async function extractTarArchive(bundleFilePath: string, outputDir: string) {
  const child = spawn("tar", ["-xzf", bundleFilePath, "-C", outputDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = (await once(child, "close")) as [number];
  if (code !== 0) {
    throw new Error(stderr.trim() || "Impossibile estrarre l'archivio del backup.");
  }
}

function getCollectionDefinitions(): CollectionDefinition[] {
  return COLLECTION_MODELS.map((model) => ({
    collectionName: model.collection.collectionName,
    fileName: `${model.collection.collectionName}.jsonl`,
  }));
}

async function ensureSystemSettingsDocument() {
  await dbConnect();
  await SystemSettings.findOneAndUpdate(
    { singletonKey: "default" },
    {
      $setOnInsert: {
        singletonKey: "default",
        backup: {
          periodicEnabled: false,
          intervalHours: DEFAULT_BACKUP_INTERVAL_HOURS,
          retentionCount: DEFAULT_BACKUP_RETENTION_COUNT,
          lastRunStatus: "IDLE",
        },
      },
    },
    { upsert: true }
  );

  return SystemSettings.findOne({ singletonKey: "default" }).lean<ISystemSettings | null>();
}

export async function getBackupSettingsView(): Promise<BackupSettingsView> {
  const settings = await ensureSystemSettingsDocument();
  const backup = settings?.backup;

  return {
    periodicEnabled: Boolean(backup?.periodicEnabled),
    intervalHours: Number.isFinite(backup?.intervalHours)
      ? Number(backup?.intervalHours)
      : DEFAULT_BACKUP_INTERVAL_HOURS,
    retentionCount: Number.isFinite(backup?.retentionCount)
      ? Number(backup?.retentionCount)
      : DEFAULT_BACKUP_RETENTION_COUNT,
    targetRelativePath: typeof backup?.targetRelativePath === "string" ? backup.targetRelativePath : "",
    lastRunStatus: (backup?.lastRunStatus || "IDLE") as BackupRunStatus,
    lastRunStartedAt: toIsoString(backup?.lastRunStartedAt),
    lastRunFinishedAt: toIsoString(backup?.lastRunFinishedAt),
    lastSuccessAt: toIsoString(backup?.lastSuccessAt),
    lastRunMessage: typeof backup?.lastRunMessage === "string" ? backup.lastRunMessage : undefined,
    lastBundleName: typeof backup?.lastBundleName === "string" ? backup.lastBundleName : undefined,
    lastTrigger: backup?.lastTrigger as BackupTrigger | undefined,
    lastRestoreAt: toIsoString(backup?.lastRestoreAt),
    lastRestoreStatus: backup?.lastRestoreStatus as RestoreRunStatus | undefined,
    lastRestoreMessage:
      typeof backup?.lastRestoreMessage === "string" ? backup.lastRestoreMessage : undefined,
  };
}

async function collectDirectoryCandidates(
  rootDir: string,
  depth: number,
  relativeBase = ""
): Promise<BackupTargetOption[]> {
  if (depth < 0) return [];

  const baseDir = path.join(rootDir, relativeBase);
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return [];
  }
  const results: BackupTargetOption[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    const normalizedBase = relativeBase.replace(/\\/g, "/");
    const relativePath = normalizedBase ? path.posix.join(normalizedBase, entry.name) : entry.name;
    const absolutePath = path.resolve(rootDir, relativePath);

    results.push({
      relativePath,
      label: relativePath,
      writable: await isWritable(absolutePath),
    });

    if (depth > 0) {
      results.push(...(await collectDirectoryCandidates(rootDir, depth - 1, relativePath)));
    }
  }

  return results;
}

export async function listBackupTargetOptions(): Promise<BackupTargetOption[]> {
  const rootDir = getBackupTargetsRoot();
  if (!rootDir || !(await pathExists(rootDir))) {
    return [];
  }

  const options: BackupTargetOption[] = [
    {
      relativePath: ROOT_TARGET_RELATIVE_PATH,
      label: "Root configurata",
      writable: await isWritable(rootDir),
    },
  ];

  const nested = await collectDirectoryCandidates(rootDir, BACKUP_TARGET_SCAN_MAX_DEPTH - 1);
  const unique = new Map<string, BackupTargetOption>();
  for (const option of [...options, ...nested]) {
    if (!unique.has(option.relativePath)) {
      unique.set(option.relativePath, option);
    }
  }

  return [...unique.values()].sort((left, right) => left.label.localeCompare(right.label, "it"));
}

export function resolveBackupTargetPath(relativePath: string) {
  const rootDir = getBackupTargetsRoot();
  if (!rootDir) {
    throw new Error("Nessuna root backup configurata nel container.");
  }

  const normalizedRelativePath = !relativePath || relativePath === ROOT_TARGET_RELATIVE_PATH
    ? ROOT_TARGET_RELATIVE_PATH
    : relativePath.trim().replace(/\\/g, "/");
  const resolved = normalizedRelativePath === ROOT_TARGET_RELATIVE_PATH
    ? rootDir
    : path.resolve(rootDir, normalizedRelativePath);

  if (!isPathWithinRoot(rootDir, resolved)) {
    throw new Error("Destinazione backup non valida.");
  }

  return resolved;
}

export function isBackupDue(
  lastFinishedAt: Date | string | null | undefined,
  intervalHours: number,
  now = new Date()
) {
  if (!lastFinishedAt) return true;
  const normalized = lastFinishedAt instanceof Date ? lastFinishedAt : new Date(lastFinishedAt);
  if (Number.isNaN(normalized.getTime())) return true;
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
  return now.getTime() - normalized.getTime() >= intervalMs;
}

async function writeCollectionBackupFile(collectionName: string, destinationFilePath: string) {
  const stream = createWriteStream(destinationFilePath, { encoding: "utf8" });
  const cursor = requireMongoDb().collection(collectionName).find({});
  let documentCount = 0;

  try {
    for await (const document of cursor as AsyncIterable<Record<string, unknown>>) {
      const payload = `${EJSON.stringify(document, { relaxed: false })}\n`;
      if (!stream.write(payload)) {
        await once(stream, "drain");
      }
      documentCount += 1;
    }
  } finally {
    stream.end();
    await new Promise<void>((resolve, reject) => {
      stream.once("finish", resolve);
      stream.once("error", reject);
    });
    await cursor.close();
  }

  return documentCount;
}

async function buildRuntimeBackupBundle(outputFilePath?: string): Promise<GeneratedBackupBundle> {
  await dbConnect();

  const now = new Date();
  const timestamp = formatBackupTimestamp(now);
  const bundleBaseName = `${ADMIN_BACKUP_PREFIX}-${timestamp}`;
  const tempRoot = await mkdtemp(path.join(tmpdir(), "fantafestando-admin-backup-"));
  const bundleDirPath = path.join(tempRoot, bundleBaseName);
  const bundleMongoDir = path.join(bundleDirPath, "mongo");
  const bundleUploadsDir = path.join(bundleDirPath, "uploads");
  const manifestPath = path.join(bundleDirPath, "manifest.json");
  const archiveFilePath = outputFilePath || path.join(tempRoot, `${bundleBaseName}.tar.gz`);

  await mkdir(bundleMongoDir, { recursive: true });
  await mkdir(bundleUploadsDir, { recursive: true });

  const collectionManifest: CollectionBackupManifest[] = [];
  for (const definition of getCollectionDefinitions()) {
    const destinationFilePath = path.join(bundleMongoDir, definition.fileName);
    const documentCount = await writeCollectionBackupFile(definition.collectionName, destinationFilePath);
    collectionManifest.push({
      collectionName: definition.collectionName,
      fileName: path.posix.join("mongo", definition.fileName),
      documentCount,
    });
  }

  const uploadsSourceDir = path.join(process.cwd(), "public", "uploads");
  const uploadsIncluded = await pathExists(uploadsSourceDir);
  if (uploadsIncluded) {
    await rm(bundleUploadsDir, { recursive: true, force: true });
    await cp(uploadsSourceDir, bundleUploadsDir, { recursive: true });
  }
  const uploadsFileCount = await countFilesRecursively(bundleUploadsDir);
  const bundleFileName = path.basename(archiveFilePath);

  const manifest: RuntimeBackupManifest = {
    format: ADMIN_BACKUP_FORMAT,
    createdAt: now.toISOString(),
    source: "admin",
    appVersion: getAppVersion(),
    appRelease: getAppVersionLabel(),
    bundleName: bundleFileName,
    collections: collectionManifest,
    uploads: {
      included: uploadsIncluded,
      directoryName: "uploads",
      fileCount: uploadsFileCount,
    },
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await runTarArchive(tempRoot, bundleBaseName, archiveFilePath);

  return {
    fileName: bundleFileName,
    filePath: archiveFilePath,
    manifest,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function pruneOldBundles(targetDir: string, keepCount: number) {
  if (keepCount < 1) return;

  const entries = await readdir(targetDir, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(`${ADMIN_BACKUP_PREFIX}-`) &&
        entry.name.endsWith(".tar.gz")
    )
    .map((entry) => ({
      name: entry.name,
      absolutePath: path.join(targetDir, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  const toDelete = candidates.slice(0, Math.max(0, candidates.length - keepCount));
  await Promise.all(toDelete.map((entry) => rm(entry.absolutePath, { force: true })));
}

async function updateBackupRunStatus(status: BackupRunStatus, patch: Record<string, unknown>) {
  await SystemSettings.findOneAndUpdate(
    { singletonKey: "default" },
    {
      $set: {
        singletonKey: "default",
        "backup.lastRunStatus": status,
        ...patch,
      },
    },
    { upsert: true }
  );
}

async function updateRestoreStatus(status: RestoreRunStatus, message: string) {
  await SystemSettings.findOneAndUpdate(
    { singletonKey: "default" },
    {
      $set: {
        singletonKey: "default",
        "backup.lastRestoreAt": new Date(),
        "backup.lastRestoreStatus": status,
        "backup.lastRestoreMessage": message,
      },
    },
    { upsert: true }
  );
}

export async function runConfiguredBackupNow(
  trigger: BackupTrigger
): Promise<RuntimeBackupExecutionResult> {
  const runtimeState = getRuntimeBackupGlobalState();
  if (runtimeState.restoreInProgress) {
    throw new Error("Ripristino in corso: attendi il completamento prima di eseguire un backup.");
  }
  if (runtimeState.activeBackupPromise) {
    throw new Error("Un backup è già in esecuzione.");
  }

  const promise = (async () => {
    const settings = await getBackupSettingsView();
    if (!settings.targetRelativePath) {
      throw new Error(
        "Seleziona una destinazione backup prima di eseguire il backup periodico o manuale."
      );
    }

    const targetDir = resolveBackupTargetPath(settings.targetRelativePath);
    await mkdir(targetDir, { recursive: true });
    await access(targetDir, constants.W_OK);

    const startTime = new Date();
    await updateBackupRunStatus("RUNNING", {
      "backup.lastRunStartedAt": startTime,
      "backup.lastRunFinishedAt": startTime,
      "backup.lastRunMessage":
        trigger === "SCHEDULED" ? "Backup periodico in esecuzione" : "Backup manuale in esecuzione",
      "backup.lastTrigger": trigger,
    });

    try {
      const fileName = `${ADMIN_BACKUP_PREFIX}-${formatBackupTimestamp(startTime)}.tar.gz`;
      const outputPath = path.join(targetDir, fileName);
      const generated = await buildRuntimeBackupBundle(outputPath);
      await pruneOldBundles(targetDir, settings.retentionCount);
      await generated.cleanup();

      const finishTime = new Date();
      const successMessage =
        trigger === "SCHEDULED"
          ? `Backup periodico completato: ${generated.fileName}`
          : `Backup completato: ${generated.fileName}`;

      await updateBackupRunStatus("SUCCESS", {
        "backup.lastRunFinishedAt": finishTime,
        "backup.lastSuccessAt": finishTime,
        "backup.lastRunMessage": successMessage,
        "backup.lastBundleName": generated.fileName,
      });

      return {
        ok: true,
        fileName: generated.fileName,
        outputPath,
        manifest: generated.manifest,
      } satisfies RuntimeBackupExecutionResult;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Errore sconosciuto durante il backup.";
      await updateBackupRunStatus("ERROR", {
        "backup.lastRunFinishedAt": new Date(),
        "backup.lastRunMessage": message,
      });
      throw error;
    }
  })();

  runtimeState.activeBackupPromise = promise;
  try {
    return await promise;
  } finally {
    runtimeState.activeBackupPromise = null;
  }
}

export async function generateRuntimeBackupDownload(): Promise<GeneratedBackupBundle> {
  const runtimeState = getRuntimeBackupGlobalState();
  if (runtimeState.restoreInProgress) {
    throw new Error(
      "Ripristino in corso: impossibile generare un backup scaricabile in questo momento."
    );
  }
  if (runtimeState.activeBackupPromise) {
    throw new Error("Un backup è già in esecuzione.");
  }

  const promise = buildRuntimeBackupBundle();
  runtimeState.activeBackupPromise = promise.then((bundle) => ({
    ok: true,
    fileName: bundle.fileName,
    manifest: bundle.manifest,
  }));
  void runtimeState.activeBackupPromise.catch(() => undefined);

  try {
    return await promise;
  } finally {
    runtimeState.activeBackupPromise = null;
  }
}

export async function maybeRunScheduledBackup() {
  const settings = await getBackupSettingsView();
  if (!settings.periodicEnabled) return null;
  if (!settings.targetRelativePath) return null;
  if (!isBackupDue(settings.lastRunFinishedAt, settings.intervalHours)) return null;
  return runConfiguredBackupNow("SCHEDULED");
}

function toCollectionMap() {
  return new Map(getCollectionDefinitions().map((definition) => [definition.collectionName, definition]));
}

async function getCollectionMetadata(db: ReturnType<typeof requireMongoDb>, collectionName: string) {
  const collections = await db.listCollections({ name: collectionName }).toArray();
  return collections[0] ?? null;
}

async function collectionExists(db: ReturnType<typeof requireMongoDb>, collectionName: string) {
  return Boolean(await getCollectionMetadata(db, collectionName));
}

function isNamespaceNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const maybeCode = "code" in error ? error.code : undefined;
  const maybeMessage = "message" in error ? error.message : undefined;
  return maybeCode === 26 || (typeof maybeMessage === "string" && maybeMessage.includes("ns not found"));
}

async function dropCollectionIfExists(db: ReturnType<typeof requireMongoDb>, collectionName: string) {
  try {
    await db.collection(collectionName).drop();
    return true;
  } catch (error) {
    if (isNamespaceNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function sanitizeCollectionOptions(options: Record<string, unknown> | undefined) {
  if (!options) return undefined;

  const allowedKeys = new Set([
    "capped",
    "size",
    "max",
    "validator",
    "validationLevel",
    "validationAction",
    "collation",
    "timeseries",
    "expireAfterSeconds",
    "clusteredIndex",
    "changeStreamPreAndPostImages",
  ]);

  const sanitized = Object.fromEntries(
    Object.entries(options).filter(([key, value]) => allowedKeys.has(key) && typeof value !== "undefined")
  );

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeIndexSpecification(index: Record<string, unknown>) {
  const { key, name, ...rest } = index;

  if (!key || typeof key !== "object" || typeof name !== "string") {
    return null;
  }

  delete rest.ns;
  delete rest.v;
  delete rest.background;

  return {
    key,
    name,
    ...rest,
  };
}

async function createRestoreTempCollection(
  db: ReturnType<typeof requireMongoDb>,
  sourceCollectionName: string,
  tempCollectionName: string
) {
  const sourceMetadata = await getCollectionMetadata(db, sourceCollectionName);
  await dropCollectionIfExists(db, tempCollectionName);

  const createOptions = sanitizeCollectionOptions(
    sourceMetadata?.options as Record<string, unknown> | undefined
  );
  if (createOptions) {
    await db.createCollection(tempCollectionName, createOptions);
  } else {
    await db.createCollection(tempCollectionName);
  }

  if (!sourceMetadata) {
    return false;
  }

  const indexes = await db.collection(sourceCollectionName).indexes();
  const indexSpecifications = indexes
    .filter((index) => index.name !== "_id_")
    .map((index) => sanitizeIndexSpecification(index as Record<string, unknown>))
    .filter((index): index is NonNullable<typeof index> => Boolean(index));

  if (indexSpecifications.length > 0) {
    await db.collection(tempCollectionName).createIndexes(indexSpecifications);
  }

  return true;
}

function resolveBundlePath(bundleDirPath: string, relativePath: string) {
  const absolutePath = path.resolve(bundleDirPath, relativePath);
  if (!isPathWithinRoot(bundleDirPath, absolutePath)) {
    throw new Error("Archivio backup non valido: contiene percorsi non consentiti.");
  }
  return absolutePath;
}

async function restoreCollectionFile(collectionName: string, filePath: string) {
  const content = await readFile(filePath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return 0;
  }

  const documents = lines.map((line) => EJSON.parse(line, { relaxed: false }) as Record<string, unknown>);
  await requireMongoDb().collection(collectionName).insertMany(documents, { ordered: true });
  return documents.length;
}

function buildRestoreCollectionNames(collectionName: string, restoreToken: string) {
  return {
    tempCollectionName: `${collectionName}__restore_tmp_${restoreToken}`,
    backupCollectionName: `${collectionName}__restore_backup_${restoreToken}`,
  };
}

async function stageRestoreCollection(
  db: ReturnType<typeof requireMongoDb>,
  collectionName: string,
  filePath: string,
  restoreToken: string
): Promise<StagedRestoreCollection> {
  const { tempCollectionName, backupCollectionName } = buildRestoreCollectionNames(
    collectionName,
    restoreToken
  );
  const liveCollectionExists = await createRestoreTempCollection(db, collectionName, tempCollectionName);

  try {
    const documentCount = await restoreCollectionFile(tempCollectionName, filePath);
    return {
      collectionName,
      tempCollectionName,
      backupCollectionName,
      liveCollectionExists,
      documentCount,
    };
  } catch (error) {
    await dropCollectionIfExists(db, tempCollectionName);
    throw error;
  }
}

async function rollbackActivatedCollections(
  db: ReturnType<typeof requireMongoDb>,
  collections: StagedRestoreCollection[]
) {
  for (const entry of [...collections].reverse()) {
    await dropCollectionIfExists(db, entry.collectionName);
    if (entry.liveCollectionExists && (await collectionExists(db, entry.backupCollectionName))) {
      await db.collection(entry.backupCollectionName).rename(entry.collectionName);
    }
  }
}

async function activateStagedCollections(
  db: ReturnType<typeof requireMongoDb>,
  collections: StagedRestoreCollection[]
) {
  const activatedCollections: StagedRestoreCollection[] = [];

  for (const entry of collections) {
    let liveMovedToBackup = false;

    try {
      await dropCollectionIfExists(db, entry.backupCollectionName);
      if (entry.liveCollectionExists) {
        await db.collection(entry.collectionName).rename(entry.backupCollectionName);
        liveMovedToBackup = true;
      }

      await db.collection(entry.tempCollectionName).rename(entry.collectionName);
      activatedCollections.push(entry);
    } catch (error) {
      if (liveMovedToBackup) {
        await dropCollectionIfExists(db, entry.collectionName);
        if (await collectionExists(db, entry.backupCollectionName)) {
          await db.collection(entry.backupCollectionName).rename(entry.collectionName);
        }
      }

      await rollbackActivatedCollections(db, activatedCollections);
      throw error;
    }
  }
}

async function cleanupRestoreCollectionArtifacts(
  db: ReturnType<typeof requireMongoDb>,
  collections: StagedRestoreCollection[]
) {
  for (const entry of collections) {
    await dropCollectionIfExists(db, entry.tempCollectionName);
    await dropCollectionIfExists(db, entry.backupCollectionName);
  }
}

async function stageUploadsRestore(
  uploadsSourceDir: string | null,
  restoreToken: string
): Promise<StagedUploadsRestore> {
  const uploadsRootDir = path.join(process.cwd(), "public");
  const liveDirPath = path.join(uploadsRootDir, "uploads");
  const stagedDirPath = path.join(uploadsRootDir, `.uploads-restore-stage-${restoreToken}`);
  const backupDirPath = path.join(uploadsRootDir, `.uploads-restore-backup-${restoreToken}`);

  await mkdir(uploadsRootDir, { recursive: true });
  await rm(stagedDirPath, { recursive: true, force: true });
  await rm(backupDirPath, { recursive: true, force: true });

  if (uploadsSourceDir && (await pathExists(uploadsSourceDir))) {
    await cp(uploadsSourceDir, stagedDirPath, { recursive: true });
  } else {
    await mkdir(stagedDirPath, { recursive: true });
  }

  return {
    liveDirPath,
    stagedDirPath,
    backupDirPath,
  };
}

async function activateStagedUploads(uploads: StagedUploadsRestore) {
  const liveUploadsExist = await pathExists(uploads.liveDirPath);
  let liveMovedToBackup = false;

  try {
    if (liveUploadsExist) {
      await rename(uploads.liveDirPath, uploads.backupDirPath);
      liveMovedToBackup = true;
    }

    await rename(uploads.stagedDirPath, uploads.liveDirPath);
  } catch (error) {
    await rm(uploads.liveDirPath, { recursive: true, force: true });

    if (liveMovedToBackup && (await pathExists(uploads.backupDirPath))) {
      await rename(uploads.backupDirPath, uploads.liveDirPath);
    }

    throw error;
  }
}

async function cleanupStagedUploads(uploads: StagedUploadsRestore) {
  await rm(uploads.stagedDirPath, { recursive: true, force: true });
  await rm(uploads.backupDirPath, { recursive: true, force: true });
}

export async function restoreRuntimeBackupBundle(
  bundleFilePath: string
): Promise<RestoreRuntimeBackupResult> {
  const runtimeState = getRuntimeBackupGlobalState();
  if (runtimeState.activeBackupPromise) {
    throw new Error("Attendi il completamento del backup in corso prima di eseguire un ripristino.");
  }
  if (runtimeState.restoreInProgress) {
    throw new Error("Un ripristino è già in corso.");
  }

  runtimeState.restoreInProgress = true;
  const extractRoot = await mkdtemp(path.join(tmpdir(), "fantafestando-admin-restore-"));
  const restoreToken = `${formatBackupTimestamp(new Date())}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await extractTarArchive(bundleFilePath, extractRoot);
    const entries = await readdir(extractRoot, { withFileTypes: true });
    const bundleDirEntry = entries.find((entry) => entry.isDirectory());
    if (!bundleDirEntry) {
      throw new Error("Archivio backup non valido: cartella bundle mancante.");
    }

    const bundleDirPath = path.join(extractRoot, bundleDirEntry.name);
    const manifestPath = path.join(bundleDirPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RuntimeBackupManifest;
    if (manifest.format !== ADMIN_BACKUP_FORMAT) {
      throw new Error(`Formato backup non supportato: ${manifest.format}`);
    }

    const collectionMap = toCollectionMap();
    const validatedCollections: Array<{ collectionName: string; filePath: string }> = [];
    for (const entry of manifest.collections) {
      if (!collectionMap.has(entry.collectionName)) {
        throw new Error(`Collection non supportata nel backup: ${entry.collectionName}`);
      }

      const filePath = resolveBundlePath(bundleDirPath, entry.fileName);
      if (!(await pathExists(filePath))) {
        throw new Error(`Archivio backup non valido: file collection mancante (${entry.fileName}).`);
      }

      validatedCollections.push({
        collectionName: entry.collectionName,
        filePath,
      });
    }
    const uploadsSourceDir = resolveBundlePath(bundleDirPath, manifest.uploads.directoryName);
    if (manifest.uploads.included && !(await pathExists(uploadsSourceDir))) {
      throw new Error("Archivio backup non valido: directory uploads mancante.");
    }

    await dbConnect();
    const db = requireMongoDb();
    const stagedCollections: StagedRestoreCollection[] = [];
    let stagedUploads: StagedUploadsRestore | null = null;

    let restoredCollections = 0;
    let restoredDocuments = 0;

    try {
      for (const entry of validatedCollections) {
        const stagedCollection = await stageRestoreCollection(
          db,
          entry.collectionName,
          entry.filePath,
          restoreToken
        );

        stagedCollections.push(stagedCollection);
        restoredCollections += 1;
        restoredDocuments += stagedCollection.documentCount;
      }

      stagedUploads = await stageUploadsRestore(
        manifest.uploads.included && (await pathExists(uploadsSourceDir)) ? uploadsSourceDir : null,
        restoreToken
      );

      let collectionsActivated = false;
      try {
        await activateStagedCollections(db, stagedCollections);
        collectionsActivated = true;
        await activateStagedUploads(stagedUploads);
      } catch (error) {
        if (collectionsActivated) {
          await rollbackActivatedCollections(db, stagedCollections);
        }
        throw error;
      }
    } finally {
      await cleanupRestoreCollectionArtifacts(db, stagedCollections);
      if (stagedUploads) {
        await cleanupStagedUploads(stagedUploads);
      }
    }

    await updateRestoreStatus("SUCCESS", `Ripristino completato da ${path.basename(bundleFilePath)}`);

    return {
      manifest,
      restoredCollections,
      restoredDocuments,
      restoredUploads: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore sconosciuto durante il ripristino.";
    try {
      await dbConnect();
      await updateRestoreStatus("ERROR", message);
    } catch {
      // Ignore secondary persistence failures on restore metadata.
    }
    throw error;
  } finally {
    runtimeState.restoreInProgress = false;
    await rm(extractRoot, { recursive: true, force: true });
  }
}

export async function getBackupAdminPageData(): Promise<BackupAdminPageData> {
  const [settings, targets] = await Promise.all([getBackupSettingsView(), listBackupTargetOptions()]);

  return {
    settings,
    targets,
    targetsRoot: getBackupTargetsRoot(),
    downloadUrl: "/api/admin/backups/download",
    restoreUrl: "/api/admin/backups/restore",
  };
}
