import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import Category from "@/models/Category";
import Product from "@/models/Product";
import PosDevice from "@/models/PosDevice";
import "@/models/Printer"; // Import to register schema for .populate()

export async function GET() {
    try {
        await dbConnect();

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

        // 4. Fetch POS Devices for this event
        const posDevices = await PosDevice.find({ eventId: event._id }).populate('printerId').lean();

        return NextResponse.json({
            event,
            categories,
            products,
            posDevices
        });
    } catch (error) {
        console.error("POS Init Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
