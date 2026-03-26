import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import { getActiveEventId } from "@/lib/events";
import Order from "@/models/Order";
import { parsePizzaBarcodeValue } from "@/lib/pizza-ticket";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const activeEventId = await getActiveEventId();
        if (!activeEventId) {
            return NextResponse.json({ status: "invalid", error: "Nessuna festa attiva" }, { status: 400 });
        }

        const payload = await request.json().catch(() => ({} as { barcode?: string }));
        const parsed = parsePizzaBarcodeValue(typeof payload.barcode === "string" ? payload.barcode : "");
        if (!parsed) {
            return NextResponse.json({ status: "invalid" }, { status: 400 });
        }

        await dbConnect();
        const order = await Order.findOne({
            _id: parsed.orderId,
            eventId: activeEventId,
            status: "PAID"
        }).select("_id pizzaTicket").lean() as ({
            _id: string | { toString(): string };
            pizzaTicket?: {
                pizzaNumber?: number;
                state?: "QUEUED" | "READY";
                readyAt?: Date | string;
            };
        } | null);

        if (!order?.pizzaTicket?.pizzaNumber) {
            return NextResponse.json({ status: "not_found" }, { status: 404 });
        }

        if (order.pizzaTicket.state === "READY") {
            return NextResponse.json({
                status: "already_ready",
                ticket: {
                    orderId: order._id.toString(),
                    pizzaNumber: order.pizzaTicket.pizzaNumber,
                    readyAt: order.pizzaTicket.readyAt
                        ? new Date(order.pizzaTicket.readyAt).toISOString()
                        : new Date().toISOString()
                }
            });
        }

        const readyAt = new Date();
        await Order.updateOne(
            {
                _id: order._id,
                eventId: activeEventId,
                status: "PAID",
                "pizzaTicket.pizzaNumber": order.pizzaTicket.pizzaNumber
            },
            {
                $set: {
                    "pizzaTicket.state": "READY",
                    "pizzaTicket.readyAt": readyAt
                }
            }
        );

        return NextResponse.json({
            status: "ready",
            ticket: {
                orderId: order._id.toString(),
                pizzaNumber: order.pizzaTicket.pizzaNumber,
                readyAt: readyAt.toISOString()
            }
        });
    } catch (error) {
        console.error("Pizza console scan API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
