import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz";
import { buildEventTransferBundle } from "@/lib/event-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const sessionCheck = await ensureAdminSession();
  if (!sessionCheck.ok) {
    return adminUnauthorizedJson(sessionCheck);
  }

  const { eventId } = await params;
  if (!eventId) {
    return NextResponse.json({ error: "ID festa mancante." }, { status: 400 });
  }

  let generatedBundle: Awaited<ReturnType<typeof buildEventTransferBundle>> | null = null;
  try {
    generatedBundle = await buildEventTransferBundle(eventId);

    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp || !generatedBundle) return;
      cleanedUp = true;
      await generatedBundle.cleanup().catch((error) => {
        console.error("Admin Event Export Cleanup Error:", error);
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
    console.error("Admin Event Export Error:", error);
    if (generatedBundle) {
      await generatedBundle.cleanup().catch(() => undefined);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore durante l'esportazione della festa." },
      { status: 500 }
    );
  }
}
