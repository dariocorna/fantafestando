import { NextRequest, NextResponse } from "next/server";
import { adminUnauthorizedJson, ensureAuthenticatedSession } from "@/lib/authz";
import dbConnect from "@/lib/mongoose";
import { getActiveEventId } from "@/lib/events";
import Order from "@/models/Order";
import { parsePizzaOrderIdValue } from "@/lib/pizza-barcode";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const sessionCheck = await ensureAuthenticatedSession();
        if (!sessionCheck.ok) return adminUnauthorizedJson(sessionCheck);

        const activeEventId = await getActiveEventId();
        if (!activeEventId) return NextResponse.json({ status: "not_found" }, { status: 404 });

        const payload = await request.json().catch(() => ({} as { orderId?: string; pizzaNumber?: number }));
        const parsedOrderId = typeof payload.orderId === "string" ? parsePizzaOrderIdValue(payload.orderId) : null;
        const pizzaNumber = Number(payload.pizzaNumber);
        if (!parsedOrderId || !Number.isInteger(pizzaNumber) || pizzaNumber <= 0) {
            return NextResponse.json({ status: "invalid" }, { status: 400 });
        }

        await dbConnect();
        const order = await Order.findOne({
            _id: parsedOrderId.orderId,
            eventId: activeEventId,
            status: "PAID",
            "dishTickets.pizzaNumber": pizzaNumber
        }).select("_id dishTickets").lean() as ({
            _id: string | { toString(): string };
            dishTickets?: Array<{ pizzaNumber?: number; state?: "QUEUED" | "READY" | "REMOVED" }>;
        } | null);
        const ticket = order?.dishTickets?.find((entry) => entry.pizzaNumber === pizzaNumber);
        if (!order || !ticket) return NextResponse.json({ status: "not_found" }, { status: 404 });

        if (ticket.state === "QUEUED") {
            return NextResponse.json({
                status: "already_queued",
                ticket: { orderId: order._id.toString(), pizzaNumber }
            });
        }

        await Order.updateOne(
            { _id: order._id, eventId: activeEventId, status: "PAID" },
            {
                $set: { "dishTickets.$[ticket].state": "QUEUED" },
                $unset: { "dishTickets.$[ticket].readyAt": 1 }
            },
            { arrayFilters: [{ "ticket.pizzaNumber": pizzaNumber }] }
        );

        return NextResponse.json({
            status: "requeued",
            ticket: { orderId: order._id.toString(), pizzaNumber }
        });
    } catch (error) {
        console.error("Pizza console requeue API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
