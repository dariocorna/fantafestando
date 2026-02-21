import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import Order from "@/models/Order";
import Product from "@/models/Product";
import Category from "@/models/Category";
import dbConnect from "./mongoose";

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

export class PrinterService {
    static async printComanda(job: PrintJob) {
        if (!job.ip) {
            console.warn(`No printer IP defined for job ${job.orderId}`);
            return false;
        }

        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON, // Default for most thermal printers
            interface: `tcp://${job.ip}`,
            characterSet: "PC1252_ITALIAN" as any,
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
            await printer.execute();
            console.log(`Print job sent to ${job.ip} successfully`);
            return true;
        } catch (error) {
            console.error(`Printer execution error at ${job.ip}:`, error);
            return false;
        }
    }

    static async routeOrderToPrinters(orderId: string) {
        await dbConnect();
        const order = await Order.findById(orderId).lean();
        if (!order) return;

        // Fetch categories to get printer IPs
        const categoryIds = order.cart.map((item: any) => item.productId); // This is actually productId in the cart
        // We need to fetch the products to get their categories
        const productIds = order.cart.map((item: any) => item.productId);
        const products = await Product.find({ _id: { $in: productIds } }).lean();

        const categoryIdsFromProducts = Array.from(new Set(products.map(p => p.categoryId.toString())));
        const categories = await Category.find({ _id: { $in: categoryIdsFromProducts } }).lean();

        // Group cart items by printer IP
        const jobsByIp: Record<string, PrintJob> = {};

        order.cart.forEach((item: any) => {
            const product = products.find(p => p._id.toString() === item.productId.toString());
            if (!product) return;
            const category = categories.find(c => c._id.toString() === product.categoryId.toString());
            const ip = category?.printerIp;

            if (ip) {
                if (!jobsByIp[ip]) {
                    const shortCode = order._id.toString().slice(-4).toUpperCase();
                    jobsByIp[ip] = {
                        ip,
                        title: "COMANDA",
                        items: [],
                        customerName: order.customer?.name,
                        tableNumber: order.customer?.table,
                        orderId: order._id.toString(),
                        shortCode
                    };
                }
                jobsByIp[ip].items.push({
                    name: item.snapshotName,
                    quantity: item.quantity,
                    notes: item.customKitchenNotes
                });
            }
        });

        // Execute all jobs
        const results = await Promise.all(
            Object.values(jobsByIp).map(job => this.printComanda(job))
        );

        return results;
    }
}
