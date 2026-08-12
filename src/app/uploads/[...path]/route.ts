import { readFile } from "node:fs/promises";
import {
    resolveManagedUploadContentType,
    resolveManagedUploadSegments
} from "@/lib/managed-upload";

export async function GET(
    _request: Request,
    context: { params: Promise<{ path: string[] }> }
) {
    const { path: segments } = await context.params;
    const upload = resolveManagedUploadSegments(segments);
    if (!upload) {
        return new Response("Invalid path", { status: 400 });
    }

    try {
        const fileBuffer = await readFile(upload.filePath);
        return new Response(fileBuffer, {
            status: 200,
            headers: {
                "Content-Type": resolveManagedUploadContentType(upload.fileName),
                "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
            },
        });
    } catch {
        return new Response("Not found", { status: 404 });
    }
}
