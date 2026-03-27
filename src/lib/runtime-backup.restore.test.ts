import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const execFileAsync = promisify(execFile);

type FakeCollectionState = {
  docs: Array<Record<string, unknown>>;
  indexes: Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
};

class FakeDb {
  private collections = new Map<string, FakeCollectionState>();
  readonly operations: Array<Record<string, string>> = [];
  shouldFailRename: ((from: string, to: string) => boolean) | null = null;

  constructor(
    initialCollections: Record<
      string,
      {
        docs?: Array<Record<string, unknown>>;
        indexes?: Array<Record<string, unknown>>;
        options?: Record<string, unknown>;
      }
    >
  ) {
    for (const [name, state] of Object.entries(initialCollections)) {
      this.collections.set(name, {
        docs: structuredClone(state.docs ?? []),
        indexes: structuredClone(state.indexes ?? [{ name: "_id_", key: { _id: 1 } }]),
        options: state.options ? structuredClone(state.options) : undefined,
      });
    }
  }

  listCollections(filter?: { name?: string }) {
    const entries = [...this.collections.entries()]
      .filter(([name]) => !filter?.name || filter.name === name)
      .map(([name, state]) => ({
        name,
        options: state.options ? structuredClone(state.options) : undefined,
      }));

    return {
      toArray: async () => entries,
    };
  }

  async createCollection(name: string, options?: Record<string, unknown>) {
    if (this.collections.has(name)) {
      throw new Error(`Collection already exists: ${name}`);
    }

    this.collections.set(name, {
      docs: [],
      indexes: [{ name: "_id_", key: { _id: 1 } }],
      options: options ? structuredClone(options) : undefined,
    });
  }

  collection(name: string) {
    const getExistingState = () => {
      const state = this.collections.get(name);
      if (!state) {
        const error = new Error(`ns not found: ${name}`) as Error & { code?: number };
        error.code = 26;
        throw error;
      }
      return state;
    };

    const ensureState = () => {
      const existing = this.collections.get(name);
      if (existing) {
        return existing;
      }

      const created: FakeCollectionState = {
        docs: [],
        indexes: [{ name: "_id_", key: { _id: 1 } }],
      };
      this.collections.set(name, created);
      return created;
    };

    return {
      insertMany: async (docs: Array<Record<string, unknown>>) => {
        this.operations.push({ type: "insertMany", collection: name });
        const state = ensureState();
        state.docs.push(...structuredClone(docs));
      },
      indexes: async () => structuredClone(getExistingState().indexes),
      createIndexes: async (indexes: Array<Record<string, unknown>>) => {
        const state = ensureState();
        state.indexes.push(...structuredClone(indexes));
      },
      rename: async (newName: string) => {
        this.operations.push({ type: "rename", from: name, to: newName });
        if (this.shouldFailRename?.(name, newName)) {
          throw new Error(`rename failed: ${name} -> ${newName}`);
        }

        const state = getExistingState();
        if (this.collections.has(newName)) {
          throw new Error(`Collection already exists: ${newName}`);
        }

        this.collections.delete(name);
        this.collections.set(newName, state);
      },
      drop: async () => {
        this.operations.push({ type: "drop", collection: name });
        if (!this.collections.has(name)) {
          const error = new Error(`ns not found: ${name}`) as Error & { code?: number };
          error.code = 26;
          throw error;
        }

        this.collections.delete(name);
      },
      deleteMany: async () => {
        this.operations.push({ type: "deleteMany", collection: name });
        getExistingState().docs = [];
      },
    };
  }

  getDocs(name: string) {
    return structuredClone(this.collections.get(name)?.docs ?? []);
  }

  getCollectionNames() {
    return [...this.collections.keys()].sort();
  }
}

const {
  dbConnectMock,
  findOneAndUpdateMock,
  fakeMongoose,
  modelMocks,
} = vi.hoisted(() => {
  const makeModel = (collectionName: string) => ({
    collection: { collectionName },
  });

  return {
    dbConnectMock: vi.fn(),
    findOneAndUpdateMock: vi.fn(),
    fakeMongoose: {
      connection: {
        db: null as FakeDb | null,
      },
    },
    modelMocks: {
      systemSettings: {
        collection: { collectionName: "systemsettings" },
        findOneAndUpdate: vi.fn(),
      },
      user: makeModel("users"),
      event: makeModel("events"),
      category: makeModel("categories"),
      ingredient: makeModel("ingredients"),
      product: makeModel("products"),
      printer: makeModel("printers"),
      peripheral: makeModel("peripherals"),
      posDevice: makeModel("posdevices"),
      cashSession: makeModel("cashsessions"),
      orderCounter: makeModel("ordercounters"),
      order: makeModel("orders"),
      printJob: makeModel("printjobs"),
    },
  };
});

modelMocks.systemSettings.findOneAndUpdate = findOneAndUpdateMock;

vi.mock("mongoose", () => ({
  default: fakeMongoose,
}));

vi.mock("@/lib/mongoose", () => ({
  default: dbConnectMock,
}));

vi.mock("@/lib/app-version", () => ({
  getAppVersion: () => "test-version",
  getAppVersionLabel: () => "test-release",
}));

vi.mock("@/models/SystemSettings", () => ({
  default: modelMocks.systemSettings,
}));

vi.mock("@/models/User", () => ({ default: modelMocks.user }));
vi.mock("@/models/Event", () => ({ default: modelMocks.event }));
vi.mock("@/models/Category", () => ({ default: modelMocks.category }));
vi.mock("@/models/Ingredient", () => ({ default: modelMocks.ingredient }));
vi.mock("@/models/Product", () => ({ default: modelMocks.product }));
vi.mock("@/models/Printer", () => ({ default: modelMocks.printer }));
vi.mock("@/models/Peripheral", () => ({ default: modelMocks.peripheral }));
vi.mock("@/models/PosDevice", () => ({ default: modelMocks.posDevice }));
vi.mock("@/models/CashSession", () => ({ default: modelMocks.cashSession }));
vi.mock("@/models/OrderCounter", () => ({ default: modelMocks.orderCounter }));
vi.mock("@/models/Order", () => ({ default: modelMocks.order }));
vi.mock("@/models/PrintJob", () => ({ default: modelMocks.printJob }));

const createdTempDirs: string[] = [];

function resetRuntimeBackupGlobalState() {
  delete (globalThis as typeof globalThis & { __fantafestandoRuntimeBackupState?: unknown })
    .__fantafestandoRuntimeBackupState;
}

async function createRestoreBundle(files: Record<string, string>) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "runtime-backup-restore-test-"));
  createdTempDirs.push(rootDir);

  const bundleDirName = "restore-bundle";
  const bundleDirPath = path.join(rootDir, bundleDirName);
  await mkdir(bundleDirPath, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(bundleDirPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  const archivePath = path.join(rootDir, `${bundleDirName}.tar.gz`);
  await execFileAsync("tar", ["-czf", archivePath, "-C", rootDir, bundleDirName]);
  return archivePath;
}

function buildManifest(collections: Array<{ collectionName: string; fileName: string }>) {
  return JSON.stringify(
    {
      format: "admin-runtime-backup-v1",
      createdAt: "2026-03-25T12:00:00.000Z",
      source: "admin",
      appVersion: "test-version",
      appRelease: "test-release",
      bundleName: "restore-bundle.tar.gz",
      collections: collections.map((entry) => ({
        ...entry,
        documentCount: 1,
      })),
      uploads: {
        included: false,
        directoryName: "uploads",
        fileCount: 0,
      },
    },
    null,
    2
  );
}

describe("runtime backup restore safeguards", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetRuntimeBackupGlobalState();
    dbConnectMock.mockResolvedValue(undefined);
    findOneAndUpdateMock.mockResolvedValue(undefined);
    fakeMongoose.connection.db = null;
  });

  afterEach(async () => {
    resetRuntimeBackupGlobalState();
    fakeMongoose.connection.db = null;

    while (createdTempDirs.length > 0) {
      const dir = createdTempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  test("observes download failures without emitting unhandled rejections", async () => {
    dbConnectMock.mockRejectedValueOnce(new Error("db down"));
    const runtimeBackup = await import("./runtime-backup");

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      await expect(runtimeBackup.generateRuntimeBackupDownload()).rejects.toThrow("db down");
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toHaveLength(0);
  });

  test("keeps live collections untouched when a later collection file is invalid", async () => {
    const fakeDb = new FakeDb({
      users: {
        docs: [{ _id: "live-user", username: "live-admin" }],
        indexes: [{ name: "_id_", key: { _id: 1 } }, { name: "username_1", key: { username: 1 }, unique: true }],
      },
      events: {
        docs: [{ _id: "live-event", name: "Sagra live" }],
      },
    });
    fakeMongoose.connection.db = fakeDb;

    const bundlePath = await createRestoreBundle({
      "manifest.json": buildManifest([
        { collectionName: "users", fileName: "mongo/users.jsonl" },
        { collectionName: "events", fileName: "mongo/events.jsonl" },
      ]),
      "mongo/users.jsonl": '{"_id":"backup-user","username":"backup-admin"}\n',
      "mongo/events.jsonl": '{"_id":"backup-event","name":"Festa backup"}\n{invalid-json}\n',
    });

    const runtimeBackup = await import("./runtime-backup");

    await expect(runtimeBackup.restoreRuntimeBackupBundle(bundlePath)).rejects.toThrow();

    expect(fakeDb.getDocs("users")).toEqual([{ _id: "live-user", username: "live-admin" }]);
    expect(fakeDb.getDocs("events")).toEqual([{ _id: "live-event", name: "Sagra live" }]);
    expect(
      fakeDb.operations.some(
        (operation) =>
          operation.type === "rename" && (operation.from === "users" || operation.from === "events")
      )
    ).toBe(false);
  });

  test("rolls back already swapped collections when activation fails mid-restore", async () => {
    const fakeDb = new FakeDb({
      users: {
        docs: [{ _id: "live-user", username: "live-admin" }],
        indexes: [{ name: "_id_", key: { _id: 1 } }, { name: "username_1", key: { username: 1 }, unique: true }],
      },
      events: {
        docs: [{ _id: "live-event", name: "Sagra live" }],
      },
    });
    fakeDb.shouldFailRename = (from, to) => from.includes("__restore_tmp_") && to === "events";
    fakeMongoose.connection.db = fakeDb;

    const bundlePath = await createRestoreBundle({
      "manifest.json": buildManifest([
        { collectionName: "users", fileName: "mongo/users.jsonl" },
        { collectionName: "events", fileName: "mongo/events.jsonl" },
      ]),
      "mongo/users.jsonl": '{"_id":"backup-user","username":"backup-admin"}\n',
      "mongo/events.jsonl": '{"_id":"backup-event","name":"Festa backup"}\n',
    });

    const runtimeBackup = await import("./runtime-backup");

    await expect(runtimeBackup.restoreRuntimeBackupBundle(bundlePath)).rejects.toThrow(
      "rename failed"
    );

    expect(fakeDb.getDocs("users")).toEqual([{ _id: "live-user", username: "live-admin" }]);
    expect(fakeDb.getDocs("events")).toEqual([{ _id: "live-event", name: "Sagra live" }]);
    expect(fakeDb.getCollectionNames().some((name) => name.includes("__restore_"))).toBe(false);
  });
});
