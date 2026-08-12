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
import { importEventTransferBundle } from "@/lib/event-transfer";

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
    const newEventName = (formData.get("newEventName") as string | null)?.trim() || "";
    if (!newEventName) {
      return NextResponse.json(
        { ok: false, error: "Nome nuova festa obbligatorio." },
        { status: 400 }
      );
    }

    const bundleFile = formData.get("bundleFile");
    if (!isUploadLike(bundleFile) || bundleFile.size <= 0) {
      return NextResponse.json(
        { ok: false, error: "Seleziona un file export festa valido." },
        { status: 400 }
      );
    }
    if (bundleFile.size > MAX_BUNDLE_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: "File export troppo grande." },
        { status: 413 }
      );
    }

    tempDir = await mkdtemp(path.join(/* turbopackIgnore: true */ tmpdir(), "fantafestando-event-transfer-upload-"));
    const safeName = path.basename(bundleFile.name || "event-transfer.tar.gz").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const tempFilePath = path.join(/* turbopackIgnore: true */ tempDir, safeName || "event-transfer.tar.gz");

    await pipeline(
      Readable.fromWeb(bundleFile.stream() as unknown as NodeReadableStream),
      createWriteStream(/* turbopackIgnore: true */ tempFilePath)
    );

    const result = await importEventTransferBundle(tempFilePath, newEventName);
    revalidatePath("/admin", "layout");
    revalidatePath("/admin/settings");
    revalidatePath("/admin/settings/events");

    return NextResponse.json({
      ok: true,
      message: `Festa importata: ${result.newEventName}.`,
      result,
    });
  } catch (error) {
    console.error("Admin Event Import Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Errore durante l'importazione della festa.",
      },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
