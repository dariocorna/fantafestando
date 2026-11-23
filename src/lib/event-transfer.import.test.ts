import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { importEventTransferBundle } from "@/lib/event-transfer";
import Product from "@/models/Product";

vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }));
vi.mock("@/models/Event", () => ({ default: { create: async () => ({ _id: "event" }) } }));
vi.mock("@/models/Category", () => ({ default: { create: async () => ({ _id: "category" }) } }));
vi.mock("@/models/Product", () => ({
  default: { create: vi.fn(async () => ({ _id: "product" })), updateOne: vi.fn() },
}));

test("imports the per-unit print option from v1 bundles and defaults missing flags to false", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "event-transfer-print-test-"));
  try {
    const bundleDir = path.join(tempRoot, "bundle");
    await mkdir(bundleDir);
    const base = { categoryBundleId: "category", basePrice: 3, kind: "STANDARD" };
    const payload = {
      manifest: { format: "event-transfer-bundle-v1" },
      event: { name: "Festa" },
      categories: [{ bundleId: "category", name: "Cucina", uiColor: "#abcdef" }],
      products: [
        { ...base, bundleId: "old", name: "Legacy" },
        { ...base, bundleId: "grouped", name: "Raggruppato", splitKitchenPrintPerUnit: false },
        { ...base, bundleId: "split", name: "Separato", splitKitchenPrintPerUnit: true },
      ],
    };
    await writeFile(path.join(bundleDir, "event-transfer.json"), JSON.stringify(payload));
    const archive = path.join(tempRoot, "v1.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", tempRoot, "bundle"]);

    await importEventTransferBundle(archive, "Festa copiata");

    expect(Product.create).toHaveBeenCalledTimes(3);
    expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Legacy", splitKitchenPrintPerUnit: false }));
    expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Raggruppato", splitKitchenPrintPerUnit: false }));
    expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Separato", splitKitchenPrintPerUnit: true }));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
