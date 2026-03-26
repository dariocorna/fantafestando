import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import { getActiveEvent } from "@/lib/events";
import Order from "@/models/Order";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const activeEvent = await getActiveEvent() as ({ _id?: { toString(): string }, name?: string } | null);
        if (!activeEvent?._id) {
            return NextResponse.json({
                eventName: null,
                readyNumbers: []
            });
        }

        await dbConnect();
        const readyOrders = await Order.find({
            eventId: activeEvent._id.toString(),
            status: "PAID",
            "pizzaTicket.state": "READY"
        })
            .sort({ "pizzaTicket.readyAt": -1, updatedAt: -1 })
            .limit(12)
            .select("pizzaTicket.pizzaNumber pizzaTicket.readyAt")
            .lean() as Array<{
                pizzaTicket?: {
                    pizzaNumber?: number;
                    readyAt?: Date | string;
                };
            }>;

        return NextResponse.json({
            eventName: activeEvent.name || null,
            readyNumbers: readyOrders
                .map((order) => {
                    const pizzaNumber = Number(order.pizzaTicket?.pizzaNumber);
                    if (!Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return null;

                    const readyAt = order.pizzaTicket?.readyAt
                        ? new Date(order.pizzaTicket.readyAt).toISOString()
                        : new Date(0).toISOString();

                    return {
                        pizzaNumber,
                        readyAt
                    };
                })
                .filter((entry): entry is { pizzaNumber: number; readyAt: string } => Boolean(entry))
        });
    } catch (error) {
        console.error("Public pizza monitor API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
