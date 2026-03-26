import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import { getActiveEventId } from "@/lib/events";
import Order from "@/models/Order";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const activeEventId = await getActiveEventId();
        if (!activeEventId) {
            return NextResponse.json({ status: "not_found" }, { status: 404 });
        }

        const payload = await request.json().catch(() => ({} as { orderId?: string }));
        const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
        if (!orderId) {
            return NextResponse.json({ status: "not_found" }, { status: 404 });
        }

        await dbConnect();
        const order = await Order.findOne({
            _id: orderId,
            eventId: activeEventId,
            status: "PAID"
        }).select("_id pizzaTicket").lean() as ({
            _id: string | { toString(): string };
            pizzaTicket?: {
                pizzaNumber?: number;
                state?: "QUEUED" | "READY";
            };
        } | null);

        if (!order?.pizzaTicket?.pizzaNumber) {
            return NextResponse.json({ status: "not_found" }, { status: 404 });
        }

        if (order.pizzaTicket.state !== "READY") {
            return NextResponse.json({
                status: "already_queued",
                ticket: {
                    orderId: order._id.toString(),
                    pizzaNumber: order.pizzaTicket.pizzaNumber
                }
            });
        }

        await Order.updateOne(
            {
                _id: order._id,
                eventId: activeEventId,
                status: "PAID",
                "pizzaTicket.pizzaNumber": order.pizzaTicket.pizzaNumber
            },
            {
                $set: {
                    "pizzaTicket.state": "QUEUED"
                },
                $unset: {
                    "pizzaTicket.readyAt": 1
                }
            }
        );

        return NextResponse.json({
            status: "requeued",
            ticket: {
                orderId: order._id.toString(),
                pizzaNumber: order.pizzaTicket.pizzaNumber
            }
        });
    } catch (error) {
        console.error("Pizza console requeue API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
