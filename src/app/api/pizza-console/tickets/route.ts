import { NextResponse } from "next/server";
import { adminUnauthorizedJson, ensureAuthenticatedSession } from "@/lib/authz";
import dbConnect from "@/lib/mongoose";
import { getActiveEvent } from "@/lib/events";
import Order from "@/models/Order";
import { getOrderCodeFromOrder } from "@/lib/order-code";

export const dynamic = "force-dynamic";

interface TicketOrder {
    _id: string | { toString(): string };
    pickupNumber?: number;
    dishTickets?: Array<{
        snapshotName?: string;
        pizzaNumber?: number;
        state?: "QUEUED" | "READY" | "REMOVED";
        readyAt?: Date | string;
    }>;
    customer?: { name?: string; table?: string };
    createdAt?: Date | string;
}

export async function GET() {
    try {
        const sessionCheck = await ensureAuthenticatedSession();
        if (!sessionCheck.ok) return adminUnauthorizedJson(sessionCheck);

        const activeEvent = await getActiveEvent() as ({ _id?: { toString(): string }, name?: string } | null);
        if (!activeEvent?._id) {
            return NextResponse.json({ eventName: null, queuedTickets: [], readyTickets: [] });
        }

        await dbConnect();
        const [queuedOrders, readyOrders] = await Promise.all([
            Order.find({
                eventId: activeEvent._id.toString(),
                status: "PAID",
                "dishTickets.state": "QUEUED"
            }).sort({ createdAt: 1 }).limit(60).select("_id pickupNumber dishTickets customer createdAt").lean(),
            Order.find({
                eventId: activeEvent._id.toString(),
                status: "PAID",
                "dishTickets.state": "READY"
            }).sort({ "dishTickets.readyAt": -1, updatedAt: -1 }).limit(20).select("_id dishTickets").lean()
        ]) as [TicketOrder[], TicketOrder[]];

        const queuedTickets = queuedOrders.flatMap((order) =>
            (order.dishTickets || []).flatMap((ticket) => {
                const pizzaNumber = Number(ticket.pizzaNumber);
                if (ticket.state !== "QUEUED" || !Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return [];
                return [{
                    orderId: order._id.toString(),
                    pizzaNumber,
                    productName: ticket.snapshotName?.trim() || "Piatto",
                    orderCode: getOrderCodeFromOrder({ pickupNumber: order.pickupNumber, _id: order._id }),
                    ...(order.customer?.name?.trim() ? { customerName: order.customer.name.trim() } : {}),
                    ...(order.customer?.table?.trim() ? { table: order.customer.table.trim() } : {}),
                    createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date(0).toISOString()
                }];
            })
        ).slice(0, 60);

        const readyTickets = readyOrders.flatMap((order) =>
            (order.dishTickets || []).flatMap((ticket) => {
                const pizzaNumber = Number(ticket.pizzaNumber);
                if (ticket.state !== "READY" || !Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return [];
                return [{
                    orderId: order._id.toString(),
                    pizzaNumber,
                    productName: ticket.snapshotName?.trim() || "Piatto",
                    readyAt: ticket.readyAt ? new Date(ticket.readyAt).toISOString() : new Date(0).toISOString()
                }];
            })
        ).sort((left, right) => right.readyAt.localeCompare(left.readyAt)).slice(0, 20);

        return NextResponse.json({
            eventName: activeEvent.name || null,
            queuedTickets,
            readyTickets
        });
    } catch (error) {
        console.error("Pizza console tickets API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
