import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import fs from "node:fs/promises";
import path from "node:path";
import Order from "@/models/Order";
import Product from "@/models/Product";
import Category from "@/models/Category";
import PosDevice from "@/models/PosDevice";
import Event from "@/models/Event";
import PrintJobModel, { type PrintJobSource, type PrintJobType } from "@/models/PrintJob";
import mongoose from "mongoose";
import dbConnect from "./mongoose";
import { getOrderCodeFromOrder } from "./order-code";
import {
    DEFAULT_PRINTER_PORT,
    resolvePrinterDestination,
    toTcpPrinterInterface
} from "./printer-config";
import {
    buildCashSessionPrintDocumentV2,
    buildOrderPrintDocumentV2,
    normalizeLegacyPrintDocument,
    toOrderJobPayloadFromDocument,
    type PrintDocumentV2
} from "./print-report";
import {
    resolvePrintableLogoPathFromUrl,
    sanitizePrintableHeaderLogoUrl,
    sanitizeReceiptHeaderLogoUrl
} from "./print-branding";

export interface PrinterCommandJob {
    ip: string;
    port?: number;
    emulatorSlot?: number;
    printerId?: string;
    eventId?: string;
    source?: PrintJobSource;
    printType?: PrintJobType;
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
    footerLines?: string[];
}

export interface CashSessionClosingPrintSummary {
    sessionId: string;
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
}

interface CartItem {
    productId: string;
    snapshotName: string;
    quantity: number;
    customKitchenNotes?: string;
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

function formatPaymentMethod(value: string | undefined): string {
    if (value === "CASH") return "Contanti";
    if (value === "CARD") return "Carta / POS";
    if (value === "OTHER") return "Altro";
    return "-";
}

const PRINTER_CONNECT_TIMEOUT_MS = 4000;
const PRINTER_EXECUTE_TIMEOUT_MS = 7000;
const RECEIPT_SEPARATOR = "--------------------------------";
const PRINTER_EMULATOR_OUTPUT_DIR = process.env.PRINTER_EMULATOR_OUTPUT_DIR || "/tmp/osgfest-printer-emulator";

function formatEuroReceipt(amount: number | undefined): string {
    const safeAmount = Number.isFinite(amount) ? Number(amount) : 0;
    return `${safeAmount.toFixed(2)} EUR`;
}

function formatAmountNoCurrency(amount: number | undefined): string {
    const safeAmount = Number.isFinite(amount) ? Number(amount) : 0;
    return safeAmount.toFixed(2);
}

function padRight(value: string, width: number): string {
    if (value.length >= width) return value;
    return `${value}${" ".repeat(width - value.length)}`;
}

function padLeft(value: string, width: number): string {
    if (value.length >= width) return value;
    return `${" ".repeat(width - value.length)}${value}`;
}

function splitByLength(value: string, max: number): string[] {
    const clean = value.trim();
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

export class PrinterService {
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
        const slot = destinationPort - 19099;
        if (!Number.isInteger(slot) || slot < 1 || slot > 99) return undefined;
        const slotDir = path.join(PRINTER_EMULATOR_OUTPUT_DIR, `slot-${String(slot).padStart(2, "0")}`);

        try {
            const entries = await fs.readdir(slotDir, { withFileTypes: true });
            const binEntries = entries
                .filter((entry) => entry.isFile() && entry.name.endsWith(".bin"))
                .map((entry) => entry.name);
            if (binEntries.length === 0) return undefined;

            const withStats = await Promise.all(
                binEntries.map(async (name) => {
                    const filePath = path.join(slotDir, name);
                    const stat = await fs.stat(filePath);
                    return { filePath, mtime: stat.mtime.getTime() };
                })
            );

            const floorTime = startedAt.getTime() - 10_000;
            const sorted = withStats
                .filter((entry) => entry.mtime >= floorTime)
                .sort((a, b) => b.mtime - a.mtime);
            return sorted[0]?.filePath;
        } catch {
            return undefined;
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
            || printType === "MANUAL_TEST";
    }

    private static async tryPrintLogo(
        printer: ThermalPrinter,
        document: PrintDocumentV2,
        printType: PrintJobType
    ): Promise<boolean> {
        if (!this.supportsLogo(printType)) return false;
        const logoPath = resolvePrintableLogoPathFromUrl(document.branding?.logoPath);
        if (!logoPath) return false;

        try {
            await printer.printImage(logoPath);
            printer.println(" ");
            return true;
        } catch (error) {
            console.warn("Unable to print logo, using text fallback only:", error);
            return false;
        }
    }

    private static printHeader(printer: ThermalPrinter, document: PrintDocumentV2, withLargeEventTitle: boolean) {
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

    private static renderPrintDocument(printer: ThermalPrinter, document: PrintDocumentV2, withLargeEventTitle: boolean) {
        this.printHeader(printer, document, withLargeEventTitle);
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
        status?: "QUEUED" | "SENT" | "FAILED";
        destinationHost: string;
        destinationPort: number;
        isVirtual: boolean;
        copies: number;
        document: Record<string, unknown>;
        errorMessage?: string;
    }): Promise<string | undefined> {
        if (!params.eventId) return undefined;

        try {
            await dbConnect();
            const normalizedOrderId = (typeof params.orderId === "string" && mongoose.Types.ObjectId.isValid(params.orderId))
                ? params.orderId
                : undefined;
            const created = await PrintJobModel.create({
                eventId: params.eventId,
                printerId: params.printerId || undefined,
                orderId: normalizedOrderId,
                source: params.source,
                printType: params.printType,
                status: params.status || "QUEUED",
                destinationHost: params.destinationHost,
                destinationPort: params.destinationPort,
                isVirtual: params.isVirtual,
                copies: params.copies,
                document: params.document,
                errorMessage: params.errorMessage
            });
            return created._id.toString();
        } catch (error) {
            console.error("Unable to persist print job log:", error);
            return undefined;
        }
    }

    private static async updatePrintJobLog(
        id: string | undefined,
        updates: {
            status: "SENT" | "FAILED";
            errorMessage?: string;
            rawCapturePath?: string;
        }
    ) {
        if (!id) return;
        try {
            await PrintJobModel.updateOne(
                { _id: id },
                {
                    $set: {
                        status: updates.status,
                        errorMessage: updates.errorMessage || undefined,
                        rawCapturePath: updates.rawCapturePath || undefined
                    }
                }
            );
        } catch (error) {
            console.error(`Unable to update print job log ${id}:`, error);
        }
    }

    static async printComanda(job: PrinterCommandJob, copies: number = 1) {
        const printType = job.printType || "CUSTOMER_ORDER";
        const document = buildOrderPrintDocumentV2({
            printType,
            title: job.title || "COMANDA",
            eventName: job.eventName,
            copyLabel: job.copyLabel,
            orderId: job.orderId,
            shortCode: job.shortCode,
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

        const logId = await this.createPrintJobLog({
            eventId: job.eventId,
            printerId: job.printerId,
            orderId: job.orderId,
            source: job.source || "ORDER",
            printType,
            destinationHost: destinationHost || "unknown",
            destinationPort,
            isVirtual: Boolean(job.isVirtual),
            copies,
            document: document as unknown as Record<string, unknown>
        });

        if (!destinationHost) {
            console.warn(`No printer destination defined for job ${job.orderId}`);
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: "No printer destination defined"
            });
            return false;
        }

        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: toTcpPrinterInterface(destinationHost, destinationPort),
            characterSet: CharacterSet.WPC1252,
            removeSpecialCharacters: false,
            lineCharacter: "=",
        });

        let isConnected = false;
        try {
            isConnected = await this.withTimeout(
                printer.isPrinterConnected(),
                PRINTER_CONNECT_TIMEOUT_MS,
                "Printer connection timeout"
            );
        } catch (error) {
            console.error(`Printer connection check error at ${destinationLabel}:`, error);
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: "Printer connection timeout"
            });
            return false;
        }

        if (!isConnected) {
            console.error(`Printer at ${destinationLabel} is not reachable`);
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: "Printer not reachable"
            });
            return false;
        }

        const normalizedDocument = normalizeLegacyPrintDocument(document as unknown as Record<string, unknown>);
        const hasLogo = await this.tryPrintLogo(printer, normalizedDocument, printType);
        this.renderPrintDocument(printer, normalizedDocument, !hasLogo);

        try {
            const executeStartedAt = new Date();
            for (let i = 0; i < copies; i += 1) {
                await this.withTimeout(
                    printer.execute(),
                    PRINTER_EXECUTE_TIMEOUT_MS,
                    "Printer execution timeout"
                );
            }
            console.log(`Print job sent to ${destinationLabel} (${copies} copies) successfully`);
            const rawCapturePath = Boolean(job.isVirtual)
                ? await this.resolveVirtualRawCapturePath(destinationPort, executeStartedAt)
                : undefined;
            await this.updatePrintJobLog(logId, { status: "SENT", rawCapturePath });
            return true;
        } catch (error) {
            console.error(`Printer execution error at ${destinationLabel}:`, error);
            const message = error instanceof Error && error.message.toLowerCase().includes("timeout")
                ? "Printer execution timeout"
                : "Printer execution error";
            await this.updatePrintJobLog(logId, {
                status: "FAILED",
                errorMessage: message
            });
            return false;
        }
    }

    static async routeOrderToPrinters(orderId: string, posDeviceId?: string) {
        await dbConnect();
        const order = await Order.findById(orderId).lean() as ({
            _id: { toString(): string };
            eventId: { toString(): string };
            pickupNumber?: number;
            status?: string;
            paymentMethod?: string;
            totalAmount?: number;
            customer?: { name?: string; table?: string };
            cart: CartItem[];
        } | null);
        if (!order) return;

        const eventId = order.eventId?.toString();

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

        const productIds = order.cart.map((item) => item.productId);
        const products = await Product.find({ _id: { $in: productIds } }).lean() as Array<{
            _id: { toString(): string };
            categoryId: { toString(): string };
            basePrice?: number;
            shortName?: string;
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
            printerId?: {
                _id?: unknown;
                name?: string;
                ip?: string;
                port?: number;
                isVirtual?: boolean;
                emulatorSlot?: number;
            };
        }>;

        const kitchenJobsByDestination: Record<string, PrinterCommandJob> = {};
        const customerJobsByGroup: Record<string, PrinterCommandJob> = {};
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
            const basePrice = Number(product?.basePrice || 0);
            const optionsTotal = (item.selectedOptions || []).reduce(
                (sum, option) => sum + Number(option.priceVariation || 0),
                0
            );
            const unitPrice = Number((basePrice + optionsTotal).toFixed(2));
            const lineTotal = Number((unitPrice * item.quantity).toFixed(2));
            return {
                name: resolvePrintName(item.productId, item.snapshotName),
                quantity: item.quantity,
                unitPrice,
                lineTotal,
                selectedOptions: item.selectedOptions || []
            };
        });

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
            shortCode: orderCode || undefined
        };

        const ensureCustomerJob = (groupKey: string) => {
            if (!cashierJob.ip) return null;
            if (!customerJobsByGroup[groupKey]) {
                customerJobsByGroup[groupKey] = {
                    ...cashierJob,
                    items: []
                };
            }
            return customerJobsByGroup[groupKey];
        };

        order.cart.forEach((item) => {
            const product = productById.get(item.productId.toString());
            if (!product) return;

            const category = categories.find((entry) => entry._id.toString() === product.categoryId.toString());
            const kitchenPrinter = category?.printerId;

            if (kitchenPrinter?.ip) {
                const departmentName = kitchenPrinter.name?.trim();
                if (departmentName) involvedDepartments.add(departmentName);
                const resolvedDestination = resolvePrinterDestination({
                    ip: kitchenPrinter.ip,
                    port: kitchenPrinter.port || DEFAULT_PRINTER_PORT,
                    isVirtual: kitchenPrinter.isVirtual,
                    emulatorSlot: kitchenPrinter.emulatorSlot
                });
                const destinationKey = resolvedDestination.label;

                if (!kitchenJobsByDestination[destinationKey]) {
                    kitchenJobsByDestination[destinationKey] = {
                        ip: kitchenPrinter.ip,
                        port: kitchenPrinter.port || DEFAULT_PRINTER_PORT,
                        emulatorSlot: kitchenPrinter.emulatorSlot,
                        printerId: kitchenPrinter._id ? String(kitchenPrinter._id) : undefined,
                        eventId,
                        source: "ORDER",
                        printType: "KITCHEN_ORDER",
                        isVirtual: Boolean(kitchenPrinter.isVirtual),
                        title: "COMANDA REPARTO",
                        eventName,
                        copyLabel: "COPIA REPARTO",
                        brandingLogoUrl,
                        items: [],
                        customerName: order.customer?.name,
                        tableNumber: order.customer?.table,
                        orderId: order._id.toString(),
                        shortCode: cashierJob.shortCode
                    };
                }

                kitchenJobsByDestination[destinationKey].items.push({
                    name: resolvePrintName(item.productId, item.snapshotName),
                    quantity: item.quantity,
                    notes: item.customKitchenNotes
                });
                const customerJob = ensureCustomerJob(destinationKey);
                customerJob?.items.push({
                    name: resolvePrintName(item.productId, item.snapshotName),
                    quantity: item.quantity,
                    notes: item.customKitchenNotes
                });
                return;
            }

            const customerJob = ensureCustomerJob("UNASSIGNED");
            customerJob?.items.push({
                name: resolvePrintName(item.productId, item.snapshotName),
                quantity: item.quantity,
                notes: item.customKitchenNotes
            });
        });

        const involvedDepartmentsLine = involvedDepartments.size > 0
            ? `REPARTI COINVOLTI: ${Array.from(involvedDepartments).sort((a, b) => a.localeCompare(b, "it")).join(", ")}`
            : undefined;
        if (involvedDepartmentsLine) {
            cashierJob.footerLines = [involvedDepartmentsLine];
            Object.values(kitchenJobsByDestination).forEach((job) => {
                job.footerLines = [involvedDepartmentsLine];
            });
            Object.values(customerJobsByGroup).forEach((job) => {
                job.footerLines = [involvedDepartmentsLine];
            });
        }

        const printPromises: Promise<boolean>[] = [];
        if (cashierJob.items.length > 0 && cashierJob.ip) {
            const summaryJob: PrinterCommandJob = {
                ...cashierJob,
                printType: "CASHIER_SUMMARY",
                title: "SCONTRINO CASSA",
                copyLabel: "COPIA CASSA",
                items: cashierReceiptItems,
                totals: [
                    { label: "TOTALE", value: formatEuroReceipt(order.totalAmount || 0), emphasis: "strong" },
                    { label: "PAGAMENTO", value: formatPaymentMethod(order.paymentMethod) },
                    { label: "STATO", value: (order.status || "-").toUpperCase() }
                ]
            };
            printPromises.push(this.printComanda(summaryJob, 1));
        }

        Object.values(kitchenJobsByDestination).forEach((job) => {
            printPromises.push(this.printComanda(job, 1));
        });

        Object.values(customerJobsByGroup)
            .filter((job) => job.items.length > 0)
            .forEach((job) => {
                printPromises.push(this.printComanda(job, 1));
            });

        return await Promise.all(printPromises);
    }

    static async printCashSessionSummary(eventId: string, posDeviceId: string, summary: CashSessionClosingPrintSummary) {
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

        const document = buildCashSessionPrintDocumentV2({
            sessionId: summary.sessionId,
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
            brandingLogoUrl: sanitizeReceiptHeaderLogoUrl(event?.settings?.receiptHeaderLogoUrl)
                || sanitizePrintableHeaderLogoUrl(event?.settings?.menuHeaderLogoUrl)
        });

        const logId = await this.createPrintJobLog({
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
            characterSet: CharacterSet.WPC1252,
            removeSpecialCharacters: false,
            lineCharacter: "=",
        });

        let isConnected = false;
        try {
            isConnected = await this.withTimeout(
                printer.isPrinterConnected(),
                PRINTER_CONNECT_TIMEOUT_MS,
                "Printer connection timeout"
            );
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
        this.renderPrintDocument(printer, normalizedDocument, !hasLogo);

        try {
            const executeStartedAt = new Date();
            await this.withTimeout(
                printer.execute(),
                PRINTER_EXECUTE_TIMEOUT_MS,
                "Printer execution timeout"
            );
            console.log(`Cash session summary print sent to ${printerLabel} successfully`);
            const rawCapturePath = isVirtual
                ? await this.resolveVirtualRawCapturePath(printerPort, executeStartedAt)
                : undefined;
            await this.updatePrintJobLog(logId, { status: "SENT", rawCapturePath });
            return true;
        } catch (error) {
            console.error(`Cash session summary printer execution error at ${printerLabel}:`, error);
            const message = error instanceof Error && error.message.toLowerCase().includes("timeout")
                ? "Printer execution timeout"
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
        const job = await PrintJobModel.findOne({ _id: jobId, eventId })
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
                copies?: number;
                destinationHost?: string;
                destinationPort?: number;
                isVirtual?: boolean;
                document?: Record<string, unknown>;
            } | null);

        if (!job) {
            return { success: false, error: "Job non trovato" } as const;
        }

        if (job.printType === "CASH_SESSION_SUMMARY") {
            return { success: false, error: "Reinvio non supportato per chiusure cassa" } as const;
        }

        const document = (job.document && typeof job.document === "object")
            ? job.document as Record<string, unknown>
            : {};

        const payload = toOrderJobPayloadFromDocument(
            document,
            asString(document.orderId) || job.orderId?.toString() || job._id.toString()
        );

        const printJob: PrinterCommandJob = {
            ip: job.printerId?.ip || asString(job.destinationHost),
            port: job.printerId?.port || job.destinationPort || DEFAULT_PRINTER_PORT,
            emulatorSlot: job.printerId?.emulatorSlot,
            printerId: job.printerId?._id ? String(job.printerId._id) : undefined,
            eventId,
            source: job.source,
            printType: job.printType,
            isVirtual: typeof job.printerId?.isVirtual === "boolean" ? job.printerId.isVirtual : Boolean(job.isVirtual),
            title: payload.title,
            eventName: payload.eventName,
            copyLabel: payload.copyLabel,
            brandingLogoUrl: sanitizePrintableHeaderLogoUrl(payload.brandingLogoUrl),
            items: payload.items,
            totals: payload.totals,
            customerName: payload.customerName,
            tableNumber: payload.tableNumber,
            orderId: payload.orderId,
            shortCode: payload.shortCode
        };

        const printed = await this.printComanda(printJob, job.copies || 1);
        if (!printed) {
            return { success: false, error: "Invio stampa fallito" } as const;
        }

        return { success: true } as const;
    }
}
