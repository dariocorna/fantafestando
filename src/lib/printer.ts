import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Binary } from "bson";
import Order from "@/models/Order";
import Product from "@/models/Product";
import Category from "@/models/Category";
import PosDevice from "@/models/PosDevice";
import PrinterModel from "@/models/Printer";
import Event from "@/models/Event";
import PrintJobModel, { type PrintJobSource, type PrintJobType } from "@/models/PrintJob";
import mongoose from "mongoose";
import dbConnect from "./mongoose";
import { getOrderCodeFromOrder } from "./order-code";
import { getPizzaBarcodeValue } from "./pizza-barcode";
import {
    DEFAULT_PRINTER_PORT,
    getPrinterCharacterSet,
    getVirtualPrinterStartPort,
    resolvePrinterDestination,
    toTcpPrinterInterface
} from "./printer-config";
import {
    buildCashSessionPrintDocumentV2,
    buildOrderPrintDocumentV2,
    normalizeLegacyPrintDocument,
    type PrintDocumentV2
} from "./print-report";
import {
    preparePrintableLogoPngBufferFromUrl,
    sanitizePrintableHeaderLogoUrl,
    sanitizeReceiptHeaderLogoUrl
} from "./print-branding";
import {
    preparePrintableEasterEggRasterFromUrl,
    renderThermalRasterToStripePngBuffers
} from "./easter-egg-image";
import { type EasterEggCrop, type EasterEggProcessingSettings } from "./easter-egg-config";
import {
    buildPrintQueueLease,
    claimKitchenPrinterQueueLease,
    refreshKitchenPrinterQueueLease,
    releaseKitchenPrinterQueueLease
} from "./print-queue";
import {
    completeSumUpPrintIntentsForSentJob,
    completeSumUpPrintIntentsIfSent
} from "./sumup-print-routing";

export interface PrinterCommandJob {
    ip: string;
    port?: number;
    emulatorSlot?: number;
    printerId?: string;
    eventId?: string;
    queueRecoverable?: boolean;
    source?: PrintJobSource;
    printType?: PrintJobType;
    idempotencyKey?: string;
    isVirtual?: boolean;
    title: string;
    eventName?: string;
    copyLabel?: string;
    brandingLogoUrl?: string;
    items: Array<{
        name: string;
        quantity: number;
        notes?: string;
        unitPrice?: number;
        lineTotal?: number;
        selectedOptions?: Array<{
            name: string;
            priceVariation: number;
        }>;
    }>;
    totals?: Array<{
        label: string;
        value: string;
        emphasis?: "normal" | "strong";
    }>;
    customerName?: string;
    tableNumber?: string;
    orderId: string;
    shortCode?: string;
    pizzaNumber?: number;
    pizzaBarcodeValue?: string;
    footerLines?: string[];
}

export interface CashSessionClosingPrintSummary {
    sessionId: string;
    isTest?: boolean;
    posDeviceName?: string;
    openedAt?: Date | string;
    closedAt?: Date | string;
    openingFloatAmount: number;
    cashSalesAmount: number;
    cardSalesAmount: number;
    otherSalesAmount: number;
    expectedCashAmount: number;
    closingCountedCashAmount: number;
    varianceAmount: number;
    paidOrdersCount: number;
    openingNotes?: string;
    closingNotes?: string;
    grossSalesAmount?: number;
    discountSalesAmount?: number;
    discountSummaries?: Array<{
        label: string;
        amount: number;
    }>;
    items?: Array<{
        categoryName?: string;
        name: string;
        qty: number;
        lineTotal?: number;
        groupLabel?: string;
        grossAmount?: number;
        discountAmount?: number;
    }>;
}

export interface PrinterRasterImageJob {
    ip: string;
    port?: number;
    emulatorSlot?: number;
    printerId?: string;
    eventId?: string;
    orderId?: string;
    source?: PrintJobSource;
    printType?: PrintJobType;
    idempotencyKey?: string;
    isVirtual?: boolean;
    title: string;
    eventName?: string;
    copyLabel?: string;
    brandingLogoUrl?: string;
    imageUrl?: string;
    crop?: EasterEggCrop;
    processing?: EasterEggProcessingSettings;
    footerLines?: string[];
}

interface CartItem {
    productId: string;
    snapshotName: string;
    quantity: number;
    customKitchenNotes?: string;
    splitPrintPerUnit?: boolean;
    unitBasePrice?: number;
    lineTotal?: number;
    includedComponents?: Array<{
        productId: string;
        snapshotName: string;
        quantity: number;
        source: "FIXED_ITEM" | "CHOICE_OPTION";
        groupId?: string;
        groupName?: string;
    }>;
    selectedOptions?: Array<{
        name: string;
        priceVariation: number;
    }>;
}

interface PrinterDestinationRef {
    id?: string;
    ip?: string;
    port?: number;
    isVirtual?: boolean;
    emulatorSlot?: number;
}

type PrintDispatchAttemptResult =
    | {
        success: true;
        rawCapturePath?: string;
        automaticRetryCount: number;
    }
    | {
        success: false;
        errorMessage: string;
        automaticRetryCount: number;
    };

type PrintDispatchResult = boolean | "RECOVERY_PENDING" | "RETRY_REQUIRED";

type BufferJsonLike = {
    type?: unknown;
    data?: unknown;
};

type BsonBinaryLike = {
    buffer?: unknown;
    sub_type?: unknown;
    position?: unknown;
};

function formatPaymentMethod(value: string | undefined): string {
    if (value === "CASH") return "Contanti";
    if (value === "CARD") return "Carta / POS";
    if (value === "OTHER") return "Altro";
    return "-";
}

function readEnvNumber(name: string, fallback: number): number {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return fallback;

    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readEnvDelayList(name: string, fallback: number[]): number[] {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return fallback;

    const parsed = rawValue
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value >= 0);

    return parsed.length > 0 ? parsed : fallback;
}

const PRINTER_CONNECT_TIMEOUT_MS = readEnvNumber("PRINTER_CONNECT_TIMEOUT_MS", 4000);
const PRINTER_EXECUTE_TIMEOUT_MS = readEnvNumber("PRINTER_EXECUTE_TIMEOUT_MS", 7000);
const PRINTER_CONNECTION_RETRY_DELAY_MS = readEnvNumber("PRINTER_CONNECTION_RETRY_DELAY_MS", 250);
const PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS = readEnvDelayList(
    "PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS",
    [200, 400, 800, 1200, 1600]
);
const PRINTER_SAME_DESTINATION_COOLDOWN_MS = readEnvNumber("PRINTER_SAME_DESTINATION_COOLDOWN_MS", 1000);
const PRINTER_RASTER_AFTER_ORDER_DELAY_MS = readEnvNumber("PRINTER_RASTER_AFTER_ORDER_DELAY_MS", 1500);
const PRINTER_EMULATOR_CAPTURE_LOOKUP_TIMEOUT_MS = readEnvNumber("PRINTER_EMULATOR_CAPTURE_LOOKUP_TIMEOUT_MS", 750);
const PRINTER_LOCAL_CAPTURE_DIR = process.env.PRINTER_LOCAL_CAPTURE_DIR || "/tmp/fantafestando-printer-captures";
const PRINTER_LOCAL_CAPTURE_MAX_FILES = readEnvNumber("PRINTER_LOCAL_CAPTURE_MAX_FILES", 200);
const PRINTER_LOCAL_CAPTURE_MAX_AGE_MS = readEnvNumber(
    "PRINTER_LOCAL_CAPTURE_MAX_AGE_MS",
    1000 * 60 * 60 * 24 * 3
);
const SUMUP_PRINT_CLAIM_LEASE_MS = 5 * 60 * 1000;
const EPSON_BARCODE_EAN8 = 68;
const PIZZA_EAN8_PATTERN = /^\d{8}$/;
const RECEIPT_SEPARATOR = "--------------------------------";
const PRINTER_EMULATOR_OUTPUT_DIR = process.env.PRINTER_EMULATOR_OUTPUT_DIR || "/tmp/fantafestando-printer-emulator";
// Keep the normal flow as a single image send for typical easter-egg photos.
// Only exceptionally tall payloads should spill into multiple stripes.
const RASTER_PNG_STRIPE_HEIGHT = readEnvNumber("RASTER_PNG_STRIPE_HEIGHT", 2048);
function formatEuroReceipt(amount: number | undefined): string {
    const safeAmount = Number.isFinite(amount) ? Number(amount) : 0;
    return `${safeAmount.toFixed(2)} EUR`;
}

function formatAmountNoCurrency(amount: number | undefined): string {
    const safeAmount = Number.isFinite(amount) ? Number(amount) : 0;
    return safeAmount.toFixed(2);
}

function normalizePrintableText(value: string): string {
    return value.normalize("NFC").replace(/\r\n?/g, "\n");
}

function padRight(value: string, width: number): string {
    const normalized = normalizePrintableText(value);
    if (normalized.length >= width) return normalized;
    return `${normalized}${" ".repeat(width - normalized.length)}`;
}

function padLeft(value: string, width: number): string {
    const normalized = normalizePrintableText(value);
    if (normalized.length >= width) return normalized;
    return `${" ".repeat(width - normalized.length)}${normalized}`;
}

function splitByLength(value: string, max: number): string[] {
    const clean = normalizePrintableText(value).trim();
    if (!clean) return [];
    if (clean.length <= max) return [clean];
    const words = clean.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    words.forEach((word) => {
        const next = current ? `${current} ${word}` : word;
        if (next.length <= max) {
            current = next;
            return;
        }
        if (current) lines.push(current);
        current = word;
    });
    if (current) lines.push(current);
    return lines;
}

function asString(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return "";
}

function formatPrintDateTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("it-IT");
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PrinterService {
    private static destinationExecutionChains = new Map<string, Promise<void>>();

    private static isTimeoutError(error: unknown): boolean {
        return error instanceof Error && error.message.toLowerCase().includes("timeout");
    }

    private static isConnectionRefusedError(error: unknown): boolean {
        if (typeof error !== "object" || error === null) return false;

        const maybeCode = "code" in error ? error.code : undefined;
        if (maybeCode === "ECONNREFUSED") return true;

        const maybeMessage = "message" in error && typeof error.message === "string"
            ? error.message.toLowerCase()
            : "";
        return maybeMessage.includes("econnrefused") || maybeMessage.includes("connection refused");
    }

    private static async waitForPrinterReachable(printer: ThermalPrinter, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            const attemptTimeout = Math.max(1, remaining);

            try {
                const isConnected = await this.withTimeout(
                    printer.isPrinterConnected(),
                    attemptTimeout,
                    "Printer connection timeout"
                );
                if (isConnected) return true;
            } catch (error) {
                if (!this.isTimeoutError(error) && !this.isConnectionRefusedError(error)) {
                    throw error;
                }
            }

            const afterAttemptRemaining = deadline - Date.now();
            if (afterAttemptRemaining <= 0) break;
            await wait(Math.min(PRINTER_CONNECTION_RETRY_DELAY_MS, afterAttemptRemaining));
        }

        return false;
    }

    private static async executeWithConnectionRetry(printer: ThermalPrinter, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        let lastError: unknown;

        while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            const attemptTimeout = Math.max(1, remaining);

            try {
                await this.withTimeout(
                    printer.execute(),
                    attemptTimeout,
                    "Printer execution timeout"
                );
                return;
            } catch (error) {
                lastError = error;
                const afterAttemptRemaining = deadline - Date.now();
                if (!this.isConnectionRefusedError(error) || afterAttemptRemaining <= 0) {
                    throw error;
                }
                await wait(Math.min(PRINTER_CONNECTION_RETRY_DELAY_MS, afterAttemptRemaining));
            }
        }

        if (lastError) throw lastError;
        throw new Error("Printer execution timeout");
    }

    private static async dispatchJobsSequentiallyPerDestination(
        entries: Array<{ job: PrinterCommandJob; copies: number }>,
        ensureEventOperationOwned?: () => Promise<boolean>
    ): Promise<PrintDispatchResult[]> {
        const results = new Array<PrintDispatchResult>(entries.length);
        const entriesByDestination = new Map<string, Array<{ entry: { job: PrinterCommandJob; copies: number }; index: number }>>();

        entries.forEach((entry, index) => {
            const hasDestination = typeof entry.job.ip === "string" && entry.job.ip.trim().length > 0;
            const destinationKey = hasDestination
                ? resolvePrinterDestination({
                    ip: entry.job.ip,
                    port: entry.job.port,
                    isVirtual: entry.job.isVirtual,
                    emulatorSlot: entry.job.emulatorSlot
                }).label
                : `missing-destination-${index}`;

            if (!entriesByDestination.has(destinationKey)) {
                entriesByDestination.set(destinationKey, []);
            }
            entriesByDestination.get(destinationKey)?.push({ entry, index });
        });

        await Promise.all(Array.from(entriesByDestination.entries()).map(async ([destinationKey, destinationEntries]) => {
            await this.enqueueJobForDestination(destinationKey, async () => {
                let destinationFailed = false;

                for (const { entry, index } of destinationEntries) {
                    if (ensureEventOperationOwned && !await ensureEventOperationOwned()) {
                        results[index] = "RETRY_REQUIRED";
                        destinationFailed = true;
                        continue;
                    }
                    results[index] = destinationFailed
                        ? await this.printComanda(entry.job, entry.copies, {
                            immediateFailureReason: "Skipped after previous destination failure"
                        })
                        : await this.printComanda(entry.job, entry.copies);

                    if (results[index] === false) {
                        destinationFailed = true;
                    }
                }
            });
        }));

        return results;
    }

    private static async enqueueJobForDestination<T>(destinationKey: string, task: () => Promise<T>): Promise<T> {
        const hasPrevious = this.destinationExecutionChains.has(destinationKey);
        const previous = this.destinationExecutionChains.get(destinationKey) || Promise.resolve();

        let releaseCurrent: (() => void) | undefined;
        const current = new Promise<void>((resolve) => {
            releaseCurrent = resolve;
        });
        const chain = previous.catch(() => undefined).then(() => current);
        this.destinationExecutionChains.set(destinationKey, chain);

        try {
            await previous.catch(() => undefined);
            if (hasPrevious) {
                await wait(PRINTER_SAME_DESTINATION_COOLDOWN_MS);
            }
            return await task();
        } finally {
            releaseCurrent?.();
            if (this.destinationExecutionChains.get(destinationKey) === chain) {
                this.destinationExecutionChains.delete(destinationKey);
            }
        }
    }

    private static normalizeBinaryPayload(value: unknown): Buffer | undefined {
        if (!value) return undefined;
        if (Buffer.isBuffer(value)) return Buffer.from(value);
        if (value instanceof Uint8Array) return Buffer.from(value);
        if (value instanceof ArrayBuffer) return Buffer.from(value);
        if (value instanceof Binary) return Buffer.from(value.buffer);

        if (typeof value === "object") {
            const bsonBinaryLike = value as BsonBinaryLike;
            if (typeof bsonBinaryLike.position === "number") {
                if (Buffer.isBuffer(bsonBinaryLike.buffer)) {
                    return Buffer.from(bsonBinaryLike.buffer);
                }
                if (bsonBinaryLike.buffer instanceof Uint8Array) {
                    return Buffer.from(bsonBinaryLike.buffer);
                }
            }

            const bufferJsonLike = value as BufferJsonLike;
            if (bufferJsonLike.type === "Buffer" && Array.isArray(bufferJsonLike.data)) {
                return Buffer.from(bufferJsonLike.data);
            }
        }

        return undefined;
    }

    private static printCashierReceiptNoticeBox(printer: ThermalPrinter, rowWidth: number) {
        printer.alignCenter();
        printer.println(RECEIPT_SEPARATOR);
        printer.setTextDoubleWidth();
        printer.setTextDoubleHeight();
        splitByLength("NO ORDINE", rowWidth).forEach((line) => printer.println(line));
        printer.setTextNormal();
        splitByLength("Vale solo come ricevuta", rowWidth).forEach((line) => printer.println(line));
        printer.println(RECEIPT_SEPARATOR);
    }

    private static async resolveVirtualRawCapturePath(destinationPort: number, startedAt: Date): Promise<string | undefined> {
        const slot = destinationPort - getVirtualPrinterStartPort() + 1;
        if (!Number.isInteger(slot) || slot < 1 || slot > 99) return undefined;
        const slotDir = path.join(
            /* turbopackIgnore: true */ PRINTER_EMULATOR_OUTPUT_DIR,
            `slot-${String(slot).padStart(2, "0")}`
        );

        const deadline = Date.now() + PRINTER_EMULATOR_CAPTURE_LOOKUP_TIMEOUT_MS;
        while (Date.now() <= deadline) {
            try {
                const entries = await fs.readdir(/* turbopackIgnore: true */ slotDir, { withFileTypes: true });
                const binEntries = entries
                    .filter((entry) => entry.isFile() && entry.name.endsWith(".bin"))
                    .map((entry) => entry.name);
                if (binEntries.length > 0) {
                    const withStats = await Promise.all(
                        binEntries.map(async (name) => {
                            const filePath = path.join(/* turbopackIgnore: true */ slotDir, name);
                            const stat = await fs.stat(/* turbopackIgnore: true */ filePath);
                            return { filePath, mtime: stat.mtime.getTime() };
                        })
                    );

                    const floorTime = startedAt.getTime() - 10_000;
                    const sorted = withStats
                        .filter((entry) => entry.mtime >= floorTime)
                        .sort((a, b) => b.mtime - a.mtime);
                    if (sorted[0]?.filePath) {
                        return sorted[0].filePath;
                    }
                }
            } catch {
                // ignore and retry until the deadline expires
            }

            if (Date.now() > deadline) break;
            await wait(50);
        }

        return undefined;
    }

    private static async persistLocalRawCapture(
        raw: Buffer,
        startedAt: Date,
        prefix: string
    ): Promise<string | undefined> {
        if (!raw.length) return undefined;

        try {
            await fs.mkdir(PRINTER_LOCAL_CAPTURE_DIR, { recursive: true });
            const fileName = `${prefix}-${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.bin`;
            const filePath = path.join(/* turbopackIgnore: true */ PRINTER_LOCAL_CAPTURE_DIR, fileName);
            await fs.writeFile(filePath, raw);
            await this.pruneLocalRawCaptures();
            return filePath;
        } catch (error) {
            console.error("Unable to persist local raw capture:", error);
            return undefined;
        }
    }

    private static async pruneLocalRawCaptures(): Promise<void> {
        try {
            const entries = await fs.readdir(
                /* turbopackIgnore: true */ PRINTER_LOCAL_CAPTURE_DIR,
                { withFileTypes: true }
            );
            const files = await Promise.all(
                entries
                    .filter((entry) => entry.isFile() && entry.name.endsWith(".bin"))
                    .map(async (entry) => {
                        const filePath = path.join(
                            /* turbopackIgnore: true */ PRINTER_LOCAL_CAPTURE_DIR,
                            entry.name
                        );
                        const stat = await fs.stat(/* turbopackIgnore: true */ filePath);
                        return {
                            filePath,
                            mtimeMs: stat.mtimeMs
                        };
                    })
            );

            const now = Date.now();
            const expiredFiles = files.filter((file) => now - file.mtimeMs > PRINTER_LOCAL_CAPTURE_MAX_AGE_MS);
            await Promise.all(expiredFiles.map((file) => fs.unlink(file.filePath).catch(() => undefined)));

            const freshFiles = files
                .filter((file) => now - file.mtimeMs <= PRINTER_LOCAL_CAPTURE_MAX_AGE_MS)
                .sort((left, right) => right.mtimeMs - left.mtimeMs);
            const overflowFiles = freshFiles.slice(PRINTER_LOCAL_CAPTURE_MAX_FILES);
            await Promise.all(overflowFiles.map((file) => fs.unlink(file.filePath).catch(() => undefined)));
        } catch (error) {
            console.warn("Unable to prune local raw captures:", error);
        }
    }

    private static withTimeout<T>(
        operation: Promise<T>,
        timeoutMs: number,
        timeoutMessage: string
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
            operation
                .then((value) => {
                    clearTimeout(timeoutHandle);
                    resolve(value);
                })
                .catch((error) => {
                    clearTimeout(timeoutHandle);
                    reject(error);
                });
        });
    }

    private static supportsLogo(printType: PrintJobType): boolean {
        return printType === "CUSTOMER_ORDER"
            || printType === "CASHIER_SUMMARY"
            || printType === "CASH_SESSION_SUMMARY"
            || printType === "EASTER_EGG_IMAGE"
            || printType === "MANUAL_TEST";
    }

    private static async tryPrintLogo(
        printer: ThermalPrinter,
        document: PrintDocumentV2,
        printType: PrintJobType
    ): Promise<boolean> {
        if (!this.supportsLogo(printType)) return false;
        const logoBuffer = await preparePrintableLogoPngBufferFromUrl(document.branding?.logoPath);
        if (!logoBuffer) return false;

        try {
            printer.alignLeft();
            await printer.printImageBuffer(logoBuffer);
            printer.alignLeft();
            printer.println(" ");
            return true;
        } catch (error) {
            console.warn("Unable to print logo, using text fallback only:", error);
            return false;
        }
    }

    private static async printRasterImageHeader(
        printer: ThermalPrinter,
        document: PrintDocumentV2,
        printType: PrintJobType
    ) {
        const hasLogo = await this.tryPrintLogo(printer, document, printType);
        if (!hasLogo) {
            const eventName = document.eventName?.trim();
            if (eventName) {
                printer.alignCenter();
                printer.setTextDoubleWidth();
                printer.setTextDoubleHeight();
                splitByLength(eventName.toUpperCase(), 40).forEach((line) => printer.println(line));
                printer.setTextNormal();
            }
        }

        if (hasLogo || document.eventName?.trim()) {
            printer.alignCenter();
            printer.println(RECEIPT_SEPARATOR);
        }

        printer.alignLeft();
    }

    private static async printPizzaTicketHighlight(printer: ThermalPrinter, document: PrintDocumentV2) {
        if (
            !document.pizzaNumber
            || (document.printType !== "CUSTOMER_ORDER" && document.printType !== "KITCHEN_ORDER")
        ) return;

        const rowWidth = 40;
        printer.alignCenter();

        if (document.pizzaBarcodeValue) {
            printer.println(" ");
            if (PIZZA_EAN8_PATTERN.test(document.pizzaBarcodeValue)) {
                printer.printBarcode(document.pizzaBarcodeValue, EPSON_BARCODE_EAN8, {
                    hriPos: 2,
                    width: 5,
                    height: 96
                });
                printer.println(" ");
            } else {
                printer.code128(document.pizzaBarcodeValue, {
                    height: 60,
                    text: 2
                });
                printer.println(" ");
            }
        }

        printer.bold(true);
        splitByLength("PIATTO N°", rowWidth).forEach((line) => printer.println(line));
        printer.setTextQuadArea();
        splitByLength(String(document.pizzaNumber), rowWidth).forEach((line) => printer.println(line));
        printer.setTextNormal();
        printer.bold(false);

        printer.println(RECEIPT_SEPARATOR);
    }

    private static async printHeader(printer: ThermalPrinter, document: PrintDocumentV2, withLargeEventTitle: boolean) {
        const rowWidth = 40;

        printer.alignCenter();
        if (withLargeEventTitle && document.eventName) {
            printer.setTextDoubleWidth();
            printer.setTextDoubleHeight();
            splitByLength(document.eventName.toUpperCase(), rowWidth).forEach((line) => printer.println(line));
            printer.setTextNormal();
            printer.println(RECEIPT_SEPARATOR);
        }

        if (document.printType === "CASHIER_SUMMARY") {
            this.printCashierReceiptNoticeBox(printer, rowWidth);
            const tableLabel = (document.tableNumber || "").trim();
            const customerLabel = (document.customerName || "").trim();
            if (tableLabel) {
                // ESC/POS has only integer scale steps; use Font B + double height
                // to approximate a "1.5x" emphasis without over-expanding width.
                printer.setTypeFontB();
                printer.setTextDoubleHeight();
                printer.bold(true);
                splitByLength(`TAVOLO N° ${tableLabel}`, rowWidth).forEach((line) => printer.println(line));
                printer.bold(false);
                printer.setTypeFontA();
                printer.setTextNormal();
                if (customerLabel) {
                    splitByLength(customerLabel, rowWidth).forEach((line) => printer.println(line));
                }
                printer.println(RECEIPT_SEPARATOR);
            } else if (customerLabel) {
                splitByLength(customerLabel, rowWidth).forEach((line) => printer.println(line));
                printer.println(RECEIPT_SEPARATOR);
            }
        }
        printer.setTextDoubleWidth();
        printer.setTextDoubleHeight();
        splitByLength(document.title.toUpperCase(), rowWidth).forEach((line) => printer.println(line));
        printer.setTextNormal();
        printer.println(document.copyLabel.toUpperCase());
        printer.println(RECEIPT_SEPARATOR);
        await this.printPizzaTicketHighlight(printer, document);

        const isOrderComanda = document.printType === "CUSTOMER_ORDER" || document.printType === "KITCHEN_ORDER";
        if (isOrderComanda) {
            const tableHighlight = (document.tableNumber || "").trim();
            const customerHighlight = (document.customerName || "").trim();

            if (tableHighlight) {
                printer.setTextDoubleWidth();
                printer.setTextDoubleHeight();
                printer.println(`TAVOLO N°`);
                printer.println("");
                printer.bold(true);
                splitByLength(`${tableHighlight}`, rowWidth).forEach((line) => printer.println(line));
                printer.bold(false);
                printer.println("");
                printer.setTypeFontA();
                printer.setTextNormal();
            }
            if (customerHighlight) {
                printer.setTypeFontB();
                printer.setTextDoubleHeight();
                splitByLength(customerHighlight, rowWidth).forEach((line) => printer.println(line));
                printer.setTypeFontA();
                printer.setTextNormal();
            }
            if (document.referenceCode) {
                printer.bold(true);
                printer.println(`ORDINE N° ${document.referenceCode}`);
                printer.bold(false);
            }

            if (tableHighlight || customerHighlight || document.referenceCode) {
                printer.println(RECEIPT_SEPARATOR);
            }
        }
        if (!isOrderComanda && document.printType !== "CASHIER_SUMMARY" && document.referenceCode) {
            const referencePrefix = document.printType === "CASH_SESSION_SUMMARY"
                ? "SESSIONE N°"
                : "ORDINE N°";
            printer.setTextDoubleWidth();
            printer.setTextDoubleHeight();
            splitByLength(`${referencePrefix} ${document.referenceCode}`.toUpperCase(), rowWidth).forEach((line) => printer.println(line));
            printer.setTextNormal();
            printer.println(RECEIPT_SEPARATOR);
        }

        printer.alignLeft();
        let headerLines = withLargeEventTitle && document.eventName
            ? document.headerLines.filter((line) => !line.startsWith("FESTA:"))
            : document.headerLines;
        if (document.printType === "CASHIER_SUMMARY" || isOrderComanda) {
            headerLines = headerLines.filter((line) => !line.toUpperCase().startsWith("TAVOLO:"));
            headerLines = headerLines.filter((line) => !line.toUpperCase().startsWith("CLIENTE:"));
        }
        headerLines.forEach((line) => {
            splitByLength(line, rowWidth).forEach((wrappedLine) => printer.println(wrappedLine));
        });
        if (headerLines.length > 0) {
            printer.println(RECEIPT_SEPARATOR);
        }
    }

    private static printItems(printer: ThermalPrinter, document: PrintDocumentV2) {
        const rowWidth = 40;
        const labelWidth = 24;
        const amountWidth = rowWidth - labelWidth;
        const cashierDescriptionWidth = 27;
        const cashierQtyWidth = 4;
        const cashierPriceWidth = 8;
        const cashierSpacerWidth = rowWidth - cashierDescriptionWidth - cashierQtyWidth - cashierPriceWidth;
        const cashierSpacer = " ".repeat(Math.max(1, cashierSpacerWidth));

        if (document.printType === "CASH_SESSION_SUMMARY" && document.items.length > 0) {
            const descriptionWidth = 26;
            const qtyWidth = 4;
            const netWidth = 9;
            const spacer = " ";
            let activeCategory: string | null = null;
            let activeGroup: string | null = null;
            let categoryItems: PrintDocumentV2["items"] = [];
            let groupItems: PrintDocumentV2["items"] = [];
            const printGroupTotals = () => {
                if (groupItems.length === 0) return;
                const gross = groupItems.reduce((sum, item) => sum + (item.grossAmount ?? item.lineTotal ?? 0), 0);
                const discount = groupItems.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0);
                const net = groupItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
                printer.println(`${padRight("SUBT. LORDO", labelWidth)}${padLeft(formatAmountNoCurrency(gross), amountWidth)}`);
                printer.println(`${padRight("SUBT. SCONTO", labelWidth)}${padLeft(formatAmountNoCurrency(discount), amountWidth)}`);
                printer.println(`${padRight("SUBT. NETTO", labelWidth)}${padLeft(formatAmountNoCurrency(net), amountWidth)}`);
            };
            const printCategoryTotals = () => {
                if (categoryItems.length === 0) return;
                const quantity = categoryItems.reduce((sum, item) => sum + item.qty, 0);
                const gross = categoryItems.reduce((sum, item) => sum + (item.grossAmount ?? item.lineTotal ?? 0), 0);
                const discount = categoryItems.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0);
                const net = categoryItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
                printer.bold(true);
                printer.println(`${padRight("CAT. Q.TA", labelWidth)}${padLeft(String(quantity), amountWidth)}`);
                printer.println(`${padRight("CAT. LORDO", labelWidth)}${padLeft(formatAmountNoCurrency(gross), amountWidth)}`);
                printer.println(`${padRight("CAT. SCONTO", labelWidth)}${padLeft(formatAmountNoCurrency(discount), amountWidth)}`);
                printer.println(`${padRight("CAT. NETTO", labelWidth)}${padLeft(formatAmountNoCurrency(net), amountWidth)}`);
                printer.bold(false);
                printer.println(RECEIPT_SEPARATOR);
            };

            printer.setTextNormal();
            printer.setTypeFontB();
            printer.println(
                `${padRight("DESCRIZIONE", descriptionWidth)}${spacer}${padLeft("Q.TA", qtyWidth)}${padLeft("NETTO", netWidth)}`
            );
            printer.println(RECEIPT_SEPARATOR);

            document.items.forEach((item) => {
                const categoryName = item.categoryName || "Non categorizzato";
                const groupLabel = item.groupLabel || "DETTAGLIO VENDUTO";
                if (activeCategory !== categoryName) {
                    printGroupTotals();
                    printCategoryTotals();
                    activeCategory = categoryName;
                    activeGroup = null;
                    categoryItems = [];
                    groupItems = [];
                    printer.bold(true);
                    splitByLength(`CATEGORIA: ${categoryName.toUpperCase()}`, rowWidth).forEach((line) => printer.println(line));
                    printer.bold(false);
                }
                if (activeGroup !== groupLabel) {
                    const hasPreviousGroup = groupItems.length > 0;
                    printGroupTotals();
                    if (hasPreviousGroup) printer.println(RECEIPT_SEPARATOR);
                    activeGroup = groupLabel;
                    groupItems = [];
                    printer.bold(true);
                    splitByLength(groupLabel.toUpperCase(), rowWidth).forEach((line) => printer.println(line));
                    printer.bold(false);
                }
                categoryItems.push(item);
                groupItems.push(item);
                splitByLength(item.name, descriptionWidth).forEach((line, index) => {
                    printer.println(
                        `${padRight(line, descriptionWidth)}${spacer}`
                        + `${padLeft(index === 0 ? String(item.qty) : "", qtyWidth)}`
                        + `${padLeft(index === 0 && Number.isFinite(item.lineTotal) ? formatAmountNoCurrency(item.lineTotal) : "", netWidth)}`
                    );
                });
            });
            printGroupTotals();
            printCategoryTotals();
            printer.setTypeFontA();
            printer.setTextNormal();
            return;
        }

        if (document.items.length > 0) {
            printer.setTextNormal();
            if (document.printType === "CASHIER_SUMMARY") {
                printer.println(
                    `${padRight("DESCRIZIONE", cashierDescriptionWidth)}${cashierSpacer}${padLeft("Q.TA", cashierQtyWidth)}${padLeft("PREZZO", cashierPriceWidth)}`
                );
            } else {
                printer.println("DESCRIZIONE");
            }
            printer.println(RECEIPT_SEPARATOR);
        }

        document.items.forEach((item) => {
            if (document.printType === "CASHIER_SUMMARY") {
                const unitPrice = Number.isFinite(item.unitPrice) ? Number(item.unitPrice) : undefined;
                const lineTotal = Number.isFinite(item.lineTotal)
                    ? Number(item.lineTotal)
                    : (Number.isFinite(unitPrice) ? Number(unitPrice) * item.qty : undefined);
                splitByLength(item.name, cashierDescriptionWidth).forEach((line, index) => {
                    const qtyCell = index === 0 ? String(item.qty) : "";
                    const priceCell = index === 0 && lineTotal !== undefined ? formatAmountNoCurrency(lineTotal) : "";
                    printer.println(
                        `${padRight(line, cashierDescriptionWidth)}${cashierSpacer}${padLeft(qtyCell, cashierQtyWidth)}${padLeft(priceCell, cashierPriceWidth)}`
                    );
                });
                if (item.notes) {
                    splitByLength(`NOTE: ${item.notes}`, rowWidth).forEach((line) => printer.println(line));
                }
                printer.println(RECEIPT_SEPARATOR);
                return;
            }

            const itemTitle = `${item.qty}x ${item.name}`;
            printer.setTextDoubleWidth();
            printer.setTextDoubleHeight();
            splitByLength(itemTitle, rowWidth).forEach((line) => printer.println(line));
            printer.setTextNormal();

            const unitPrice = Number.isFinite(item.unitPrice) ? Number(item.unitPrice) : undefined;
            const lineTotal = Number.isFinite(item.lineTotal)
                ? Number(item.lineTotal)
                : (Number.isFinite(unitPrice) ? Number(unitPrice) * item.qty : undefined);

            if (unitPrice !== undefined || lineTotal !== undefined) {
                const left = `${item.qty} x ${formatEuroReceipt(unitPrice)}`;
                printer.println(`${padRight(left, labelWidth)}${padLeft(formatEuroReceipt(lineTotal), amountWidth)}`);
            }

            (item.selectedOptions || []).forEach((option) => {
                const optionLabel = `+ ${option.name}`;
                splitByLength(optionLabel, labelWidth).forEach((line) => {
                    const optionAmount = Number.isFinite(option.priceVariation)
                        ? formatEuroReceipt(option.priceVariation)
                        : "";
                    printer.println(`${padRight(line, labelWidth)}${padLeft(optionAmount, amountWidth)}`);
                });
            });

            if (item.notes) {
                splitByLength(`NOTE: ${item.notes}`, rowWidth).forEach((line) => printer.println(line));
            }

            printer.println(RECEIPT_SEPARATOR);
        });
    }

    private static printTotals(printer: ThermalPrinter, document: PrintDocumentV2) {
        const rowWidth = 40;
        const labelWidth = 24;
        const amountWidth = rowWidth - labelWidth;

        if (document.printType === "CASHIER_SUMMARY") {
            const totalRow = document.totals.find((row) => row.label.toUpperCase().includes("TOTALE"));
            if (totalRow) {
                printer.setTextNormal();
                printer.println(`${padRight("TOTALE", labelWidth)}${padLeft(totalRow.value, amountWidth)}`);
                printer.println(RECEIPT_SEPARATOR);
            }
            return;
        }

        if (document.printType === "CASH_SESSION_SUMMARY") {
            printer.setTypeFontA();
            printer.setTextNormal();
            document.totals.forEach((row) => {
                const strong = row.emphasis === "strong";
                printer.bold(strong);
                const label = `${row.label.toUpperCase()}:`;
                const wrappedLabel = splitByLength(label, labelWidth);
                wrappedLabel.forEach((line, index) => {
                    printer.println(index === wrappedLabel.length - 1
                        ? `${padRight(line, labelWidth)}${padLeft(row.value, amountWidth)}`
                        : line);
                });
                printer.bold(false);
            });
            if (document.totals.length > 0) printer.println(RECEIPT_SEPARATOR);
            return;
        }

        document.totals.forEach((row) => {
            const normalizedLabel = row.label.toUpperCase();
            const emphasisStrong = row.emphasis === "strong" || normalizedLabel.includes("TOTALE");
            if (emphasisStrong) {
                printer.setTextDoubleWidth();
                printer.setTextDoubleHeight();
            }

            const label = normalizedLabel.includes("TOTALE")
                ? `${normalizedLabel} -->`
                : `${normalizedLabel}:`;
            const value = row.value;
            const wrappedLabel = splitByLength(label, labelWidth);

            if (wrappedLabel.length === 0) {
                printer.println(`${padRight(label, labelWidth)}${padLeft(value, amountWidth)}`);
            } else {
                wrappedLabel.forEach((line, index) => {
                    if (index === wrappedLabel.length - 1) {
                        printer.println(`${padRight(line, labelWidth)}${padLeft(value, amountWidth)}`);
                    } else {
                        printer.println(line);
                    }
                });
            }

            if (emphasisStrong) printer.setTextNormal();
        });

        if (document.totals.length > 0) {
            printer.println(RECEIPT_SEPARATOR);
        }
    }

    private static printFooter(printer: ThermalPrinter, document: PrintDocumentV2) {
        const rowWidth = 40;

        if (document.printType === "CASHIER_SUMMARY") {
            printer.alignLeft();
            printer.println(`DATA/ORA ORDINE: ${formatPrintDateTime(document.createdAt)}`);
            if (document.referenceCode) {
                printer.println(`NUMERO ORDINE: ${document.referenceCode}`);
            }
            printer.println(RECEIPT_SEPARATOR);
            printer.cut();
            return;
        }

        printer.alignCenter();
        document.footerLines.forEach((line) => {
            splitByLength(line, rowWidth).forEach((wrappedLine) => printer.println(wrappedLine));
        });
        printer.cut();
    }

    private static async renderPrintDocument(printer: ThermalPrinter, document: PrintDocumentV2, withLargeEventTitle: boolean) {
        await this.printHeader(printer, document, withLargeEventTitle);
        this.printItems(printer, document);
        this.printTotals(printer, document);
        this.printFooter(printer, document);
    }

    private static async createPrintJobLog(params: {
        eventId?: string;
        printerId?: string;
        orderId?: string;
        source: PrintJobSource;
        printType: PrintJobType;
        queueRecoverable?: boolean;
        status?: "QUEUED" | "HELD" | "SENT" | "FAILED";
        destinationHost: string;
        destinationPort: number;
        isVirtual: boolean;
        copies: number;
        document: Record<string, unknown>;
        errorMessage?: string;
        heldSince?: Date;
        liveClaimExpiresAt?: Date;
        idempotencyKey?: string;
    }): Promise<{ id?: string; created: boolean; retryClaimedAt?: Date; recoveryPending?: boolean; persistenceFailed?: boolean }> {
        if (!params.eventId) return { created: true };

        const retryClaimedAt = params.idempotencyKey?.startsWith("SUMUP_CALLBACK:") && !params.queueRecoverable
            ? new Date()
            : undefined;
        const normalizedOrderId = (typeof params.orderId === "string" && mongoose.Types.ObjectId.isValid(params.orderId))
            ? params.orderId
            : undefined;

        try {
            await dbConnect();
            const created = await PrintJobModel.create({
                eventId: params.eventId,
                printerId: params.printerId || undefined,
                orderId: normalizedOrderId,
                source: params.source,
                printType: params.printType,
                queueRecoverable: Boolean(params.queueRecoverable),
                idempotencyKey: params.idempotencyKey,
                status: params.status || "QUEUED",
                destinationHost: params.destinationHost,
                destinationPort: params.destinationPort,
                isVirtual: params.isVirtual,
                copies: params.copies,
                document: params.document,
                errorMessage: params.errorMessage,
                heldSince: params.heldSince,
                liveClaimExpiresAt: params.liveClaimExpiresAt,
                retryClaimedAt
            });
            return { id: created._id.toString(), created: true, retryClaimedAt };
        } catch (error) {
            if (
                params.idempotencyKey
                && typeof error === "object"
                && error !== null
                && (error as { code?: unknown }).code === 11000
            ) {
                if (!retryClaimedAt) return { created: false };

                const staleClaimBefore = new Date(retryClaimedAt.getTime() - SUMUP_PRINT_CLAIM_LEASE_MS);
                let reclaimed: { _id: { toString(): string } } | null;
                try {
                    reclaimed = await PrintJobModel.findOneAndUpdate(
                        {
                            eventId: params.eventId,
                            source: params.source,
                            idempotencyKey: params.idempotencyKey,
                            status: "QUEUED",
                            queueRecoverable: false,
                            heldSince: { $exists: false },
                            ...(normalizedOrderId
                                ? { orderId: normalizedOrderId }
                                : { orderId: { $exists: false } }),
                            $and: [
                                {
                                    $or: [
                                        { retryClaimedAt: { $exists: false } },
                                        { retryClaimedAt: { $lte: staleClaimBefore } }
                                    ]
                                },
                                {
                                    $or: [
                                        { liveClaimExpiresAt: { $exists: false } },
                                        { liveClaimExpiresAt: { $lte: retryClaimedAt } }
                                    ]
                                },
                                {
                                    $or: [
                                        { queueClaimToken: { $exists: false } },
                                        { queueClaimExpiresAt: { $lte: retryClaimedAt } }
                                    ]
                                }
                            ]
                        },
                        { $set: { retryClaimedAt } },
                        { returnDocument: "after" }
                    ).select("_id").lean() as ({ _id: { toString(): string } } | null);
                } catch (reclaimError) {
                    console.error("Unable to reclaim persisted SumUp print intent:", reclaimError);
                    return { created: false, persistenceFailed: true };
                }

                if (reclaimed) {
                    return { id: reclaimed._id.toString(), created: true, retryClaimedAt };
                }

                const existing = await PrintJobModel.findOne({
                    eventId: params.eventId,
                    source: params.source,
                    idempotencyKey: params.idempotencyKey,
                    ...(normalizedOrderId
                        ? { orderId: normalizedOrderId }
                        : { orderId: { $exists: false } })
                }).select("status").lean() as ({ status?: "QUEUED" | "HELD" | "SENT" | "FAILED" } | null);

                return existing?.status === "QUEUED"
                    ? { created: false, recoveryPending: true }
                    : { created: false };
            }
            console.error("Unable to persist print job log:", error);
            return { created: false, persistenceFailed: true };
        }
    }

    private static async updatePrintJobLog(
        id: string | undefined,
        updates: {
            status: "SENT" | "FAILED";
            errorMessage?: string;
            rawCapturePath?: string;
            automaticRetryCount?: number;
            clearRetryClaim?: boolean;
            clearLiveClaim?: boolean;
        }
    ) {
        if (!id) return;
        try {
            const unset: Record<string, 1> = {};
            const update: Record<string, unknown> = {
                $set: {
                    status: updates.status,
                    rawCapturePath: updates.rawCapturePath || undefined,
                    automaticRetryCount: updates.automaticRetryCount ?? 0,
                    ...(updates.status === "FAILED" ? { errorMessage: updates.errorMessage || undefined } : {})
                }
            };
            if (updates.status === "SENT") unset.errorMessage = 1;
            if (updates.clearRetryClaim) unset.retryClaimedAt = 1;
            if (updates.clearLiveClaim) unset.liveClaimExpiresAt = 1;
            if (Object.keys(unset).length > 0) update.$unset = unset;
            await PrintJobModel.updateOne(
                { _id: id },
                update
            );
        } catch (error) {
            console.error(`Unable to update print job log ${id}:`, error);
        }
    }

    private static async holdPrintJobLog(id: string | undefined, errorMessage: string): Promise<boolean> {
        if (!id) return false;
        try {
            const result = await PrintJobModel.updateOne(
                { _id: id, status: "QUEUED" },
                {
                    $set: {
                        status: "HELD",
                        heldSince: new Date(),
                        errorMessage
                    },
                    $unset: { liveClaimExpiresAt: 1 }
                }
            );
            return (result.matchedCount ?? result.modifiedCount) === 1;
        } catch (error) {
            console.error(`Unable to hold print job log ${id}:`, error);
            return false;
        }
    }

    private static async refreshLivePrintJobClaim(id: string | undefined, expiresAt: Date): Promise<boolean> {
        if (!id) return false;
        const result = await PrintJobModel.updateOne(
            { _id: id, status: "QUEUED", heldSince: { $exists: false } },
            { $set: { liveClaimExpiresAt: expiresAt } }
        );
        return (result.matchedCount ?? result.modifiedCount) === 1;
    }

    private static async dispatchPrintDocument(params: {
        destinationHost: string;
        destinationPort: number;
        destinationLabel: string;
        printType: PrintJobType;
        document: PrintDocumentV2;
        isVirtual: boolean;
        copies: number;
    }): Promise<PrintDispatchAttemptResult> {
        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: toTcpPrinterInterface(params.destinationHost, params.destinationPort),
            characterSet: getPrinterCharacterSet(),
            removeSpecialCharacters: false,
            lineCharacter: "=",
        });

        let isConnected = false;
        try {
            isConnected = await this.waitForPrinterReachable(printer, PRINTER_CONNECT_TIMEOUT_MS);
        } catch (error) {
            console.error(`Printer connection check error at ${params.destinationLabel}:`, error);
            return {
                success: false,
                errorMessage: "Printer connection timeout",
                automaticRetryCount: 0
            };
        }

        if (!isConnected) {
            console.error(`Printer at ${params.destinationLabel} is not reachable`);
            return {
                success: false,
                errorMessage: "Printer not reachable",
                automaticRetryCount: 0
            };
        }

        const hasLogo = await this.tryPrintLogo(printer, params.document, params.printType);
        await this.renderPrintDocument(printer, params.document, !hasLogo);

        try {
            const executeStartedAt = new Date();
            const bufferedRaw = typeof (printer as unknown as { getBuffer?: () => unknown }).getBuffer === "function"
                ? (printer as unknown as { getBuffer: () => unknown }).getBuffer()
                : undefined;
            const localRawCapturePath = !params.isVirtual && Buffer.isBuffer(bufferedRaw)
                ? await this.persistLocalRawCapture(Buffer.from(bufferedRaw), executeStartedAt, "document")
                : undefined;
            for (let i = 0; i < params.copies; i += 1) {
                await this.executeWithConnectionRetry(printer, PRINTER_EXECUTE_TIMEOUT_MS);
            }
            console.log(`Print job sent to ${params.destinationLabel} (${params.copies} copies) successfully`);
            const rawCapturePath = params.isVirtual
                ? await this.resolveVirtualRawCapturePath(params.destinationPort, executeStartedAt)
                : localRawCapturePath;
            return { success: true, rawCapturePath, automaticRetryCount: 0 };
        } catch (error) {
            console.error(`Printer execution error at ${params.destinationLabel}:`, error);
            const message = this.isTimeoutError(error)
                ? "Printer execution timeout"
                : this.isConnectionRefusedError(error)
                    ? "Printer not reachable"
                    : "Printer execution error";
            return {
                success: false,
                errorMessage: message,
                automaticRetryCount: 0
            };
        }
    }

    private static async dispatchPrintDocumentWithAutomaticRetry(params: {
        destinationHost: string;
        destinationPort: number;
        destinationLabel: string;
        printType: PrintJobType;
        document: PrintDocumentV2;
        isVirtual: boolean;
        copies: number;
    }): Promise<PrintDispatchAttemptResult> {
        let result = await this.dispatchPrintDocument(params);
        let automaticRetryCount = 0;

        for (
            let retryIndex = 0;
            !result.success
                && result.errorMessage === "Printer not reachable"
                && retryIndex < PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS.length;
            retryIndex += 1
        ) {
            const delayMs = PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS[retryIndex];
            console.warn(
                `Printer at ${params.destinationLabel} is not reachable, retrying in ${delayMs}ms `
                + `(${retryIndex + 2}/${PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS.length + 1})`
            );
            await wait(delayMs);
            automaticRetryCount += 1;
            result = await this.dispatchPrintDocument(params);
        }

        return {
            ...result,
            automaticRetryCount
        };
    }

    private static async dispatchRasterImage(params: {
        destinationHost: string;
        destinationPort: number;
        destinationLabel: string;
        document: PrintDocumentV2;
        raster: {
            width: number;
            height: number;
            data: Buffer;
        };
        isVirtual: boolean;
        copies: number;
    }): Promise<PrintDispatchAttemptResult> {
        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: toTcpPrinterInterface(params.destinationHost, params.destinationPort),
            characterSet: getPrinterCharacterSet(),
            removeSpecialCharacters: false,
            lineCharacter: "=",
        });

        let isConnected = false;
        try {
            isConnected = await this.waitForPrinterReachable(printer, PRINTER_CONNECT_TIMEOUT_MS);
        } catch (error) {
            console.error(`Printer connection check error at ${params.destinationLabel}:`, error);
            return {
                success: false,
                errorMessage: "Printer connection timeout",
                automaticRetryCount: 0
            };
        }

        if (!isConnected) {
            console.error(`Printer at ${params.destinationLabel} is not reachable`);
            return {
                success: false,
                errorMessage: "Printer not reachable",
                automaticRetryCount: 0
            };
        }

        try {
            const executeStartedAt = new Date();
            const rasterPngStripes = await renderThermalRasterToStripePngBuffers({
                width: params.raster.width,
                height: params.raster.height,
                data: Buffer.from(params.raster.data)
            }, RASTER_PNG_STRIPE_HEIGHT, { centerOnPaper: true });

            printer.clear();
            await this.printRasterImageHeader(printer, params.document, "EASTER_EGG_IMAGE");
            for (const stripePng of rasterPngStripes) {
                await printer.printImageBuffer(stripePng);
            }
            printer.alignLeft();
            printer.println(" ");
            printer.cut();

            const bufferedRaw = printer.getBuffer();
            const localRawCapturePath = !params.isVirtual && Buffer.isBuffer(bufferedRaw)
                ? await this.persistLocalRawCapture(Buffer.from(bufferedRaw), executeStartedAt, "raster")
                : undefined;

            for (let i = 0; i < params.copies; i += 1) {
                await this.executeWithConnectionRetry(printer, PRINTER_EXECUTE_TIMEOUT_MS);
            }
            const rawCapturePath = params.isVirtual
                ? await this.resolveVirtualRawCapturePath(params.destinationPort, executeStartedAt)
                : localRawCapturePath;
            return { success: true, rawCapturePath, automaticRetryCount: 0 };
        } catch (error) {
            console.error(`Raster print execution error at ${params.destinationLabel}:`, error);
            const message = this.isTimeoutError(error)
                ? "Printer execution timeout"
                : this.isConnectionRefusedError(error)
                    ? "Printer not reachable"
                    : "Printer execution error";
            return {
                success: false,
                errorMessage: message,
                automaticRetryCount: 0
            };
        }
    }

    private static async dispatchRasterImageWithAutomaticRetry(params: {
        destinationHost: string;
        destinationPort: number;
        destinationLabel: string;
        document: PrintDocumentV2;
        raster: {
            width: number;
            height: number;
            data: Buffer;
        };
        isVirtual: boolean;
        copies: number;
    }): Promise<PrintDispatchAttemptResult> {
        let result = await this.dispatchRasterImage(params);
        let automaticRetryCount = 0;

        for (
            let retryIndex = 0;
            !result.success
                && result.errorMessage === "Printer not reachable"
                && retryIndex < PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS.length;
            retryIndex += 1
        ) {
            const delayMs = PRINTER_NOT_REACHABLE_RETRY_DELAYS_MS[retryIndex];
            await wait(delayMs);
            automaticRetryCount += 1;
            result = await this.dispatchRasterImage(params);
        }

        return {
            ...result,
            automaticRetryCount
        };
    }

    static async printComanda(
        job: PrinterCommandJob,
        copies: number = 1,
        options?: { immediateFailureReason?: string }
    ) {
        const printType = job.printType || "CUSTOMER_ORDER";
        const document = buildOrderPrintDocumentV2({
            printType,
            title: job.title || "COMANDA",
            eventName: job.eventName,
            copyLabel: job.copyLabel,
            orderId: job.orderId,
            shortCode: job.shortCode,
            pizzaNumber: job.pizzaNumber,
            pizzaBarcodeValue: job.pizzaBarcodeValue,
            customerName: job.customerName,
            tableNumber: job.tableNumber,
            items: job.items,
            totals: (job.totals || []).map((row) => ({
                label: row.label,
                value: row.value,
                emphasis: row.emphasis === "strong" ? "strong" : "normal"
            })),
            footerLines: job.footerLines || [],
            brandingLogoUrl: sanitizePrintableHeaderLogoUrl(job.brandingLogoUrl)
        });

        const destination = resolvePrinterDestination({
            ip: job.ip,
            port: job.port,
            isVirtual: job.isVirtual,
            emulatorSlot: job.emulatorSlot
        });
        const destinationHost = destination.host;
        const destinationPort = destination.port;
        const destinationLabel = destination.label;

        const canUseKitchenQueueLease = Boolean(job.queueRecoverable && job.eventId && job.printerId);
        const kitchenLease = canUseKitchenQueueLease ? buildPrintQueueLease() : null;

        const log = await this.createPrintJobLog({
            eventId: job.eventId,
            printerId: job.printerId,
            orderId: job.orderId,
            source: job.source || "ORDER",
            printType,
            queueRecoverable: Boolean(job.queueRecoverable),
            idempotencyKey: job.idempotencyKey,
            destinationHost: destinationHost || "unknown",
            destinationPort,
            isVirtual: Boolean(job.isVirtual),
            copies,
            document: document as unknown as Record<string, unknown>,
            liveClaimExpiresAt: kitchenLease?.expiresAt
        });
        if (!log.created) {
            if (log.persistenceFailed) {
                return job.idempotencyKey?.startsWith("SUMUP_CALLBACK:") ? "RETRY_REQUIRED" : false;
            }
            return log.recoveryPending ? "RECOVERY_PENDING" : true;
        }
        const logId = log.id;
        if (job.idempotencyKey && !logId) return false;

        if (kitchenLease && !logId) return false;
        let kitchenLeaseClaimed = false;

        try {
            if (kitchenLease && job.printerId) {
                kitchenLeaseClaimed = await claimKitchenPrinterQueueLease(
                    job.printerId,
                    kitchenLease.token,
                    kitchenLease.expiresAt
                );

                if (!kitchenLeaseClaimed) {
                    const kitchenPrinterExists = Boolean(await PrinterModel.exists({
                        _id: job.printerId,
                        eventId: job.eventId,
                        type: "KITCHEN"
                    }));
                    if (!kitchenPrinterExists) {
                        await this.updatePrintJobLog(logId, {
                            status: "FAILED",
                            errorMessage: "Stampante reparto non disponibile",
                            clearRetryClaim: Boolean(log.retryClaimedAt),
                            clearLiveClaim: true
                        });
                        return false;
                    }
                    const held = await this.holdPrintJobLog(logId, "Accodata dietro stampe reparto già in attesa");
                    return held;
                }

                // Once an operator has accepted a department backlog, later jobs
                // join the persisted queue instead of racing a live send.
                const hasBacklog = Boolean(await PrintJobModel.exists({
                    eventId: job.eventId,
                    printerId: job.printerId,
                    source: "ORDER",
                    printType: "KITCHEN_ORDER",
                    queueRecoverable: true,
                    status: { $in: ["HELD", "QUEUED"] },
                    heldSince: { $exists: true }
                }));
                if (hasBacklog) {
                    const held = await this.holdPrintJobLog(logId, "Accodata dietro stampe reparto già in attesa");
                    return held;
                }
            }

            if (options?.immediateFailureReason) {
                await this.updatePrintJobLog(logId, {
                    status: "FAILED",
                    errorMessage: options.immediateFailureReason,
                    clearRetryClaim: Boolean(log.retryClaimedAt),
                    clearLiveClaim: Boolean(kitchenLease)
                });
                return false;
            }

            if (!destinationHost) {
                console.warn(`No printer destination defined for job ${job.orderId}`);
                await this.updatePrintJobLog(logId, {
                    status: "FAILED",
                    errorMessage: "No printer destination defined",
                    clearRetryClaim: Boolean(log.retryClaimedAt),
                    clearLiveClaim: Boolean(kitchenLease)
                });
                return false;
            }

            if (kitchenLease && kitchenLeaseClaimed && job.printerId) {
                const refreshedLease = buildPrintQueueLease();
                const liveClaimRefreshed = await this.refreshLivePrintJobClaim(logId, refreshedLease.expiresAt);
                if (!liveClaimRefreshed) {
                    await this.updatePrintJobLog(logId, {
                        status: "FAILED",
                        errorMessage: "Arbitraggio coda stampa perso",
                        clearRetryClaim: Boolean(log.retryClaimedAt),
                        clearLiveClaim: true
                    });
                    return false;
                }
                const refreshed = await refreshKitchenPrinterQueueLease(
                    job.printerId,
                    kitchenLease.token,
                    refreshedLease.expiresAt
                );
                if (!refreshed) {
                    await this.updatePrintJobLog(logId, {
                        status: "FAILED",
                        errorMessage: "Arbitraggio coda stampa perso",
                        clearRetryClaim: Boolean(log.retryClaimedAt),
                        clearLiveClaim: true
                    });
                    return false;
                }
            }

            const normalizedDocument = normalizeLegacyPrintDocument(document as unknown as Record<string, unknown>);
            const dispatchResult = await this.dispatchPrintDocumentWithAutomaticRetry({
                destinationHost,
                destinationPort,
                destinationLabel,
                printType,
                document: normalizedDocument,
                isVirtual: Boolean(job.isVirtual),
                copies
            });

            if (!dispatchResult.success) {
                await this.updatePrintJobLog(logId, {
                    status: "FAILED",
                    errorMessage: dispatchResult.errorMessage,
                    automaticRetryCount: dispatchResult.automaticRetryCount,
                    clearRetryClaim: Boolean(log.retryClaimedAt),
                    clearLiveClaim: Boolean(kitchenLease)
                });
                return false;
            }

            await this.updatePrintJobLog(logId, {
                status: "SENT",
                rawCapturePath: dispatchResult.rawCapturePath,
                automaticRetryCount: dispatchResult.automaticRetryCount,
                clearRetryClaim: Boolean(log.retryClaimedAt),
                clearLiveClaim: Boolean(kitchenLease)
            });
            return true;
        } finally {
            if (kitchenLease && kitchenLeaseClaimed && job.printerId) {
                await releaseKitchenPrinterQueueLease(job.printerId, kitchenLease.token);
            }
        }
    }

    /**
     * Executes a queue-owned kitchen job without changing its persisted state.
     * The queue worker owns the token-scoped HELD/QUEUED/SENT transitions.
     */
    static async dispatchHeldKitchenPrintJob(eventId: string, jobId: string): Promise<{
        success: boolean;
        recoverable?: boolean;
        error?: string;
        rawCapturePath?: string;
        automaticRetryCount?: number;
    }> {
        if (!eventId || !jobId) {
            return { success: false, recoverable: false, error: "Parametri mancanti" };
        }

        await dbConnect();
        const job = await PrintJobModel.findOne({
            _id: jobId,
            eventId,
            source: "ORDER",
            printType: "KITCHEN_ORDER",
            queueRecoverable: true,
            status: "QUEUED",
            heldSince: { $exists: true },
            queueClaimToken: { $exists: true }
        })
            .populate("printerId", "ip port isVirtual emulatorSlot type")
            .lean() as ({
                printerId?: {
                    ip?: string;
                    port?: number;
                    isVirtual?: boolean;
                    emulatorSlot?: number;
                    type?: "CASHIER" | "KITCHEN";
                } | null;
                destinationHost?: string;
                destinationPort?: number;
                isVirtual?: boolean;
                copies?: number;
                document?: Record<string, unknown>;
            } | null);

        if (!job || job.printerId?.type !== "KITCHEN") {
            return { success: false, recoverable: false, error: "Job reparto accodato non disponibile" };
        }

        const destination = resolvePrinterDestination({
            ip: job.printerId.ip || asString(job.destinationHost),
            port: job.printerId.port || job.destinationPort || DEFAULT_PRINTER_PORT,
            isVirtual: typeof job.printerId.isVirtual === "boolean"
                ? job.printerId.isVirtual
                : Boolean(job.isVirtual),
            emulatorSlot: job.printerId.emulatorSlot
        });
        if (!destination.host) {
            return { success: false, recoverable: false, error: "Destinazione stampante non disponibile" };
        }

        try {
            const dispatchResult = await this.enqueueJobForDestination(destination.label, () =>
                this.dispatchPrintDocumentWithAutomaticRetry({
                    destinationHost: destination.host,
                    destinationPort: destination.port,
                    destinationLabel: destination.label,
                    printType: "KITCHEN_ORDER",
                    document: normalizeLegacyPrintDocument(job.document || {}),
                    isVirtual: typeof job.printerId?.isVirtual === "boolean"
                        ? job.printerId.isVirtual
                        : Boolean(job.isVirtual),
                    copies: job.copies || 1
                })
            );

            return dispatchResult.success
                ? {
                    success: true,
                    rawCapturePath: dispatchResult.rawCapturePath,
                    automaticRetryCount: dispatchResult.automaticRetryCount
                }
                : {
                    success: false,
                    recoverable: true,
                    error: dispatchResult.errorMessage || "Invio stampa fallito",
                    automaticRetryCount: dispatchResult.automaticRetryCount
                };
        } catch (error) {
            console.error(`Queued kitchen print job ${jobId} failed before dispatch:`, error);
            return { success: false, recoverable: false, error: "Documento stampa non valido" };
        }
    }

    static async printRasterImage(
        job: PrinterRasterImageJob,
        raster: {
            width: number;
            height: number;
            data: Buffer;
        },
        copies = 1,
        options?: { immediateFailureReason?: string }
    ) {
        const printType = job.printType || "EASTER_EGG_IMAGE";
        const brandingLogoUrl = sanitizePrintableHeaderLogoUrl(job.brandingLogoUrl);
        const document = {
            schemaVersion: 2,
            kind: "EASTER_EGG_IMAGE",
            printType,
            title: job.title || "EASTER EGG",
            copyLabel: job.copyLabel || "EASTER EGG",
            createdAt: new Date().toISOString(),
            headerLines: job.eventName ? [`FESTA: ${job.eventName}`] : [],
            items: [],
            totals: [],
            footerLines: job.footerLines || [],
            branding: brandingLogoUrl
                ? {
                    logoPath: brandingLogoUrl,
                    logoMode: "attempted" as const
                }
                : {
                    logoMode: "none" as const
                },
            eventName: job.eventName,
            imageUrl: job.imageUrl,
            rasterWidth: raster.width,
            rasterHeight: raster.height,
            crop: job.crop || {}
            ,
            processing: job.processing || {}
        } satisfies PrintDocumentV2 & Record<string, unknown>;

        const destination = resolvePrinterDestination({
            ip: job.ip,
            port: job.port,
            isVirtual: job.isVirtual,
            emulatorSlot: job.emulatorSlot
        });
        const destinationHost = destination.host;
        const destinationPort = destination.port;
        const destinationLabel = destination.label;

        const log = await this.createPrintJobLog({
            eventId: job.eventId,
            printerId: job.printerId,
            orderId: job.orderId,
            source: job.source || "MANUAL_TEST",
            printType,
            idempotencyKey: job.idempotencyKey,
            destinationHost: destinationHost || "unknown",
            destinationPort,
            isVirtual: Boolean(job.isVirtual),
            copies,
            document
        });
        if (!log.created) {
            if (log.persistenceFailed) {
                return job.idempotencyKey?.startsWith("SUMUP_CALLBACK:") ? "RETRY_REQUIRED" : false;
            }
            return log.recoveryPending ? "RECOVERY_PENDING" : true;
        }
        const logId = log.id;
        if (job.idempotencyKey && !logId) return false;

        if (options?.immediateFailureReason) {
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: options.immediateFailureReason,
                clearRetryClaim: Boolean(log.retryClaimedAt)
            });
            return false;
        }

        if (!destinationHost) {
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: "No printer destination defined",
                clearRetryClaim: Boolean(log.retryClaimedAt)
            });
            return false;
        }

        const dispatchResult = await this.dispatchRasterImageWithAutomaticRetry({
            destinationHost,
            destinationPort,
            destinationLabel,
            document,
            raster,
            isVirtual: Boolean(job.isVirtual),
            copies
        });

        if (!dispatchResult.success) {
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: dispatchResult.errorMessage,
                automaticRetryCount: dispatchResult.automaticRetryCount,
                clearRetryClaim: Boolean(log.retryClaimedAt)
            });
            return false;
        }

        await this.updatePrintJobLog(logId, {
            status: "SENT",
            rawCapturePath: dispatchResult.rawCapturePath,
            automaticRetryCount: dispatchResult.automaticRetryCount,
            clearRetryClaim: Boolean(log.retryClaimedAt)
        });
        return true;
    }

    static async routeOrderToPrinters(
        orderId: string,
        posDeviceId?: string
    ): Promise<boolean[] | undefined>;
    static async routeOrderToPrinters(
        orderId: string,
        posDeviceId: string | undefined,
        options: { idempotencyScope: string; ensureEventOperationOwned?: () => Promise<boolean> }
    ): Promise<PrintDispatchResult[] | undefined>;
    static async routeOrderToPrinters(
        orderId: string,
        posDeviceId?: string,
        options?: { idempotencyScope?: string; ensureEventOperationOwned?: () => Promise<boolean> }
    ) {
        await dbConnect();
        const order = await Order.findById(orderId).lean() as ({
            _id: { toString(): string };
            eventId: { toString(): string };
            pickupNumber?: number;
            dishTickets?: Array<{
                productId?: { toString(): string } | string;
                snapshotName?: string;
                pizzaNumber?: number;
                state?: "QUEUED" | "READY" | "REMOVED";
                readyAt?: Date | string;
            }>;
            status?: string;
            paymentMethod?: string;
            totalAmount?: number;
            sumupPrintCompletedAt?: Date | string;
            customer?: { name?: string; table?: string };
            cart: CartItem[];
            easterEggAttachment?: {
                rasterWidth?: number;
                rasterHeight?: number;
                rasterData?: Buffer;
                printedAt?: Date | string;
            };
        } | null);
        if (!order) return;

        const idempotencyPrefix = options?.idempotencyScope?.trim()
            ? `${options.idempotencyScope.trim()}:${order._id.toString()}`
            : undefined;
        if (idempotencyPrefix && order.status !== "PAID") return [];
        if (idempotencyPrefix && order.sumupPrintCompletedAt) return [];
        const eventId = order.eventId?.toString();
        const printIntentKey = (suffix: string) => idempotencyPrefix
            ? `${idempotencyPrefix}:${suffix}`
            : undefined;
        const completeSumUpPrintIntents = async (results: PrintDispatchResult[]) => {
            if (!idempotencyPrefix || !eventId || results.some((result) => result === "RETRY_REQUIRED" || result === "RECOVERY_PENDING")) return;
            if (results.length > 0) {
                await completeSumUpPrintIntentsIfSent(eventId, order._id.toString());
                return;
            }
            await Order.updateOne(
                { _id: order._id, status: "PAID", sumupPrintCompletedAt: { $exists: false } },
                { $set: { sumupPrintCompletedAt: new Date() } }
            );
        };

        const event = eventId
            ? await Event.findById(eventId).select("name settings.menuHeaderLogoUrl settings.receiptHeaderLogoUrl").lean() as ({ name?: string; settings?: { menuHeaderLogoUrl?: string; receiptHeaderLogoUrl?: string } } | null)
            : null;
        const eventName = event?.name?.trim() || undefined;
        const brandingLogoUrl = sanitizeReceiptHeaderLogoUrl(event?.settings?.receiptHeaderLogoUrl)
            || sanitizePrintableHeaderLogoUrl(event?.settings?.menuHeaderLogoUrl);

        let cashierPrinter: PrinterDestinationRef | undefined;
        if (posDeviceId) {
            const device = await PosDevice.findById(posDeviceId).populate("printerId").lean() as ({
                printerId?: {
                    _id?: unknown;
                    ip?: string;
                    port?: number;
                    isVirtual?: boolean;
                    emulatorSlot?: number;
                };
            } | null);

            if (device?.printerId) {
                cashierPrinter = {
                    id: device.printerId._id ? String(device.printerId._id) : undefined,
                    ip: device.printerId.ip,
                    port: device.printerId.port || DEFAULT_PRINTER_PORT,
                    isVirtual: Boolean(device.printerId.isVirtual),
                    emulatorSlot: device.printerId.emulatorSlot
                };
            }
        }

        const productIds = Array.from(new Set(
            order.cart.flatMap((item) => {
                const directProductId = String(item.productId);
                const includedProductIds = Array.isArray(item.includedComponents)
                    ? item.includedComponents.map((component) => String(component.productId))
                    : [];
                return [directProductId, ...includedProductIds];
            })
        ));
        const products = await Product.find({ _id: { $in: productIds } }).lean() as Array<{
            _id: { toString(): string };
            categoryId: { toString(): string };
            basePrice?: number;
            shortName?: string;
            splitKitchenPrintPerUnit?: boolean;
        }>;
        const productById = new Map(products.map((product) => [product._id.toString(), product]));
        const resolvePrintName = (productId: unknown, snapshotName: string) => {
            const foundProduct = productById.get(String(productId));
            const shortName = foundProduct?.shortName?.trim();
            return shortName && shortName.length > 0 ? shortName : snapshotName;
        };

        const categoryIdsFromProducts = Array.from(new Set(products.map((product) => product.categoryId.toString())));
        const categories = await Category.find({ _id: { $in: categoryIdsFromProducts } }).populate("printerId").lean() as Array<{
            _id: { toString(): string };
            name?: string;
            skipKitchenPrint?: boolean;
            printKitchenCopyAtCashier?: boolean;
            pizzaFlowEnabled?: boolean;
            pizzaBarcodeEnabled?: boolean;
            printerId?: {
                _id?: unknown;
                name?: string;
                ip?: string;
                port?: number;
                isVirtual?: boolean;
                emulatorSlot?: number;
                type?: "CASHIER" | "KITCHEN";
            };
        }>;

        const categoryById = new Map(categories.map((category) => [category._id.toString(), category]));
        const kitchenJobsByGroup = new Map<string, PrinterCommandJob>();
        const customerJobsByGroup = new Map<string, PrinterCommandJob>();
        const involvedDepartments = new Set<string>();
        const orderCode = getOrderCodeFromOrder({
            pickupNumber: order.pickupNumber,
            _id: order._id.toString()
        });
        const allOrderItems = order.cart.map((item) => ({
            name: resolvePrintName(item.productId, item.snapshotName),
            quantity: item.quantity,
            notes: item.customKitchenNotes
        }));

        const cashierReceiptItems = order.cart.map((item) => {
            const product = productById.get(item.productId.toString());
            const basePrice = Number.isFinite(item.unitBasePrice) ? Number(item.unitBasePrice) : Number(product?.basePrice || 0);
            const optionsTotal = (item.selectedOptions || []).reduce(
                (sum, option) => sum + Number(option.priceVariation || 0),
                0
            );
            const unitPrice = Number((basePrice + optionsTotal).toFixed(2));
            const lineTotal = Number.isFinite(item.lineTotal)
                ? Number(item.lineTotal)
                : Number((unitPrice * item.quantity).toFixed(2));
            return {
                name: resolvePrintName(item.productId, item.snapshotName),
                quantity: item.quantity,
                notes: item.customKitchenNotes,
                unitPrice,
                lineTotal,
                selectedOptions: item.selectedOptions || []
            };
        });

        const expandedDepartmentItems = order.cart.flatMap((item) => {
            if (Array.isArray(item.includedComponents) && item.includedComponents.length > 0) {
                return item.includedComponents.map((component) => ({
                    productId: component.productId,
                    snapshotName: component.snapshotName,
                    quantity: component.quantity * item.quantity,
                    notes: item.customKitchenNotes,
                    splitPrintPerUnit: item.splitPrintPerUnit,
                }));
            }

            return [{
                productId: item.productId,
                snapshotName: item.snapshotName,
                quantity: item.quantity,
                notes: item.customKitchenNotes,
                splitPrintPerUnit: item.splitPrintPerUnit,
            }];
        });
        let splitSequence = 0;
        const departmentItemsForPrinting = expandedDepartmentItems.flatMap((item) => {
            const product = productById.get(String(item.productId));
            if (!product) return [];

            const normalizedQuantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
            if (!product.splitKitchenPrintPerUnit && !item.splitPrintPerUnit) {
                return [{
                    ...item,
                    quantity: normalizedQuantity,
                    splitSequence: undefined as number | undefined
                }];
            }

            return Array.from({ length: normalizedQuantity }, () => ({
                ...item,
                quantity: 1,
                splitSequence: splitSequence++
            }));
        });

        const dishTicketsByProductId = new Map<string, number[]>();
        (order.dishTickets || []).forEach((ticket) => {
                const productId = ticket.productId?.toString() || "";
                const pizzaNumber = Number(ticket.pizzaNumber);
                if (!productId || !Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return;
                const numbers = dishTicketsByProductId.get(productId) || [];
                numbers.push(pizzaNumber);
                dishTicketsByProductId.set(productId, numbers);
            });
        const dishTicketCursorByProductId = new Map<string, number>();
        const dishNumberByPrintGroup = new Map<string, number>();

        const cashierJob: PrinterCommandJob = {
            ip: cashierPrinter?.ip || "",
            port: cashierPrinter?.port || DEFAULT_PRINTER_PORT,
            printerId: cashierPrinter?.id,
            eventId,
            source: "ORDER",
            printType: "CUSTOMER_ORDER",
            isVirtual: Boolean(cashierPrinter?.isVirtual),
            emulatorSlot: cashierPrinter?.emulatorSlot,
            title: "COMANDA CLIENTE",
            eventName,
            copyLabel: "COPIA CLIENTE",
            brandingLogoUrl,
            items: allOrderItems,
            customerName: order.customer?.name,
            tableNumber: order.customer?.table,
            orderId: order._id.toString(),
            shortCode: orderCode || undefined,
        };

        const ensureCustomerJob = (groupKey: string, footerLines?: string[]) => {
            if (!cashierJob.ip) return null;
            const existingJob = customerJobsByGroup.get(groupKey);
            if (!existingJob) {
                const createdJob: PrinterCommandJob = {
                    ...cashierJob,
                    items: [],
                    idempotencyKey: printIntentKey(`customer:${groupKey}`),
                    footerLines
                };
                customerJobsByGroup.set(groupKey, createdJob);
                return createdJob;
            }
            return existingJob;
        };

        departmentItemsForPrinting.forEach((item) => {
            const product = productById.get(String(item.productId));
            if (!product) return;

            const category = categoryById.get(product.categoryId.toString());
            if (category?.skipKitchenPrint) return;

            const kitchenPrinter = category?.printerId;
            const categoryId = category?._id.toString() || product.categoryId.toString();
            const categoryName = category?.name?.trim();
            const printerName = kitchenPrinter?.name?.trim();
            const isNumberedCategory = Boolean(category?.pizzaFlowEnabled);
            const shouldPrintDishBarcode = isNumberedCategory && Boolean(category?.pizzaBarcodeEnabled);
            const printFlowKey = isNumberedCategory ? `dish:${String(item.productId)}` : "standard";
            const baseGroupKey = kitchenPrinter?._id
                ? `printer:${String(kitchenPrinter._id)}`
                : `category:${categoryId}`;
            const baseCustomerGroupKey = typeof item.splitSequence === "number"
                ? `${baseGroupKey}:unit:${item.splitSequence}`
                : baseGroupKey;
            const customerGroupKey = `${baseCustomerGroupKey}:${printFlowKey}`;
            let pizzaNumber = dishNumberByPrintGroup.get(customerGroupKey);
            if (isNumberedCategory && typeof pizzaNumber !== "number") {
                const productId = String(item.productId);
                const cursor = dishTicketCursorByProductId.get(productId) || 0;
                pizzaNumber = dishTicketsByProductId.get(productId)?.[cursor];
                if (typeof pizzaNumber === "number") {
                    dishTicketCursorByProductId.set(productId, cursor + 1);
                    dishNumberByPrintGroup.set(customerGroupKey, pizzaNumber);
                }
            }
            const departmentLabel = printerName || categoryName || resolvePrintName(item.productId, item.snapshotName);
            if (departmentLabel) involvedDepartments.add(departmentLabel);

            const destinations: Array<PrinterDestinationRef & { groupKey: string; queueRecoverable: boolean }> = [];
            if (kitchenPrinter?.ip) {
                destinations.push({
                    groupKey: `department:${String(kitchenPrinter._id || kitchenPrinter.ip)}`,
                    ip: kitchenPrinter.ip,
                    port: kitchenPrinter.port || DEFAULT_PRINTER_PORT,
                    emulatorSlot: kitchenPrinter.emulatorSlot,
                    id: kitchenPrinter._id ? String(kitchenPrinter._id) : undefined,
                    isVirtual: Boolean(kitchenPrinter.isVirtual),
                    queueRecoverable: kitchenPrinter.type === "KITCHEN"
                });
            }
            if (category?.printKitchenCopyAtCashier && cashierPrinter?.ip) {
                destinations.push({
                    groupKey: `cashier:${cashierPrinter.id || cashierPrinter.ip}`,
                    ip: cashierPrinter.ip,
                    port: cashierPrinter.port || DEFAULT_PRINTER_PORT,
                    emulatorSlot: cashierPrinter.emulatorSlot,
                    id: cashierPrinter.id,
                    isVirtual: Boolean(cashierPrinter.isVirtual),
                    queueRecoverable: false
                });
            }

            const departmentFooterLines = departmentLabel ? [`REPARTO: ${departmentLabel}`] : undefined;
            let hasKitchenJob = false;
            destinations.forEach((destination) => {
                const kitchenGroupKey = `${customerGroupKey}:${destination.groupKey}`;
                let kitchenJob = kitchenJobsByGroup.get(kitchenGroupKey);
                if (!kitchenJob && destination.ip) {
                    kitchenJob = {
                        ip: destination.ip,
                        port: destination.port,
                        emulatorSlot: destination.emulatorSlot,
                        printerId: destination.id,
                        eventId,
                        queueRecoverable: destination.queueRecoverable,
                        idempotencyKey: printIntentKey(`kitchen:${kitchenGroupKey}`),
                        source: "ORDER",
                        printType: "KITCHEN_ORDER",
                        isVirtual: destination.isVirtual,
                        title: "COMANDA REPARTO",
                        eventName,
                        copyLabel: "COPIA REPARTO",
                        brandingLogoUrl,
                        items: [],
                        customerName: order.customer?.name,
                        tableNumber: order.customer?.table,
                        orderId: order._id.toString(),
                        shortCode: cashierJob.shortCode,
                        footerLines: departmentFooterLines
                    };
                    kitchenJobsByGroup.set(kitchenGroupKey, kitchenJob);
                }

                if (!kitchenJob) return;
                hasKitchenJob = true;
                if (typeof pizzaNumber === "number") {
                    kitchenJob.pizzaNumber = pizzaNumber;
                    kitchenJob.pizzaBarcodeValue = shouldPrintDishBarcode
                        ? getPizzaBarcodeValue(pizzaNumber)
                        : undefined;
                }
                kitchenJob.items.push({
                    name: resolvePrintName(item.productId, item.snapshotName),
                    quantity: item.quantity,
                    notes: item.notes
                });
            });

            const customerJob = ensureCustomerJob(customerGroupKey, departmentFooterLines);
            if (typeof pizzaNumber === "number" && customerJob) {
                customerJob.pizzaNumber = pizzaNumber;
                if (!hasKitchenJob && shouldPrintDishBarcode) {
                    customerJob.pizzaBarcodeValue = getPizzaBarcodeValue(pizzaNumber);
                }
            }
            customerJob?.items.push({
                name: resolvePrintName(item.productId, item.snapshotName),
                quantity: item.quantity,
                notes: item.notes
            });
        });

        const involvedDepartmentsLine = involvedDepartments.size > 0
            ? `REPARTI COINVOLTI: ${Array.from(involvedDepartments).sort((a, b) => a.localeCompare(b, "it")).join(", ")}`
            : undefined;
        if (involvedDepartmentsLine) {
            cashierJob.footerLines = [involvedDepartmentsLine];
            kitchenJobsByGroup.forEach((job) => {
                job.footerLines = [...(job.footerLines || []), involvedDepartmentsLine];
            });
            customerJobsByGroup.forEach((job) => {
                job.footerLines = [...(job.footerLines || []), involvedDepartmentsLine];
            });
        }

        const printJobs: Array<{ job: PrinterCommandJob; copies: number }> = [];
        if (cashierJob.items.length > 0 && cashierJob.ip) {
            const summaryJob: PrinterCommandJob = {
                ...cashierJob,
                idempotencyKey: printIntentKey("cashier-summary"),
                printType: "CASHIER_SUMMARY",
                title: "SCONTRINO CASSA",
                copyLabel: "COPIA CASSA",
                items: cashierReceiptItems,
                pizzaNumber: undefined,
                pizzaBarcodeValue: undefined,
                totals: [
                    { label: "TOTALE", value: formatEuroReceipt(order.totalAmount || 0), emphasis: "strong" },
                    { label: "PAGAMENTO", value: formatPaymentMethod(order.paymentMethod) },
                    { label: "STATO", value: (order.status || "-").toUpperCase() }
                ]
            };
            printJobs.push({ job: summaryJob, copies: 1 });
        }

        kitchenJobsByGroup.forEach((job) => {
            printJobs.push({ job, copies: 1 });
        });

        Array.from(customerJobsByGroup.values())
            .filter((job) => job.items.length > 0)
            .forEach((job) => {
                printJobs.push({ job, copies: 1 });
            });

        const results = await this.dispatchJobsSequentiallyPerDestination(
            printJobs,
            options?.ensureEventOperationOwned
        );

        const attachment = order.easterEggAttachment;
        const attachmentRasterData = this.normalizeBinaryPayload(attachment?.rasterData);
        const attachmentRasterWidth = Number(attachment?.rasterWidth || 0);
        const attachmentRasterHeight = Number(attachment?.rasterHeight || 0);
        const shouldPrintEasterEgg = order.status === "PAID"
            && attachmentRasterData
            && attachmentRasterWidth > 0
            && attachmentRasterHeight > 0
            && !attachment?.printedAt;

        if (!shouldPrintEasterEgg) {
            await completeSumUpPrintIntents(results);
            return results;
        }

        const rasterDestinationKey = resolvePrinterDestination({
            ip: cashierPrinter?.ip,
            port: cashierPrinter?.port || DEFAULT_PRINTER_PORT,
            isVirtual: cashierPrinter?.isVirtual,
            emulatorSlot: cashierPrinter?.emulatorSlot
        }).label;
        const cashierHasPriorJobs = printJobs.some(({ job }) => resolvePrinterDestination({
            ip: job.ip,
            port: job.port || DEFAULT_PRINTER_PORT,
            isVirtual: job.isVirtual,
            emulatorSlot: job.emulatorSlot
        }).label === rasterDestinationKey);

        const rasterPrinted = await this.enqueueJobForDestination(rasterDestinationKey, async () => {
            if (options?.ensureEventOperationOwned && !await options.ensureEventOperationOwned()) {
                return "RETRY_REQUIRED" as const;
            }
            if (cashierHasPriorJobs) {
                await wait(PRINTER_RASTER_AFTER_ORDER_DELAY_MS);
            }

            return await this.printRasterImage({
                ip: cashierPrinter?.ip || "",
                port: cashierPrinter?.port || DEFAULT_PRINTER_PORT,
                emulatorSlot: cashierPrinter?.emulatorSlot,
                printerId: cashierPrinter?.id,
                eventId,
                orderId: order._id.toString(),
                source: "ORDER",
                printType: "EASTER_EGG_IMAGE",
                idempotencyKey: printIntentKey("easter-egg"),
                isVirtual: Boolean(cashierPrinter?.isVirtual),
                title: "Easter Egg Cliente",
                eventName,
                brandingLogoUrl,
                copyLabel: "FOTO CLIENTE",
                footerLines: [`ORDINE N° ${orderCode}`]
            }, {
                width: attachmentRasterWidth,
                height: attachmentRasterHeight,
                data: attachmentRasterData
            }, 1, !cashierPrinter?.ip?.trim()
                ? { immediateFailureReason: "No cashier printer destination defined" }
                : undefined);
        });

        results.push(rasterPrinted);

        if (rasterPrinted === true) {
            await Order.updateOne(
                { _id: order._id },
                {
                    $set: {
                        "easterEggAttachment.printedAt": new Date()
                    },
                    $unset: {
                        "easterEggAttachment.rasterData": 1,
                        "easterEggAttachment.uploadTokenHash": 1
                    }
                }
            );
        }

        await completeSumUpPrintIntents(results);
        return results;
    }

    static async printCashSessionSummary(eventId: string, posDeviceId: string, summary: CashSessionClosingPrintSummary, documentOverride?: PrintDocumentV2) {
        if (!eventId || !posDeviceId) return false;

        await dbConnect();
        const [device, event] = await Promise.all([
            PosDevice.findOne({ _id: posDeviceId, eventId })
                .populate("printerId")
                .lean() as Promise<{
                    name?: string;
                    printerId?: {
                        _id?: unknown;
                        ip?: string;
                        port?: number;
                        isVirtual?: boolean;
                        emulatorSlot?: number;
                    };
                } | null>,
            Event.findById(eventId).select("name settings.menuHeaderLogoUrl settings.receiptHeaderLogoUrl").lean() as Promise<{ name?: string; settings?: { menuHeaderLogoUrl?: string; receiptHeaderLogoUrl?: string } } | null>
        ]);

        const resolvedDestination = resolvePrinterDestination({
            ip: device?.printerId?.ip,
            port: device?.printerId?.port || DEFAULT_PRINTER_PORT,
            isVirtual: device?.printerId?.isVirtual,
            emulatorSlot: device?.printerId?.emulatorSlot
        });
        const printerHost = resolvedDestination.host;
        const printerPort = resolvedDestination.port;
        const printerLabel = resolvedDestination.label;
        const printerId = device?.printerId?._id ? String(device.printerId._id) : undefined;
        const isVirtual = Boolean(device?.printerId?.isVirtual);

        const document = documentOverride || buildCashSessionPrintDocumentV2({
            sessionId: summary.sessionId,
            isTest: summary.isTest,
            eventName: event?.name,
            posDeviceName: summary.posDeviceName || device?.name,
            openedAt: summary.openedAt,
            closedAt: summary.closedAt,
            openingFloatAmount: summary.openingFloatAmount,
            cashSalesAmount: summary.cashSalesAmount,
            cardSalesAmount: summary.cardSalesAmount,
            otherSalesAmount: summary.otherSalesAmount,
            expectedCashAmount: summary.expectedCashAmount,
            closingCountedCashAmount: summary.closingCountedCashAmount,
            varianceAmount: summary.varianceAmount,
            paidOrdersCount: summary.paidOrdersCount,
            openingNotes: summary.openingNotes,
            closingNotes: summary.closingNotes,
            grossSalesAmount: summary.grossSalesAmount,
            discountSalesAmount: summary.discountSalesAmount,
            discountSummaries: summary.discountSummaries,
            items: summary.items,
            brandingLogoUrl: sanitizeReceiptHeaderLogoUrl(event?.settings?.receiptHeaderLogoUrl)
                || sanitizePrintableHeaderLogoUrl(event?.settings?.menuHeaderLogoUrl)
        });

        const log = await this.createPrintJobLog({
            eventId,
            printerId,
            source: "CASH_SESSION",
            printType: "CASH_SESSION_SUMMARY",
            status: "QUEUED",
            destinationHost: printerHost || "unknown",
            destinationPort: printerPort,
            isVirtual,
            copies: 1,
            document: document as unknown as Record<string, unknown>
        });
        const logId = log.id;

        if (!printerHost) {
            console.warn(`No cashier printer configured for POS ${posDeviceId}`);
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: "No cashier printer configured"
            });
            return false;
        }

        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: toTcpPrinterInterface(printerHost, printerPort),
            characterSet: getPrinterCharacterSet(),
            removeSpecialCharacters: false,
            lineCharacter: "=",
        });

        let isConnected = false;
        try {
            isConnected = await this.waitForPrinterReachable(printer, PRINTER_CONNECT_TIMEOUT_MS);
        } catch (error) {
            console.error(`Cash session printer connection check error at ${printerLabel}:`, error);
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: "Printer connection timeout"
            });
            return false;
        }

        if (!isConnected) {
            console.error(`Cash session summary printer at ${printerLabel} is not reachable`);
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: "Printer not reachable"
            });
            return false;
        }

        const normalizedDocument = normalizeLegacyPrintDocument(document as unknown as Record<string, unknown>);
        const hasLogo = await this.tryPrintLogo(printer, normalizedDocument, "CASH_SESSION_SUMMARY");
        await this.renderPrintDocument(printer, normalizedDocument, !hasLogo);

        try {
            const executeStartedAt = new Date();
            await this.executeWithConnectionRetry(printer, PRINTER_EXECUTE_TIMEOUT_MS);
            console.log(`Cash session summary print sent to ${printerLabel} successfully`);
            const rawCapturePath = isVirtual
                ? await this.resolveVirtualRawCapturePath(printerPort, executeStartedAt)
                : undefined;
            await this.updatePrintJobLog(logId, { status: "SENT", rawCapturePath });
            return true;
        } catch (error) {
            console.error(`Cash session summary printer execution error at ${printerLabel}:`, error);
            const message = this.isTimeoutError(error)
                ? "Printer execution timeout"
                : this.isConnectionRefusedError(error)
                    ? "Printer not reachable"
                : "Printer execution error";
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: message
            });
            return false;
        }
    }

    static async retryPrintJobById(eventId: string, jobId: string) {
        if (!eventId || !jobId) {
            return { success: false, error: "Parametri mancanti" } as const;
        }

        await dbConnect();
        const retryClaimedAt = new Date();
        let kitchenLease: ReturnType<typeof buildPrintQueueLease> | null = null;
        let kitchenLeasePrinterId: unknown;
        let kitchenLeaseClaimed = false;

        try {
            const job = await PrintJobModel.findOneAndUpdate(
                { _id: jobId, eventId, status: "FAILED" },
                { $set: { status: "QUEUED", retryClaimedAt } },
                { returnDocument: "after" }
            )
                .populate("printerId", "ip port isVirtual emulatorSlot")
                .lean() as ({
                    _id: { toString(): string };
                    eventId: { toString(): string };
                    printerId?: {
                        _id?: unknown;
                        ip?: string;
                        port?: number;
                        isVirtual?: boolean;
                        emulatorSlot?: number;
                    } | null;
                    orderId?: { toString(): string } | null;
                    source: PrintJobSource;
                    printType: PrintJobType;
                    queueRecoverable?: boolean;
                    copies?: number;
                    destinationHost?: string;
                    destinationPort?: number;
                    isVirtual?: boolean;
                    document?: Record<string, unknown>;
                } | null);

            if (!job) {
                return { success: false, error: "Job non disponibile o già acquisito" } as const;
            }

            const document = (job.document && typeof job.document === "object")
                ? job.document as Record<string, unknown>
                : {};

            if (job.source === "ORDER" && job.printType === "KITCHEN_ORDER" && job.queueRecoverable) {
                kitchenLeasePrinterId = job.printerId?._id;
                if (!kitchenLeasePrinterId) {
                    await PrintJobModel.updateOne(
                        { _id: job._id, eventId, status: "QUEUED", retryClaimedAt },
                        {
                            $set: { status: "FAILED", errorMessage: "Stampante reparto non disponibile" },
                            $unset: { retryClaimedAt: 1 }
                        }
                    );
                    return { success: false, error: "Stampante reparto non disponibile" } as const;
                }

                kitchenLease = buildPrintQueueLease();
                kitchenLeaseClaimed = await claimKitchenPrinterQueueLease(
                    kitchenLeasePrinterId,
                    kitchenLease.token,
                    kitchenLease.expiresAt
                );
                let retryBlockedError: string | null = null;
                if (!kitchenLeaseClaimed) {
                    retryBlockedError = "La stampante sta già inviando una comanda. Riprova tra poco.";
                } else if (await PrintJobModel.exists({
                    eventId,
                    printerId: kitchenLeasePrinterId,
                    source: "ORDER",
                    printType: "KITCHEN_ORDER",
                    queueRecoverable: true,
                    status: { $in: ["HELD", "QUEUED"] },
                    heldSince: { $exists: true }
                })) {
                    retryBlockedError = "Ci sono già stampe reparto in coda. Attendi il completamento prima di riprovare.";
                }

                if (retryBlockedError) {
                    await PrintJobModel.updateOne(
                        { _id: job._id, eventId, status: "QUEUED", retryClaimedAt },
                        {
                            $set: { status: "FAILED", errorMessage: retryBlockedError },
                            $unset: { retryClaimedAt: 1 }
                        }
                    );
                    return { success: false, error: retryBlockedError } as const;
                }
            }

            if (job.printType === "CASH_SESSION_SUMMARY") {
                const destination = resolvePrinterDestination({
                    ip: job.printerId?.ip || asString(job.destinationHost),
                    port: job.printerId?.port || job.destinationPort || DEFAULT_PRINTER_PORT,
                    isVirtual: typeof job.printerId?.isVirtual === "boolean" ? job.printerId.isVirtual : Boolean(job.isVirtual),
                    emulatorSlot: job.printerId?.emulatorSlot
                });
                if (!destination.host) {
                    await this.updatePrintJobLog(job._id.toString(), { status: "FAILED", errorMessage: "Destinazione stampante non disponibile", clearRetryClaim: true });
                    return { success: false, error: "Destinazione stampante non disponibile" } as const;
                }
                const dispatchResult = await this.dispatchPrintDocumentWithAutomaticRetry({
                    destinationHost: destination.host,
                    destinationPort: destination.port,
                    destinationLabel: destination.label,
                    printType: "CASH_SESSION_SUMMARY",
                    document: normalizeLegacyPrintDocument(document),
                    isVirtual: typeof job.printerId?.isVirtual === "boolean" ? job.printerId.isVirtual : Boolean(job.isVirtual),
                    copies: job.copies || 1
                });
                await this.updatePrintJobLog(job._id.toString(), dispatchResult.success
                    ? {
                        status: "SENT",
                        rawCapturePath: dispatchResult.rawCapturePath,
                        automaticRetryCount: dispatchResult.automaticRetryCount,
                        clearRetryClaim: true
                    }
                    : {
                        status: "FAILED",
                        errorMessage: dispatchResult.errorMessage,
                        automaticRetryCount: dispatchResult.automaticRetryCount,
                        clearRetryClaim: true
                    });
                if (dispatchResult.success) {
                    await completeSumUpPrintIntentsForSentJob(eventId, job._id.toString());
                }
                return dispatchResult.success
                    ? { success: true } as const
                    : { success: false, error: "Invio stampa fallito" } as const;
            }

            if (job.printType === "EASTER_EGG_IMAGE") {
                const orderAttachment = job.orderId
                    ? await Order.findOne({ _id: job.orderId, eventId })
                        .select("easterEggAttachment")
                        .lean() as ({
                            easterEggAttachment?: {
                                rasterWidth?: number;
                                rasterHeight?: number;
                                rasterData?: Buffer;
                            };
                        } | null)
                    : null;

                const orderAttachmentRasterWidth = Number(orderAttachment?.easterEggAttachment?.rasterWidth || 0);
                const orderAttachmentRasterHeight = Number(orderAttachment?.easterEggAttachment?.rasterHeight || 0);
                const attachmentRasterBuffer = this.normalizeBinaryPayload(orderAttachment?.easterEggAttachment?.rasterData);
                const attachmentRaster = attachmentRasterBuffer
                    && orderAttachmentRasterWidth > 0
                    && orderAttachmentRasterHeight > 0
                    ? {
                        width: orderAttachmentRasterWidth,
                        height: orderAttachmentRasterHeight,
                        data: attachmentRasterBuffer
                    }
                    : null;
                const imageUrl = asString(document.imageUrl);
                const raster = attachmentRaster || (imageUrl
                    ? await preparePrintableEasterEggRasterFromUrl(
                        imageUrl,
                        document.crop as Record<string, unknown> | undefined,
                        document.processing as Record<string, unknown> | undefined
                    )
                    : undefined);

                if (!raster) {
                    await this.updatePrintJobLog(job._id.toString(), { status: "FAILED", errorMessage: "Immagine easter egg non più disponibile", clearRetryClaim: true });
                    return { success: false, error: "Immagine easter egg non più disponibile" } as const;
                }

                const destination = resolvePrinterDestination({
                    ip: job.printerId?.ip || asString(job.destinationHost),
                    port: job.printerId?.port || job.destinationPort || DEFAULT_PRINTER_PORT,
                    emulatorSlot: job.printerId?.emulatorSlot,
                    isVirtual: typeof job.printerId?.isVirtual === "boolean" ? job.printerId.isVirtual : Boolean(job.isVirtual)
                });
                if (!destination.host) {
                    await this.updatePrintJobLog(job._id.toString(), { status: "FAILED", errorMessage: "Destinazione stampante non disponibile", clearRetryClaim: true });
                    return { success: false, error: "Destinazione stampante non disponibile" } as const;
                }
                const dispatchResult = await this.dispatchRasterImageWithAutomaticRetry({
                    destinationHost: destination.host,
                    destinationPort: destination.port,
                    destinationLabel: destination.label,
                    document: normalizeLegacyPrintDocument(document),
                    raster,
                    isVirtual: typeof job.printerId?.isVirtual === "boolean" ? job.printerId.isVirtual : Boolean(job.isVirtual),
                    copies: job.copies || 1
                });
                await this.updatePrintJobLog(job._id.toString(), dispatchResult.success
                    ? { status: "SENT", rawCapturePath: dispatchResult.rawCapturePath, automaticRetryCount: dispatchResult.automaticRetryCount, clearRetryClaim: true }
                    : { status: "FAILED", errorMessage: dispatchResult.errorMessage, automaticRetryCount: dispatchResult.automaticRetryCount, clearRetryClaim: true });
                if (dispatchResult.success) {
                    await completeSumUpPrintIntentsForSentJob(eventId, job._id.toString());
                }
                return dispatchResult.success
                    ? { success: true } as const
                    : { success: false, error: "Invio stampa fallito" } as const;
            }

            const destination = resolvePrinterDestination({
                ip: job.printerId?.ip || asString(job.destinationHost),
                port: job.printerId?.port || job.destinationPort || DEFAULT_PRINTER_PORT,
                emulatorSlot: job.printerId?.emulatorSlot,
                isVirtual: typeof job.printerId?.isVirtual === "boolean" ? job.printerId.isVirtual : Boolean(job.isVirtual)
            });
            if (!destination.host) {
                await this.updatePrintJobLog(job._id.toString(), { status: "FAILED", errorMessage: "Destinazione stampante non disponibile", clearRetryClaim: true });
                return { success: false, error: "Destinazione stampante non disponibile" } as const;
            }
            const dispatchResult = await this.dispatchPrintDocumentWithAutomaticRetry({
                destinationHost: destination.host,
                destinationPort: destination.port,
                destinationLabel: destination.label,
                printType: job.printType,
                document: normalizeLegacyPrintDocument(document),
                isVirtual: typeof job.printerId?.isVirtual === "boolean" ? job.printerId.isVirtual : Boolean(job.isVirtual),
                copies: job.copies || 1
            });
            await this.updatePrintJobLog(job._id.toString(), dispatchResult.success
                ? { status: "SENT", rawCapturePath: dispatchResult.rawCapturePath, automaticRetryCount: dispatchResult.automaticRetryCount, clearRetryClaim: true }
                : { status: "FAILED", errorMessage: dispatchResult.errorMessage, automaticRetryCount: dispatchResult.automaticRetryCount, clearRetryClaim: true });
            if (dispatchResult.success) {
                await completeSumUpPrintIntentsForSentJob(eventId, job._id.toString());
            }
            return dispatchResult.success
                ? { success: true } as const
                : { success: false, error: "Invio stampa fallito" } as const;
        } catch (error) {
            console.error(`Retry print job ${jobId} failed unexpectedly:`, error);
            try {
                await PrintJobModel.updateOne(
                    { _id: jobId, eventId, status: "QUEUED", retryClaimedAt },
                    {
                        $set: { status: "FAILED", errorMessage: "Reinvio stampa interrotto" },
                        $unset: { retryClaimedAt: 1 }
                    }
                );
            } catch (updateError) {
                console.error(`Unable to recover retry claim for print job ${jobId}:`, updateError);
            }
            return { success: false, error: "Reinvio stampa interrotto" } as const;
        } finally {
            if (kitchenLease && kitchenLeaseClaimed && kitchenLeasePrinterId) {
                try {
                    await releaseKitchenPrinterQueueLease(kitchenLeasePrinterId, kitchenLease.token);
                } catch (error) {
                    console.error(`Unable to release printer queue lease after retry ${jobId}:`, error);
                }
            }
        }
    }
}
