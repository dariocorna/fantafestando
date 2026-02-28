import { describe, expect, it } from "vitest";
import { renderEscPosRawToPng } from "./escpos-preview";

/* ─── helper re-exports are private, test them through the public API ─── */

describe("escpos-preview", () => {
    /* ───────────────────── renderEscPosRawToPng ───────────────────── */

    it("returns a valid PNG buffer from a plain-text ESC/POS stream", async () => {
        // ESC @ (init) + "Hello World" + LF
        const raw = Buffer.from([
            0x1b, 0x40,                                                    // ESC @  reset
            ...Buffer.from("Hello World"),                                 // text
            0x0a                                                           // LF
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
        expect(png.length).toBeGreaterThan(0);
        // PNG magic number: 0x89 P N G
        expect(png[0]).toBe(0x89);
        expect(png[1]).toBe(0x50);
        expect(png[2]).toBe(0x4e);
        expect(png[3]).toBe(0x47);
    });

    it("handles alignment commands (ESC a n)", async () => {
        const raw = Buffer.from([
            0x1b, 0x61, 0x01,          // ESC a 1  — center
            ...Buffer.from("Centered"),
            0x0a,
            0x1b, 0x61, 0x02,          // ESC a 2  — right
            ...Buffer.from("Right"),
            0x0a,
            0x1b, 0x61, 0x00,          // ESC a 0  — left
            ...Buffer.from("Left"),
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
        expect(png.length).toBeGreaterThan(0);
    });

    it("handles bold toggle (ESC E n)", async () => {
        const raw = Buffer.from([
            0x1b, 0x45, 0x01,          // ESC E 1  — bold on
            ...Buffer.from("Bold Text"),
            0x0a,
            0x1b, 0x45, 0x00,          // ESC E 0  — bold off
            ...Buffer.from("Normal Text"),
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("handles double-height / double-width (ESC ! n)", async () => {
        const raw = Buffer.from([
            0x1b, 0x21, 0x30,          // ESC ! 0x30  → double-width + double-height
            ...Buffer.from("Big"),
            0x0a,
            0x1b, 0x21, 0x00,          // ESC ! 0x00  → normal
            ...Buffer.from("Small"),
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("handles GS ! n (character size select)", async () => {
        const raw = Buffer.from([
            0x1d, 0x21, 0x11,          // GS ! 0x11  → width x2, height x2
            ...Buffer.from("2x2"),
            0x0a,
            0x1d, 0x21, 0x00,          // GS ! 0x00  → normal
            ...Buffer.from("1x1"),
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("handles ESC d n (feed n lines)", async () => {
        const raw = Buffer.from([
            ...Buffer.from("Line 1"),
            0x0a,
            0x1b, 0x64, 0x03,          // ESC d 3  — feed 3 blank lines
            ...Buffer.from("After feed"),
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("produces output from an empty buffer", async () => {
        const png = await renderEscPosRawToPng(Buffer.alloc(0));
        expect(Buffer.isBuffer(png)).toBe(true);
        // Should still produce a minimal blank PNG
        expect(png[0]).toBe(0x89);
    });

    it("skips FS and GS V (cut) commands without crashing", async () => {
        const raw = Buffer.from([
            0x1c, 0x2e,                // FS .
            0x1c, 0x26,                // FS &
            0x1c, 0x74, 0x01,          // FS t 1
            ...Buffer.from("After FS"),
            0x0a,
            0x1d, 0x56, 0x01,          // GS V cut
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("strips control characters from text via normalizePreviewText", async () => {
        // Embed some control chars (0x01, 0x02) inside text
        const raw = Buffer.from([
            0x48, 0x01, 0x65, 0x02, 0x6c, 0x6c, 0x6f,    // "H\x01e\x02llo"
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("handles ESC @ reset mid-stream", async () => {
        const raw = Buffer.from([
            0x1b, 0x45, 0x01,          // ESC E 1  — bold on
            0x1b, 0x61, 0x01,          // ESC a 1  — center
            ...Buffer.from("Bold+Center"),
            0x0a,
            0x1b, 0x40,                // ESC @ reset  — should reset to left, normal
            ...Buffer.from("Reset"),
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("handles extended Latin-1 characters", async () => {
        // "Caffè" in Latin-1: 0x43 0x61 0x66 0x66 0xe8
        const raw = Buffer.from([
            0x43, 0x61, 0x66, 0x66, 0xe8,
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("handles multiple consecutive LFs (empty lines)", async () => {
        const raw = Buffer.from([
            ...Buffer.from("Line 1"),
            0x0a, 0x0a, 0x0a,          // three empty lines
            ...Buffer.from("Line 5"),
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });

    it("gracefully handles ESC M and ESC t charset commands", async () => {
        const raw = Buffer.from([
            0x1b, 0x4d, 0x01,          // ESC M 1 (font)
            0x1b, 0x74, 0x10,          // ESC t 16 (charset)
            0x1b, 0x52, 0x00,          // ESC R 0 (country)
            ...Buffer.from("Text after charset"),
            0x0a
        ]);

        const png = await renderEscPosRawToPng(raw);
        expect(Buffer.isBuffer(png)).toBe(true);
    });
});
