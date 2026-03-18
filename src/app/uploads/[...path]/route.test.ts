import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const testFiles: string[] = [];

afterEach(async () => {
    await Promise.all(testFiles.splice(0).map(async (filePath) => {
        await fs.unlink(filePath).catch(() => undefined);
    }));
});

describe("uploads catch-all route", () => {
    it("serves receipt header uploads", async () => {
        const filename = `route-${Date.now()}.png`;
        const absolutePath = path.join(process.cwd(), "public", "uploads", "receipt-headers", filename);
        const pngBuffer = await sharp({
            create: {
                width: 20,
                height: 8,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        }).png().toBuffer();

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, pngBuffer);
        testFiles.push(absolutePath);

        const response = await GET(new Request("http://localhost/uploads/receipt-headers"), {
            params: Promise.resolve({ path: ["receipt-headers", filename] })
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/png");
    });
});
