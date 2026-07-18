"use server";

import { ensureAdminSession } from "@/lib/authz";
import CashSession from "@/models/CashSession";
import Order from "@/models/Order";
import Product from "@/models/Product";
import { buildCashSessionPrintDocumentV2, PrintDocumentItemRow } from "@/lib/print-report";
import { aggregateOrderProductConsumptions } from "@/lib/product-consumption";

export async function getClosedCashSessionPrintDocumentAction(sessionId: string, posDeviceName?: string) {
    const sessionCheck = await ensureAdminSession();
    if (!sessionCheck.ok) {
        throw new Error(sessionCheck.error);
    }

    const session = await CashSession.findById(sessionId).populate("eventId").lean();
    if (!session) {
        throw new Error("Sessione cassa non trovata.");
    }

    if (session.status !== "CLOSED") {
        throw new Error("La sessione di cassa deve essere chiusa per visualizzare il report.");
    }

    const orders = await Order.find({
        cashSessionId: session._id,
        status: "PAID"
    }).lean() as Array<{
        cart?: Array<{
            productId?: string | { toString(): string }
        }>
    }>;

    const productIds = Array.from(
        new Set(
            orders.flatMap((order) =>
                (order.cart || [])
                    .map((item) => item?.productId ? item.productId.toString() : null)
                    .filter((productId): productId is string => Boolean(productId))
            )
        )
    );

    const eventId = typeof session.eventId === "object" && session.eventId && "_id" in session.eventId
        ? String((session.eventId as { _id: unknown })._id)
        : undefined;

    const catalogProducts = productIds.length > 0
        ? await Product.find({
            _id: { $in: productIds },
            ...(eventId ? { eventId } : {})
        }).select("_id name basePrice").lean() as Array<{ _id: { toString(): string } | string; name?: string; basePrice?: number }>
        : [];

    const catalogByProductId = new Map(
        catalogProducts.map((product) => [
            product._id.toString(),
            { name: product.name, basePrice: product.basePrice }
        ])
    );

    const items: PrintDocumentItemRow[] = aggregateOrderProductConsumptions({
        orders,
        catalogByProductId
    }).map((metric) => ({
        name: metric.productName,
        qty: metric.quantityConsumed,
        lineTotal: metric.revenueAmount
    }));

    const document = buildCashSessionPrintDocumentV2({
        sessionId: session._id.toString(),
        eventName: (session.eventId as { name: string }).name,
        posDeviceName: posDeviceName || "Sessione Cassa",
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt!.toISOString(),
        openingFloatAmount: session.openingFloatAmount || 0,
        cashSalesAmount: session.cashSalesAmount || 0,
        cardSalesAmount: session.cardSalesAmount || 0,
        otherSalesAmount: session.otherSalesAmount || 0,
        expectedCashAmount: session.expectedCashAmount || 0,
        closingCountedCashAmount: session.closingCountedCashAmount || 0,
        varianceAmount: session.varianceAmount || 0,
        paidOrdersCount: session.paidOrdersCount || 0,
        openingNotes: session.openingNotes,
        closingNotes: session.closingNotes,
        createdAt: new Date(),
        items
    });

    return document;
}
