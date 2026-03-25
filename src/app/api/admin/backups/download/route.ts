import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz";
import { generateRuntimeBackupDownload } from "@/lib/runtime-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sessionCheck = await ensureAdminSession();
  if (!sessionCheck.ok) {
    return adminUnauthorizedJson(sessionCheck);
  }

  let generatedBundle: Awaited<ReturnType<typeof generateRuntimeBackupDownload>> | null = null;
  try {
    generatedBundle = await generateRuntimeBackupDownload();

    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp || !generatedBundle) return;
      cleanedUp = true;
      await generatedBundle.cleanup().catch((error) => {
        console.error("Admin Runtime Backup Download Cleanup Error:", error);
      });
    };

    const nodeStream = createReadStream(generatedBundle.filePath);
    nodeStream.once("close", () => {
      void cleanup();
    });
    nodeStream.once("error", () => {
      void cleanup();
    });

    return new NextResponse(Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${generatedBundle.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Admin Runtime Backup Download Error:", error);
    if (generatedBundle) {
      await generatedBundle.cleanup().catch(() => undefined);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore durante la generazione del backup" },
      { status: 500 }
    );
  }
}
