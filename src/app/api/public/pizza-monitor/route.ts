import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import { getActiveEvent } from "@/lib/events";
import Order from "@/models/Order";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const activeEvent = await getActiveEvent() as ({ _id?: { toString(): string }, name?: string } | null);
        if (!activeEvent?._id) {
            return NextResponse.json({ eventName: null, readyNumbers: [] });
        }

        await dbConnect();
        const readyOrders = await Order.find({
            eventId: activeEvent._id.toString(),
            status: "PAID",
            "dishTickets.state": "READY"
        }).sort({ "dishTickets.readyAt": -1, updatedAt: -1 }).limit(12).select("dishTickets").lean() as Array<{
            dishTickets?: Array<{
                pizzaNumber?: number;
                state?: "QUEUED" | "READY" | "REMOVED";
                readyAt?: Date | string;
            }>;
        }>;

        const readyNumbers = readyOrders.flatMap((order) =>
            (order.dishTickets || []).flatMap((ticket) => {
                const pizzaNumber = Number(ticket.pizzaNumber);
                if (ticket.state !== "READY" || !Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return [];
                return [{
                    pizzaNumber,
                    readyAt: ticket.readyAt ? new Date(ticket.readyAt).toISOString() : new Date(0).toISOString()
                }];
            })
        ).sort((left, right) => right.readyAt.localeCompare(left.readyAt)).slice(0, 12);

        return NextResponse.json({ eventName: activeEvent.name || null, readyNumbers });
    } catch (error) {
        console.error("Public pizza monitor API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
