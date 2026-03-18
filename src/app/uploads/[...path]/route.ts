import { readFile } from "node:fs/promises";
import path from "node:path";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ALLOWED_TOP_LEVEL_DIRS = new Set(["menu-headers", "receipt-headers", "easter-eggs"]);

function resolveContentType(fileName: string): string {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".png")) return "image/png";
    if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
    return "application/octet-stream";
}

function resolveUploadsFilePath(segments: string[]): string | undefined {
    if (segments.length !== 2) return undefined;
    const [topLevelDir, fileName] = segments;
    if (!ALLOWED_TOP_LEVEL_DIRS.has(topLevelDir)) return undefined;
    if (!SAFE_SEGMENT.test(topLevelDir) || !SAFE_SEGMENT.test(fileName)) return undefined;

    const filePath = path.join(UPLOADS_ROOT, topLevelDir, fileName);
    if (!filePath.startsWith(UPLOADS_ROOT)) return undefined;
    return filePath;
}

export async function GET(
    _request: Request,
    context: { params: Promise<{ path: string[] }> }
) {
    const { path: segments } = await context.params;
    const filePath = resolveUploadsFilePath(segments);
    if (!filePath) {
        return new Response("Invalid path", { status: 400 });
    }

    const fileName = segments[segments.length - 1];
    try {
        const fileBuffer = await readFile(filePath);
        return new Response(fileBuffer, {
            status: 200,
            headers: {
                "Content-Type": resolveContentType(fileName),
                "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
            },
        });
    } catch {
        return new Response("Not found", { status: 404 });
    }
}
