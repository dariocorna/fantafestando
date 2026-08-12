import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const testFiles: string[] = [];

afterEach(async () => {
    await Promise.all(testFiles.splice(0).map(async (filePath) => {
        await fs.unlink(filePath).catch(() => undefined);
    }));
});

describe("uploads catch-all route", () => {
    it.each([
        ["menu-headers", "png", "image/png"],
        ["receipt-headers", "jpg", "image/jpeg"],
        ["easter-eggs", "jpeg", "image/jpeg"],
        ["menu-headers", "bin", "application/octet-stream"],
    ])("serves %s uploads with the existing headers", async (directory, extension, contentType) => {
        const filename = `route-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
        const absolutePath = path.join(process.cwd(), "public", "uploads", directory, filename);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, "managed-upload");
        testFiles.push(absolutePath);

        const response = await GET(new Request(`http://localhost/uploads/${directory}/${filename}`), {
            params: Promise.resolve({ path: [directory, filename] })
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe(contentType);
        expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, stale-while-revalidate=86400");
        expect(await response.text()).toBe("managed-upload");
    });

    it("returns 404 for an absent managed upload", async () => {
        const response = await GET(new Request("http://localhost/uploads/menu-headers/missing.png"), {
            params: Promise.resolve({ path: ["menu-headers", "missing.png"] })
        });

        expect(response.status).toBe(404);
    });

    it.each([
        [["other", "header.png"]],
        [["menu-headers", "..", "header.png"]],
        [["menu-headers", "../header.png"]],
        [["menu-headers", "%2e%2e%2fheader.png"]],
    ])("rejects an unmanaged or unsafe path: %j", async (segments) => {
        const response = await GET(new Request("http://localhost/uploads/invalid"), {
            params: Promise.resolve({ path: segments })
        });

        expect(response.status).toBe(400);
    });
});
