import { NextResponse } from "next/server";
import { adminUnauthorizedJson, ensureAuthenticatedSession } from "@/lib/authz";
import dbConnect from "@/lib/mongoose";
import { getActiveEvent } from "@/lib/events";
import Order from "@/models/Order";
import { getOrderCodeFromOrder } from "@/lib/order-code";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const sessionCheck = await ensureAuthenticatedSession();
        if (!sessionCheck.ok) {
            return adminUnauthorizedJson(sessionCheck);
        }

        const activeEvent = await getActiveEvent() as ({ _id?: { toString(): string }, name?: string } | null);
        if (!activeEvent?._id) {
            return NextResponse.json({
                eventName: null,
                queuedTickets: [],
                readyTickets: []
            });
        }

        await dbConnect();
        const [queuedOrders, readyOrders] = await Promise.all([
            Order.find({
                eventId: activeEvent._id.toString(),
                status: "PAID",
                "pizzaTicket.state": "QUEUED"
            })
                .sort({ createdAt: 1 })
                .limit(60)
                .select("_id pickupNumber pizzaTicket.pizzaNumber customer createdAt")
                .lean(),
            Order.find({
                eventId: activeEvent._id.toString(),
                status: "PAID",
                "pizzaTicket.state": "READY"
            })
                .sort({ "pizzaTicket.readyAt": -1, updatedAt: -1 })
                .limit(20)
                .select("_id pickupNumber pizzaTicket.pizzaNumber pizzaTicket.readyAt customer createdAt")
                .lean()
        ]) as [
            Array<{
                _id: string | { toString(): string };
                pickupNumber?: number;
                pizzaTicket?: { pizzaNumber?: number };
                customer?: { name?: string; table?: string };
                createdAt?: Date | string;
            }>,
            Array<{
                _id: string | { toString(): string };
                pickupNumber?: number;
                pizzaTicket?: { pizzaNumber?: number; readyAt?: Date | string };
                customer?: { name?: string; table?: string };
                createdAt?: Date | string;
            }>
        ];

        return NextResponse.json({
            eventName: activeEvent.name || null,
            queuedTickets: queuedOrders
                .map((order) => {
                    const pizzaNumber = Number(order.pizzaTicket?.pizzaNumber);
                    if (!Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return null;

                    return {
                        orderId: order._id.toString(),
                        pizzaNumber,
                        orderCode: getOrderCodeFromOrder({
                            pickupNumber: order.pickupNumber,
                            _id: order._id
                        }),
                        ...(order.customer?.name?.trim()
                            ? { customerName: order.customer.name.trim() }
                            : {}),
                        ...(order.customer?.table?.trim()
                            ? { table: order.customer.table.trim() }
                            : {}),
                        createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : new Date(0).toISOString()
                    };
                })
                .filter((entry): entry is {
                    orderId: string;
                    pizzaNumber: number;
                    orderCode: string;
                    customerName?: string;
                    table?: string;
                    createdAt: string;
                } => Boolean(entry)),
            readyTickets: readyOrders
                .map((order) => {
                    const pizzaNumber = Number(order.pizzaTicket?.pizzaNumber);
                    if (!Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return null;

                    return {
                        orderId: order._id.toString(),
                        pizzaNumber,
                        readyAt: order.pizzaTicket?.readyAt
                            ? new Date(order.pizzaTicket.readyAt).toISOString()
                            : new Date(0).toISOString()
                    };
                })
                .filter((entry): entry is {
                    orderId: string;
                    pizzaNumber: number;
                    readyAt: string;
                } => Boolean(entry))
        });
    } catch (error) {
        console.error("Pizza console tickets API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
