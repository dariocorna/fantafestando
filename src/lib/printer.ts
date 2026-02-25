import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import Order from "@/models/Order";
import Product from "@/models/Product";
import Category from "@/models/Category";
import PosDevice from "@/models/PosDevice";
import dbConnect from "./mongoose";
import { getOrderCodeFromOrder } from "./order-code";

export interface PrintJob {
    ip: string;
    title: string;
    items: Array<{
        name: string;
        quantity: number;
        notes?: string;
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

// Define an interface for cart items based on usage
interface CartItem {
    productId: string;
    snapshotName: string;
    quantity: number;
    customKitchenNotes?: string;
    // Add other properties if they exist in the actual Order.cart items
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

export class PrinterService {
    static async printComanda(job: PrintJob, copies: number = 1) {
        if (!job.ip) {
            console.warn(`No printer IP defined for job ${job.orderId}`);
            return false;
        }

        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON, // Default for most thermal printers
            interface: `tcp://${job.ip}`,
            characterSet: CharacterSet.WPC1252,
            removeSpecialCharacters: false,
            lineCharacter: "=",
        });

        const isConnected = await printer.isPrinterConnected();
        if (!isConnected) {
            console.error(`Printer at ${job.ip} is not reachable`);
            return false;
        }

        printer.alignCenter();
        printer.setTextDoubleHeight();
        printer.setTextDoubleWidth();
        printer.println("COMANDA");
        printer.setTextNormal();
        printer.println("--------------------------------");

        if (job.shortCode) {
            printer.setTextDoubleHeight();
            printer.println(`CODICE: ${job.shortCode}`);
            printer.setTextNormal();
        }

        printer.println(`ID: ${job.orderId.slice(-6)}`);
        printer.println(new Date().toLocaleString('it-IT'));
        printer.println("--------------------------------");

        printer.alignLeft();
        if (job.customerName) printer.println(`CLIENTE: ${job.customerName}`);
        if (job.tableNumber) printer.println(`TAVOLO: ${job.tableNumber}`);
        printer.println(" ");

        job.items.forEach(item => {
            printer.setTextDoubleHeight();
            printer.println(`${item.quantity}x ${item.name}`);
            printer.setTextNormal();
            if (item.notes) {
                printer.println(`   * NOTE: ${item.notes}`);
            }
            printer.println("--------------------------------");
        });

        printer.cut();

        try {
            for (let i = 0; i < copies; i++) {
                await printer.execute();
            }
            console.log(`Print job sent to ${job.ip} (${copies} copies) successfully`);
            return true;
        } catch (error) {
            console.error(`Printer execution error at ${job.ip}:`, error);
            return false;
        }
    }

    static async routeOrderToPrinters(orderId: string, posDeviceId?: string) {
        await dbConnect();
        const order = await Order.findById(orderId).lean();
        if (!order) return;

        // Fetch POS Device and its printer
        let cashierPrinterIp: string | undefined = undefined;
        if (posDeviceId) {
            const device = await PosDevice.findById(posDeviceId).populate('printerId').lean() as (import("@/models/PosDevice").IPosDevice & { printerId: import("@/models/Printer").IPrinter });
            cashierPrinterIp = device?.printerId?.ip;
        }

        // Fetch products and their categories
        const productIds = order.cart.map((item: CartItem) => item.productId);
        const products = await Product.find({ _id: { $in: productIds } }).lean();

        const categoryIdsFromProducts = Array.from(new Set(products.map(p => p.categoryId.toString())));
        const categories = await Category.find({ _id: { $in: categoryIdsFromProducts } }).populate('printerId').lean();

        // Jobs for Kitchen/Departments (Double Copy)
        const kitchenJobsByIp: Record<string, PrintJob> = {};
        const orderCode = getOrderCodeFromOrder({
            pickupNumber: (order as { pickupNumber?: number }).pickupNumber,
            _id: order._id.toString()
        });
        // Job for Cashier (Single Copy for items without kitchen printer)
        const cashierJob: PrintJob = {
            ip: cashierPrinterIp || "",
            title: "COMANDA CLIENTE",
            items: [],
            customerName: order.customer?.name,
            tableNumber: order.customer?.table,
            orderId: order._id.toString(),
            shortCode: orderCode || undefined
        };

        order.cart.forEach((item: CartItem) => {
            const product = products.find(p => p._id.toString() === item.productId.toString());
            if (!product) return;
            const category = categories.find(c => c._id.toString() === product.categoryId.toString());
            const kitchenPrinter = category?.printerId as (import("@/models/Printer").IPrinter | undefined);

            if (kitchenPrinter?.ip) {
                // Add to kitchen job (IP specific)
                if (!kitchenJobsByIp[kitchenPrinter.ip]) {
                    kitchenJobsByIp[kitchenPrinter.ip] = {
                        ip: kitchenPrinter.ip,
                        title: "COMANDA REPARTO",
                        items: [],
                        customerName: order.customer?.name,
                        tableNumber: order.customer?.table,
                        orderId: order._id.toString(),
                        shortCode: cashierJob.shortCode
                    };
                }
                kitchenJobsByIp[kitchenPrinter.ip].items.push({
                    name: item.snapshotName,
                    quantity: item.quantity,
                    notes: item.customKitchenNotes
                });
            } else if (cashierPrinterIp) {
                // No kitchen printer -> fallback to cashier printer (1 copy for customer)
                cashierJob.items.push({
                    name: item.snapshotName,
                    quantity: item.quantity,
                    notes: item.customKitchenNotes
                });
            }
        });

        const printPromises: Promise<boolean>[] = [];

        // 1. Print Kitchen Jobs: 2 copies each (one for kitchen, one for customer)
        Object.values(kitchenJobsByIp).forEach(job => {
            printPromises.push(this.printComanda(job, 2));
        });

        // 2. Print Cashier fallback for customer: 1 copy
        if (cashierJob.items.length > 0 && cashierJob.ip) {
            printPromises.push(this.printComanda(cashierJob, 1));
        }

        // 3. Always print a full fiscal/summary receipt at the cashier printer? 
        // For now, let's stick to the "comande" requirements.

        return await Promise.all(printPromises);
    }

    static async printCashSessionSummary(eventId: string, posDeviceId: string, summary: CashSessionClosingPrintSummary) {
        if (!eventId || !posDeviceId) return false;

        await dbConnect();
        const device = await PosDevice.findOne({ _id: posDeviceId, eventId })
            .populate("printerId")
            .lean() as (import("@/models/PosDevice").IPosDevice & { printerId?: import("@/models/Printer").IPrinter }) | null;

        const printerIp = device?.printerId?.ip;
        if (!printerIp) {
            console.warn(`No cashier printer configured for POS ${posDeviceId}`);
            return false;
        }

        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: `tcp://${printerIp}`,
            characterSet: CharacterSet.WPC1252,
            removeSpecialCharacters: false,
            lineCharacter: "=",
        });

        const isConnected = await printer.isPrinterConnected();
        if (!isConnected) {
            console.error(`Cash session summary printer at ${printerIp} is not reachable`);
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
            await printer.execute();
            console.log(`Cash session summary print sent to ${printerIp} successfully`);
            return true;
        } catch (error) {
            console.error(`Cash session summary printer execution error at ${printerIp}:`, error);
            return false;
        }
    }
}
