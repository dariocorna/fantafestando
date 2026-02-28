import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads", "menu-headers");
const SAFE_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function resolveContentType(fileName: string): string {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".png")) return "image/png";
    if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
    return "application/octet-stream";
}

export async function GET(
    _request: Request,
    context: { params: Promise<{ filename: string }> }
) {
    const { filename } = await context.params;
    if (!SAFE_FILENAME.test(filename)) {
        return new Response("Invalid file name", { status: 400 });
    }

    const filePath = path.join(UPLOADS_DIR, filename);
    if (!filePath.startsWith(UPLOADS_DIR)) {
        return new Response("Invalid path", { status: 400 });
    }

    try {
        const fileBuffer = await readFile(filePath);
        return new Response(fileBuffer, {
            status: 200,
            headers: {
                "Content-Type": resolveContentType(filename),
                "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
            },
        });
    } catch {
        return new Response("Not found", { status: 404 });
    }
}
