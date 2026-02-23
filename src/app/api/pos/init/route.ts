import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import Category from "@/models/Category";
import Product from "@/models/Product";
import PosDevice from "@/models/PosDevice";
import "@/models/Printer"; // Import to register schema for .populate()
import "@/models/Peripheral"; // Import to register schema for .populate()
import { parsePredefinedTablesInput } from "@/lib/table-presets";
import { getCurrentDayCode, isProductAvailableToday } from "@/lib/product-availability";
import { getStockStatus } from "@/lib/inventory";

export async function GET(request: NextRequest) {
    try {
        await dbConnect();
        const channel = request.nextUrl.searchParams.get("channel") === "pos" ? "pos" : "menu";

        // 1. Find active event (or the latest one as fallback)
        let event = await Event.findOne({ active: true, archived: { $ne: true } }).lean();
        if (!event) {
            event = await Event.findOne({ archived: { $ne: true } }).sort({ createdAt: -1 }).lean();
        }

        if (!event) {
            return NextResponse.json({ error: "No events found" }, { status: 404 });
        }

        // 2. Fetch categories for this event
        const categories = await Category.find({ eventId: event._id }).lean();

        // 3. Fetch products for this event
        const products = await Product.find({ eventId: event._id }).lean();
        const currentDayCode = getCurrentDayCode("Europe/Rome");
        const dayAvailableProducts = products.filter((product) =>
            isProductAvailableToday((product as { availableDays?: string[] }).availableDays || [], currentDayCode)
        );
        const availableProducts = dayAvailableProducts
            .filter((product) => {
                if (channel === "pos") return true;
                const stockStatus = getStockStatus(
                    (product as { stockQuantity?: number | null }).stockQuantity ?? null,
                    Boolean((product as { isSoldOut?: boolean }).isSoldOut)
                );
                return stockStatus !== "OUT";
            })
            .map((product) => ({
                ...product,
                stockStatus: getStockStatus(
                    (product as { stockQuantity?: number | null }).stockQuantity ?? null,
                    Boolean((product as { isSoldOut?: boolean }).isSoldOut)
                )
            }));
        const availableCategoryIds = new Set(
            availableProducts.map((product) => String((product as { categoryId: unknown }).categoryId))
        );
        const availableCategories = categories.filter((category) => availableCategoryIds.has(String(category._id)));

        // 4. Fetch POS Devices for this event
        const posDevices = await PosDevice.find({ eventId: event._id })
            .populate({ path: "printerId", select: "name ip" })
            .populate({ path: "paymentTerminalId", select: "name type" })
            .populate({ path: "cashBoxId", select: "name type" })
            .lean();

        const serializedPosDevices = posDevices.map((device) => ({
            _id: String(device._id),
            name: device.name,
            printerId: device.printerId && typeof device.printerId === "object"
                ? {
                    _id: String((device.printerId as { _id: unknown })._id),
                    name: (device.printerId as { name?: string }).name || "",
                    ip: (device.printerId as { ip?: string }).ip || ""
                }
                : (device.printerId ? String(device.printerId) : undefined),
            paymentTerminalId: device.paymentTerminalId && typeof device.paymentTerminalId === "object"
                ? {
                    _id: String((device.paymentTerminalId as { _id: unknown })._id),
                    name: (device.paymentTerminalId as { name?: string }).name || "",
                    type: (device.paymentTerminalId as { type?: string }).type || "OTHER"
                }
                : (device.paymentTerminalId ? String(device.paymentTerminalId) : undefined),
            cashBoxId: device.cashBoxId && typeof device.cashBoxId === "object"
                ? {
                    _id: String((device.cashBoxId as { _id: unknown })._id),
                    name: (device.cashBoxId as { name?: string }).name || "",
                    type: (device.cashBoxId as { type?: string }).type || "OTHER"
                }
                : (device.cashBoxId ? String(device.cashBoxId) : undefined)
        }));

        const sanitizedEvent = {
            ...event,
            settings: {
                askName: event.settings?.askName ?? false,
                askTable: event.settings?.askTable ?? false
            },
            predefinedTables: parsePredefinedTablesInput(
                Array.isArray(event.predefinedTables) ? event.predefinedTables.join("\n") : "",
                Number.MAX_SAFE_INTEGER
            )
        };

        return NextResponse.json({
            event: sanitizedEvent,
            categories: availableCategories,
            products: availableProducts,
            posDevices: serializedPosDevices
        });
    } catch (error) {
        console.error("POS Init Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
