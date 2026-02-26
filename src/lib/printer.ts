import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import Order from "@/models/Order";
import Product from "@/models/Product";
import Category from "@/models/Category";
import PosDevice from "@/models/PosDevice";
import PrintJobModel, { type PrintJobSource, type PrintJobType } from "@/models/PrintJob";
import dbConnect from "./mongoose";
import { getOrderCodeFromOrder } from "./order-code";
import {
    DEFAULT_PRINTER_PORT,
    resolvePrinterDestination,
    toTcpPrinterInterface
} from "./printer-config";

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
    }>;
    customerName?: string;
    tableNumber?: string;
    orderId: string;
    shortCode?: string;
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

function formatEuro(amount: number): string {
    return `${amount.toFixed(2)} EUR`;
}

function formatDateTime(value: Date | string | undefined): string {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleString("it-IT");
}

function formatPaymentMethod(value: string | undefined): string {
    if (value === "CASH") return "Contanti";
    if (value === "CARD") return "Carta / POS";
    if (value === "OTHER") return "Altro";
    return "-";
}

const PRINTER_CONNECT_TIMEOUT_MS = 4000;
const PRINTER_EXECUTE_TIMEOUT_MS = 7000;

function formatEuroReceipt(amount: number | undefined): string {
    const safeAmount = Number.isFinite(amount) ? Number(amount) : 0;
    return `${safeAmount.toFixed(2)} EUR`;
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

export class PrinterService {
    private static buildComandaDocument(job: PrinterCommandJob) {
        const isCashierSummary = job.printType === "CASHIER_SUMMARY";
        return {
            kind: isCashierSummary ? "CASH_RECEIPT" : "COMANDA",
            title: job.title || "COMANDA",
            shortCode: job.shortCode,
            orderId: job.orderId,
            customerName: job.customerName,
            tableNumber: job.tableNumber,
            items: job.items.map((item) => ({
                name: item.name,
                quantity: item.quantity,
                notes: item.notes,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
                selectedOptions: (item.selectedOptions || []).map((option) => ({
                    name: option.name,
                    priceVariation: option.priceVariation
                }))
            })),
            totals: (job.totals || []).map((row) => ({
                label: row.label,
                value: row.value
            })),
            createdAt: new Date().toISOString()
        };
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

    private static renderCashierReceipt(printer: ThermalPrinter, job: PrinterCommandJob) {
        const rowWidth = 40;
        const labelWidth = 26;
        const amountWidth = rowWidth - labelWidth;

        printer.alignCenter();
        printer.setTextDoubleHeight();
        printer.println("SCONTRINO CASSA");
        printer.setTextNormal();
        printer.println("--------------------------------");
        if (job.shortCode) printer.println(`ORDINE: ${job.shortCode}`);
        printer.println(`ID: ${job.orderId.slice(-6)}`);
        printer.println(new Date().toLocaleString("it-IT"));
        printer.println("--------------------------------");

        printer.alignLeft();
        if (job.customerName) printer.println(`CLIENTE: ${job.customerName}`);
        if (job.tableNumber) printer.println(`TAVOLO: ${job.tableNumber}`);
        if (job.customerName || job.tableNumber) {
            printer.println("--------------------------------");
        }

        job.items.forEach((item) => {
            splitByLength(item.name, rowWidth).forEach((line) => printer.println(line));
            const unitPrice = Number.isFinite(item.unitPrice) ? Number(item.unitPrice) : undefined;
            const lineTotal = Number.isFinite(item.lineTotal)
                ? Number(item.lineTotal)
                : (Number.isFinite(unitPrice) ? Number(unitPrice) * item.quantity : undefined);
            const left = `${item.quantity} x ${formatEuroReceipt(unitPrice)}`;
            printer.println(`${padRight(left, labelWidth)}${padLeft(formatEuroReceipt(lineTotal), amountWidth)}`);

            (item.selectedOptions || []).forEach((option) => {
                const optionLabel = `+ ${option.name}`;
                splitByLength(optionLabel, labelWidth).forEach((line) => {
                    printer.println(`${padRight(line, labelWidth)}${padLeft(formatEuroReceipt(option.priceVariation), amountWidth)}`);
                });
            });
            printer.println("--------------------------------");
        });

        if (job.totals && job.totals.length > 0) {
            job.totals.forEach((row, index) => {
                const isTotalRow = index === 0 || row.label.toUpperCase().includes("TOTALE");
                if (isTotalRow) printer.setTextDoubleWidth();
                printer.println(`${padRight(row.label.toUpperCase(), labelWidth)}${padLeft(row.value, amountWidth)}`);
                if (isTotalRow) printer.setTextNormal();
            });
            printer.println("--------------------------------");
        }

        printer.alignCenter();
        printer.println("Grazie e buona festa!");
        printer.cut();
    }

    private static buildCashSessionDocument(summary: CashSessionClosingPrintSummary, posDeviceName: string | undefined) {
        return {
            kind: "CASH_SESSION_SUMMARY",
            title: "CHIUSURA CASSA",
            sessionId: summary.sessionId,
            posDeviceName: posDeviceName || "-",
            openedAt: formatDateTime(summary.openedAt),
            closedAt: formatDateTime(summary.closedAt),
            totals: {
                fondoIniziale: formatEuro(summary.openingFloatAmount),
                incassoContanti: formatEuro(summary.cashSalesAmount),
                incassoCarta: formatEuro(summary.cardSalesAmount),
                incassoAltro: formatEuro(summary.otherSalesAmount),
                contanteAtteso: formatEuro(summary.expectedCashAmount),
                contanteContato: formatEuro(summary.closingCountedCashAmount),
                differenza: formatEuro(summary.varianceAmount),
                ordiniSaldati: String(summary.paidOrdersCount)
            },
            openingNotes: summary.openingNotes?.trim() || undefined,
            closingNotes: summary.closingNotes?.trim() || undefined,
            createdAt: new Date().toISOString()
        };
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
            const created = await PrintJobModel.create({
                eventId: params.eventId,
                printerId: params.printerId || undefined,
                orderId: params.orderId || undefined,
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
        }
    ) {
        if (!id) return;
        try {
            await PrintJobModel.updateOne(
                { _id: id },
                {
                    $set: {
                        status: updates.status,
                        errorMessage: updates.errorMessage || undefined
                    }
                }
            );
        } catch (error) {
            console.error(`Unable to update print job log ${id}:`, error);
        }
    }

    static async printComanda(job: PrinterCommandJob, copies: number = 1) {
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
            printType: job.printType || "CUSTOMER_ORDER",
            destinationHost: destinationHost || "unknown",
            destinationPort,
            isVirtual: Boolean(job.isVirtual),
            copies,
            document: this.buildComandaDocument(job)
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

        if (job.printType === "CASHIER_SUMMARY") {
            this.renderCashierReceipt(printer, job);
        } else {
            printer.alignCenter();
            printer.setTextDoubleHeight();
            printer.setTextDoubleWidth();
            printer.println(job.title || "COMANDA");
            printer.setTextNormal();
            printer.println("--------------------------------");

            if (job.shortCode) {
                printer.setTextDoubleHeight();
                printer.println(`CODICE: ${job.shortCode}`);
                printer.setTextNormal();
            }

            printer.println(`ID: ${job.orderId.slice(-6)}`);
            printer.println(new Date().toLocaleString("it-IT"));
            printer.println("--------------------------------");

            printer.alignLeft();
            if (job.customerName) printer.println(`CLIENTE: ${job.customerName}`);
            if (job.tableNumber) printer.println(`TAVOLO: ${job.tableNumber}`);
            printer.println(" ");

            job.items.forEach((item) => {
                printer.setTextDoubleHeight();
                printer.println(`${item.quantity}x ${item.name}`);
                printer.setTextNormal();
                if (item.notes) {
                    printer.println(`   * NOTE: ${item.notes}`);
                }
                printer.println("--------------------------------");
            });

            if (job.totals && job.totals.length > 0) {
                job.totals.forEach((row) => {
                    printer.setTextNormal();
                    printer.println(`${row.label}: ${row.value}`);
                });
                printer.println("--------------------------------");
            }

            printer.cut();
        }

        try {
            for (let i = 0; i < copies; i += 1) {
                await this.withTimeout(
                    printer.execute(),
                    PRINTER_EXECUTE_TIMEOUT_MS,
                    "Printer execution timeout"
                );
            }
            console.log(`Print job sent to ${destinationLabel} (${copies} copies) successfully`);
            await this.updatePrintJobLog(logId, { status: "SENT" });
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
        }>;

        const categoryIdsFromProducts = Array.from(new Set(products.map((product) => product.categoryId.toString())));
        const categories = await Category.find({ _id: { $in: categoryIdsFromProducts } }).populate("printerId").lean() as Array<{
            _id: { toString(): string };
            printerId?: {
                _id?: unknown;
                ip?: string;
                port?: number;
                isVirtual?: boolean;
                emulatorSlot?: number;
            };
        }>;

        const kitchenJobsByDestination: Record<string, PrinterCommandJob> = {};
        const customerJobsByGroup: Record<string, PrinterCommandJob> = {};
        const orderCode = getOrderCodeFromOrder({
            pickupNumber: order.pickupNumber,
            _id: order._id.toString()
        });
        const allOrderItems = order.cart.map((item) => ({
            name: item.snapshotName,
            quantity: item.quantity,
            notes: item.customKitchenNotes
        }));

        const cashierReceiptItems = order.cart.map((item) => {
            const product = products.find((entry) => entry._id.toString() === item.productId.toString());
            const basePrice = Number(product?.basePrice || 0);
            const optionsTotal = (item.selectedOptions || []).reduce(
                (sum, option) => sum + Number(option.priceVariation || 0),
                0
            );
            const unitPrice = Number((basePrice + optionsTotal).toFixed(2));
            const lineTotal = Number((unitPrice * item.quantity).toFixed(2));
            return {
                name: item.snapshotName,
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
            const product = products.find((entry) => entry._id.toString() === item.productId.toString());
            if (!product) return;

            const category = categories.find((entry) => entry._id.toString() === product.categoryId.toString());
            const kitchenPrinter = category?.printerId;

            if (kitchenPrinter?.ip) {
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
                        items: [],
                        customerName: order.customer?.name,
                        tableNumber: order.customer?.table,
                        orderId: order._id.toString(),
                        shortCode: cashierJob.shortCode
                    };
                }

                kitchenJobsByDestination[destinationKey].items.push({
                    name: item.snapshotName,
                    quantity: item.quantity,
                    notes: item.customKitchenNotes
                });
                const customerJob = ensureCustomerJob(destinationKey);
                customerJob?.items.push({
                    name: item.snapshotName,
                    quantity: item.quantity,
                    notes: item.customKitchenNotes
                });
                return;
            }

            const customerJob = ensureCustomerJob("UNASSIGNED");
            customerJob?.items.push({
                name: item.snapshotName,
                quantity: item.quantity,
                notes: item.customKitchenNotes
            });
        });

        const printPromises: Promise<boolean>[] = [];
        if (cashierJob.items.length > 0 && cashierJob.ip) {
            const summaryJob: PrinterCommandJob = {
                ...cashierJob,
                printType: "CASHIER_SUMMARY",
                title: "SCONTRINO CASSA",
                items: cashierReceiptItems,
                totals: [
                    { label: "TOTALE", value: formatEuroReceipt(order.totalAmount || 0) },
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
        const device = await PosDevice.findOne({ _id: posDeviceId, eventId })
            .populate("printerId")
            .lean() as ({
                name?: string;
                printerId?: {
                    _id?: unknown;
                    ip?: string;
                    port?: number;
                    isVirtual?: boolean;
                    emulatorSlot?: number;
                };
            } | null);

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
            document: this.buildCashSessionDocument(summary, summary.posDeviceName || device?.name)
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

        const safeOpeningNotes = summary.openingNotes?.trim();
        const safeClosingNotes = summary.closingNotes?.trim();

        printer.alignCenter();
        printer.setTextDoubleHeight();
        printer.println("CHIUSURA CASSA");
        printer.setTextNormal();
        printer.println("--------------------------------");
        printer.alignLeft();
        printer.println(`SESSIONE: ${summary.sessionId.slice(-8).toUpperCase()}`);
        printer.println(`POSTAZIONE: ${summary.posDeviceName || device?.name || "-"}`);
        printer.println(`APERTURA: ${formatDateTime(summary.openedAt)}`);
        printer.println(`CHIUSURA: ${formatDateTime(summary.closedAt)}`);
        printer.println("--------------------------------");
        printer.println(`FONDO INIZIALE: ${formatEuro(summary.openingFloatAmount)}`);
        printer.println(`INCASSO CONTANTI: ${formatEuro(summary.cashSalesAmount)}`);
        printer.println(`INCASSO CARTA: ${formatEuro(summary.cardSalesAmount)}`);
        printer.println(`INCASSO ALTRO: ${formatEuro(summary.otherSalesAmount)}`);
        printer.println(`CONTANTE ATTESO: ${formatEuro(summary.expectedCashAmount)}`);
        printer.println(`CONTANTE CONTATO: ${formatEuro(summary.closingCountedCashAmount)}`);
        printer.println(`DIFFERENZA: ${formatEuro(summary.varianceAmount)}`);
        printer.println(`ORDINI SALDATI: ${summary.paidOrdersCount}`);
        if (safeOpeningNotes) {
            printer.println("--------------------------------");
            printer.println(`NOTE APERTURA: ${safeOpeningNotes}`);
        }
        if (safeClosingNotes) {
            printer.println("--------------------------------");
            printer.println(`NOTE CHIUSURA: ${safeClosingNotes}`);
        }
        printer.println("--------------------------------");
        printer.println(new Date().toLocaleString("it-IT"));
        printer.cut();

        try {
            await this.withTimeout(
                printer.execute(),
                PRINTER_EXECUTE_TIMEOUT_MS,
                "Printer execution timeout"
            );
            console.log(`Cash session summary print sent to ${printerLabel} successfully`);
            await this.updatePrintJobLog(logId, { status: "SENT" });
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
}
