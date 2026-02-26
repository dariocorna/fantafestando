#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import net from "node:net";

const startPort = Number(process.env.PRINTER_EMULATOR_START_PORT || "19100");
const slotCount = Number(process.env.PRINTER_EMULATOR_COUNT || "10");
const outputRoot = process.env.PRINTER_EMULATOR_OUTPUT_DIR || "/tmp/osgfest-printer-emulator";

if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65535) {
    console.error(`[printer-emulator] Invalid PRINTER_EMULATOR_START_PORT: ${startPort}`);
    process.exit(1);
}

if (!Number.isInteger(slotCount) || slotCount < 1 || slotCount > 50) {
    console.error(`[printer-emulator] Invalid PRINTER_EMULATOR_COUNT: ${slotCount}`);
    process.exit(1);
}

fs.mkdirSync(outputRoot, { recursive: true });

const servers = [];

function savePrintPayload(slot, port, payload) {
    const slotDir = path.join(outputRoot, `slot-${String(slot).padStart(2, "0")}`);
    fs.mkdirSync(slotDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const id = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const rawPath = path.join(slotDir, `${id}.bin`);
    const metaPath = path.join(slotDir, `${id}.json`);

    fs.writeFileSync(rawPath, payload);
    fs.writeFileSync(metaPath, JSON.stringify({
        id,
        slot,
        port,
        bytes: payload.length,
        createdAt: new Date().toISOString(),
        rawFile: path.basename(rawPath)
    }, null, 2));

    console.log(`[printer-emulator] slot=${slot} port=${port} bytes=${payload.length} file=${rawPath}`);
}

function createServer(slot, port) {
    const server = net.createServer((socket) => {
        const chunks = [];

        socket.on("data", (chunk) => {
            chunks.push(Buffer.from(chunk));
        });

        socket.on("end", () => {
            if (chunks.length === 0) return;
            const payload = Buffer.concat(chunks);
            savePrintPayload(slot, port, payload);
        });

        socket.on("error", (error) => {
            console.error(`[printer-emulator] socket error on port ${port}:`, error.message);
        });
    });

    server.on("error", (error) => {
        console.error(`[printer-emulator] server error on port ${port}:`, error.message);
    });

    server.listen(port, "0.0.0.0", () => {
        console.log(`[printer-emulator] listening slot=${slot} on tcp://0.0.0.0:${port}`);
    });

    return server;
}

for (let index = 0; index < slotCount; index += 1) {
    const slot = index + 1;
    const port = startPort + index;
    servers.push(createServer(slot, port));
}

function shutdown() {
    console.log("[printer-emulator] shutdown requested...");
    servers.forEach((server) => {
        try {
            server.close();
        } catch {
            // ignore close errors during shutdown
        }
    });
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
