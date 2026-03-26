import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { getOrderCodeFromOrder } from "@/lib/order-code";
import { buildPublicOrderSummary } from "@/lib/public-order-summary";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await context.params;
        const code = request.nextUrl.searchParams.get("code")?.trim() || "";
        if (!id || !code) {
            return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
        }

        await dbConnect();
        const order = await Order.findById(id)
            .select("_id pickupNumber pizzaTicket.pizzaNumber totalAmount customer cart")
            .lean() as ({
                _id: string | { toString(): string };
                pickupNumber?: number;
                pizzaTicket?: { pizzaNumber?: number };
                totalAmount: number;
                customer?: { name?: string; table?: string };
                cart: Array<{
                    snapshotName: string;
                    quantity: number;
                    selectedOptions?: Array<{ name: string; priceVariation: number }>;
                }>;
            } | null);

        if (!order) {
            return NextResponse.json({ error: "Ordine non trovato" }, { status: 404 });
        }

        const expectedCode = getOrderCodeFromOrder(order);
        if (expectedCode !== code) {
            return NextResponse.json({ error: "Ordine non accessibile" }, { status: 403 });
        }

        return NextResponse.json({
            summary: buildPublicOrderSummary(order)
        });
    } catch (error) {
        console.error("Public order summary API error:", error);
        return NextResponse.json({ error: "Errore interno" }, { status: 500 });
    }
}
