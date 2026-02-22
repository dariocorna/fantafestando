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

// Define an interface for cart items based on usage
interface CartItem {
    productId: string;
    snapshotName: string;
    quantity: number;
    customKitchenNotes?: string;
    // Add other properties if they exist in the actual Order.cart items
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
            characterSet: "PC1252_ITALIAN" as CharacterSet,
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
}
