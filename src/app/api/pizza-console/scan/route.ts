import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorizedJson, ensureAuthenticatedSession } from "@/lib/authz";
import dbConnect from "@/lib/mongoose";
import { getActiveEventId } from "@/lib/events";
import Order from "@/models/Order";
import { parsePizzaBarcodeValue } from "@/lib/pizza-barcode";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const sessionCheck = await ensureAuthenticatedSession();
        if (!sessionCheck.ok) return adminUnauthorizedJson(sessionCheck);

        const activeEventId = await getActiveEventId();
        if (!activeEventId) {
            return NextResponse.json({ status: "invalid", error: "Nessuna festa attiva" }, { status: 400 });
        }

        const payload = await request.json().catch(() => ({} as { barcode?: string }));
        const parsed = parsePizzaBarcodeValue(typeof payload.barcode === "string" ? payload.barcode : "");
        if (!parsed || !("pizzaNumber" in parsed)) {
            return NextResponse.json({ status: "invalid" }, { status: 400 });
        }

        await dbConnect();
        const order = await Order.findOne({
            eventId: activeEventId,
            status: "PAID",
            "dishTickets.pizzaNumber": parsed.pizzaNumber
        }).select("_id dishTickets").lean() as ({
            _id: string | { toString(): string };
            dishTickets?: Array<{
                pizzaNumber?: number;
                state?: "QUEUED" | "READY" | "REMOVED";
                readyAt?: Date | string;
            }>;
        } | null);
        const ticket = order?.dishTickets?.find((entry) => entry.pizzaNumber === parsed.pizzaNumber);
        if (!order || !ticket) {
            return NextResponse.json({ status: "not_found" }, { status: 404 });
        }

        if (ticket.state === "READY") {
            return NextResponse.json({
                status: "already_ready",
                ticket: {
                    orderId: order._id.toString(),
                    pizzaNumber: parsed.pizzaNumber,
                    readyAt: ticket.readyAt ? new Date(ticket.readyAt).toISOString() : new Date().toISOString()
                }
            });
        }

        const readyAt = new Date();
        await Order.updateOne(
            { _id: order._id, eventId: activeEventId, status: "PAID" },
            {
                $set: {
                    "dishTickets.$[ticket].state": "READY",
                    "dishTickets.$[ticket].readyAt": readyAt
                }
            },
            { arrayFilters: [{ "ticket.pizzaNumber": parsed.pizzaNumber }] }
        );

        return NextResponse.json({
            status: "ready",
            ticket: {
                orderId: order._id.toString(),
                pizzaNumber: parsed.pizzaNumber,
                readyAt: readyAt.toISOString()
            }
        });
    } catch (error) {
        console.error("Pizza console scan API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
