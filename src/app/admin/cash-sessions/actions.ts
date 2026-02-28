"use server";

import { ensureAdminSession } from "@/lib/authz";
import CashSession from "@/models/CashSession";
import Order from "@/models/Order";
import { buildCashSessionPrintDocumentV2, PrintDocumentItemRow } from "@/lib/print-report";

function aggregateProductConsumption(orders: Array<{ cart: Array<{ productId: { toString(): string }; snapshotName: string; quantity: number; lineTotal?: number }> }>): PrintDocumentItemRow[] {
    const productMap = new Map<string, { name: string; quantity: number; total: number }>();

    for (const order of orders) {
        for (const item of order.cart) {
            const key = item.productId.toString();
            const existing = productMap.get(key) || { name: item.snapshotName, quantity: 0, total: 0 };
            existing.quantity += item.quantity;
            existing.total += (item.lineTotal || 0);
            productMap.set(key, existing);
        }
    }

    return Array.from(productMap.values())
        .map(p => ({ name: p.name, qty: p.quantity, lineTotal: p.total }))
        .sort((a, b) => b.qty - a.qty);
}

export async function getClosedCashSessionPrintDocumentAction(sessionId: string, posDeviceName?: string) {
    await ensureAdminSession();

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
    }).lean();

    const items = aggregateProductConsumption(orders);

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
