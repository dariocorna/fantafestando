import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz";
import { getBackupSettingsView, restoreRuntimeBackupBundle } from "@/lib/runtime-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BUNDLE_UPLOAD_BYTES = Number(process.env.MAX_BUNDLE_UPLOAD_MB || 512) * 1024 * 1024;

type UploadLike = Blob & {
  name?: string;
};

function isUploadLike(value: unknown): value is UploadLike {
  if (!value || typeof value !== "object") return false;
  return (
    "size" in value &&
    typeof value.size === "number" &&
    "stream" in value &&
    typeof value.stream === "function"
  );
}

export async function POST(request: Request) {
  const sessionCheck = await ensureAdminSession();
  if (!sessionCheck.ok) {
    return adminUnauthorizedJson(sessionCheck);
  }

  let tempDir: string | null = null;
  try {
    const formData = await request.formData();
    const confirmation = (formData.get("confirmation") as string | null)?.trim().toUpperCase() || "";
    if (confirmation !== "RIPRISTINA") {
      return NextResponse.json(
        {
          ok: false,
          error: "Conferma digitando RIPRISTINA prima di avviare il restore.",
          settings: await getBackupSettingsView(),
        },
        { status: 400 }
      );
    }

    const bundleFile = formData.get("bundleFile");
    if (!isUploadLike(bundleFile) || bundleFile.size <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Seleziona un file backup valido da ripristinare.",
          settings: await getBackupSettingsView(),
        },
        { status: 400 }
      );
    }
    if (bundleFile.size > MAX_BUNDLE_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: "File backup troppo grande.",
          settings: await getBackupSettingsView(),
        },
        { status: 413 }
      );
    }

    tempDir = await mkdtemp(path.join(tmpdir(), "fantafestando-admin-restore-upload-"));
    const safeName = path.basename(bundleFile.name || "restore-bundle.tar.gz").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const tempFilePath = path.join(tempDir, safeName || "restore-bundle.tar.gz");

    await pipeline(
      Readable.fromWeb(bundleFile.stream() as unknown as NodeReadableStream),
      createWriteStream(tempFilePath)
    );

    const result = await restoreRuntimeBackupBundle(tempFilePath);
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/settings/backups");
    revalidatePath("/menu");

    return NextResponse.json({
      ok: true,
      message: `Ripristino completato: ${result.restoredCollections} collection e ${result.restoredDocuments} documenti ripristinati.`,
      settings: await getBackupSettingsView(),
    });
  } catch (error) {
    console.error("Admin Runtime Backup Restore Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Errore durante il ripristino del backup.",
        settings: await getBackupSettingsView().catch(() => undefined),
      },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
