import sharp from "sharp";

type AlignMode = "left" | "center" | "right";

interface TextBlock {
    kind: "text";
    text: string;
    align: AlignMode;
    widthMul: number;
    heightMul: number;
    bold: boolean;
}

interface ImageBlock {
    kind: "image";
    align: AlignMode;
    width: number;
    height: number;
    png: Buffer;
}

type ReceiptBlock = TextBlock | ImageBlock;

function clampMultiplier(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(8, Math.floor(value)));
}

function decodeLatin1(bytes: number[]): string {
    return Buffer.from(bytes).toString("latin1");
}

function normalizePreviewText(value: string): string {
    return value
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trimEnd();
}

function rasterToPng(data: Buffer, widthBytes: number, height: number): Promise<Buffer> {
    const width = widthBytes * 8;
    const raw = Buffer.alloc(width * height * 4, 255);

    for (let y = 0; y < height; y += 1) {
        for (let xb = 0; xb < widthBytes; xb += 1) {
            const byte = data[(y * widthBytes) + xb] || 0;
            for (let bit = 0; bit < 8; bit += 1) {
                const isBlack = (byte & (0x80 >> bit)) !== 0;
                const x = (xb * 8) + bit;
                const idx = ((y * width) + x) * 4;
                const color = isBlack ? 0 : 255;
                raw[idx] = color;
                raw[idx + 1] = color;
                raw[idx + 2] = color;
                raw[idx + 3] = 255;
            }
        }
    }

    return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function renderEscPosRawToPng(raw: Buffer): Promise<Buffer> {
    const blocks: ReceiptBlock[] = [];
    let i = 0;

    let align: AlignMode = "left";
    let widthMul = 1;
    let heightMul = 1;
    let bold = false;
    let lineBytes: number[] = [];

    const flushText = () => {
        if (lineBytes.length === 0) return;
        const normalized = normalizePreviewText(decodeLatin1(lineBytes));
        lineBytes = [];
        if (!normalized) return;
        blocks.push({
            kind: "text",
            text: normalized,
            align,
            widthMul,
            heightMul,
            bold
        });
    };

    while (i < raw.length) {
        const b = raw[i];

        if (b === 0x0a) {
            flushText();
            i += 1;
            continue;
        }

        if (b === 0x1b && i + 1 < raw.length) {
            const fn = raw[i + 1];
            if (fn === 0x61 && i + 2 < raw.length) { // ESC a n
                flushText();
                const n = raw[i + 2];
                align = n === 1 ? "center" : n === 2 ? "right" : "left";
                i += 3;
                continue;
            }
            if (fn === 0x21 && i + 2 < raw.length) { // ESC ! n
                flushText();
                const n = raw[i + 2];
                // Bit 0x10 = double-height, bit 0x20 = double-width
                heightMul = (n & 0x10) !== 0 ? 2 : 1;
                widthMul = (n & 0x20) !== 0 ? 2 : 1;
                bold = (n & 0x08) !== 0;
                i += 3;
                continue;
            }
            if (fn === 0x45 && i + 2 < raw.length) { // ESC E n
                flushText();
                bold = raw[i + 2] > 0;
                i += 3;
                continue;
            }
            if (fn === 0x64 && i + 2 < raw.length) { // ESC d n (feed n lines)
                flushText();
                const n = Math.max(0, raw[i + 2] || 0);
                for (let k = 0; k < n; k += 1) {
                    blocks.push({
                        kind: "text",
                        text: "",
                        align,
                        widthMul,
                        heightMul,
                        bold
                    });
                }
                i += 3;
                continue;
            }
            if ((fn === 0x4d || fn === 0x74 || fn === 0x52 || fn === 0x2d || fn === 0x45 || fn === 0x47) && i + 2 < raw.length) {
                // ESC M/t/R/-/E/G n
                flushText();
                i += 3;
                continue;
            }
            if (fn === 0x40) { // ESC @
                flushText();
                align = "left";
                widthMul = 1;
                heightMul = 1;
                bold = false;
                i += 2;
                continue;
            }
        }

        if (b === 0x1c && i + 1 < raw.length) { // FS commands (charset/cjk etc)
            const fn = raw[i + 1];
            flushText();
            if ((fn === 0x74 || fn === 0x57 || fn === 0x43 || fn === 0x2d || fn === 0x21 || fn === 0x70) && i + 2 < raw.length) {
                i += 3;
                continue;
            }
            if (fn === 0x2e || fn === 0x26) { // FS . / FS &
                i += 2;
                continue;
            }
        }

        if (b === 0x1d && i + 1 < raw.length) {
            const fn = raw[i + 1];
            if (fn === 0x21 && i + 2 < raw.length) { // GS ! n
                flushText();
                const n = raw[i + 2];
                widthMul = clampMultiplier((n & 0x0f) + 1);
                heightMul = clampMultiplier(((n >> 4) & 0x0f) + 1);
                i += 3;
                continue;
            }

            if (fn === 0x76 && i + 7 < raw.length && raw[i + 2] === 0x30) { // GS v 0
                flushText();
                const widthBytes = raw.readUInt16LE(i + 4);
                const height = raw.readUInt16LE(i + 6);
                const dataLength = widthBytes * height;
                const dataStart = i + 8;
                const dataEnd = dataStart + dataLength;
                if (widthBytes > 0 && height > 0 && dataEnd <= raw.length) {
                    const data = raw.subarray(dataStart, dataEnd);
                    const png = await rasterToPng(data, widthBytes, height);
                    blocks.push({
                        kind: "image",
                        align,
                        width: widthBytes * 8,
                        height,
                        png
                    });
                    i = dataEnd;
                    continue;
                }
            }

            if (fn === 0x56) { // GS V cut
                flushText();
                i += 3;
                continue;
            }
        }

        if (b >= 0x20 || b === 0x09) {
            lineBytes.push(b);
        }
        i += 1;
    }
    flushText();

    const receiptWidth = 576;
    const padX = 14;
    const padY = 14;
    const lineGap = 6;
    const baseFont = 20;

    let y = padY;
    const textChunks: string[] = [];
    const composites: sharp.OverlayOptions[] = [];

    for (const block of blocks) {
        if (block.kind === "text") {
            const size = Math.max(12, Math.round(baseFont * block.heightMul));
            const x = block.align === "center"
                ? Math.round(receiptWidth / 2)
                : block.align === "right"
                    ? receiptWidth - padX
                    : padX;
            const anchor = block.align === "center" ? "middle" : block.align === "right" ? "end" : "start";
            textChunks.push(
                `<text x="${x}" y="${y + size}" text-anchor="${anchor}" xml:space="preserve" font-family="Courier New, monospace" font-size="${size}" font-weight="${block.bold ? 700 : 500}" fill="#111827">${escapeXml(block.text)}</text>`
            );
            y += size + lineGap;
            continue;
        }

        const left = block.align === "center"
            ? Math.max(0, Math.round((receiptWidth - block.width) / 2))
            : block.align === "right"
                ? Math.max(0, receiptWidth - block.width - padX)
                : padX;
        composites.push({
            input: block.png,
            left,
            top: y
        });
        y += block.height + lineGap;
    }

    const height = Math.max(220, y + padY);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${receiptWidth}" height="${height}" viewBox="0 0 ${receiptWidth} ${height}"><rect x="0" y="0" width="${receiptWidth}" height="${height}" fill="#ffffff"/>${textChunks.join("")}</svg>`;

    return sharp(Buffer.from(svg))
        .composite(composites)
        .png()
        .toBuffer();
}

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
