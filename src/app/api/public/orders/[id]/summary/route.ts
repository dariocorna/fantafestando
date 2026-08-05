import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import { hashOrderAccessToken } from "@/lib/order-access-token";
import { buildPublicOrderSummary } from "@/lib/public-order-summary";
import { consumeRateLimit, resolveClientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function tokenMatches(expectedHash: string, providedToken: string): boolean {
    if (!expectedHash) return false;
    const expected = Buffer.from(expectedHash);
    const provided = Buffer.from(hashOrderAccessToken(providedToken));
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
}

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

        const { allowed } = consumeRateLimit(
            `public-order-summary:${resolveClientKey(request.headers)}`,
            60,
            10 * 60 * 1000
        );
        if (!allowed) {
            return NextResponse.json({ error: "Troppe richieste" }, { status: 429 });
        }

        await dbConnect();
        const order = await Order.findById(id)
            .select("_id pickupNumber dishTickets totalAmount customer cart +publicAccessTokenHash")
            .lean() as ({
                _id: string | { toString(): string };
                pickupNumber?: number;
                dishTickets?: Array<{
                    productId?: string | { toString(): string };
                    snapshotName?: string;
                    pizzaNumber?: number;
                }>;
                totalAmount: number;
                publicAccessTokenHash?: string;
                customer?: { name?: string; table?: string };
                cart: Array<{
                    snapshotName: string;
                    quantity: number;
                    selectedOptions?: Array<{ name: string; priceVariation: number }>;
                }>;
            } | null);

        // Same answer whether the order is missing or the token is wrong, so the
        // endpoint cannot be used to probe which order ids exist.
        if (!order || !tokenMatches(order.publicAccessTokenHash?.trim() || "", code)) {
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
