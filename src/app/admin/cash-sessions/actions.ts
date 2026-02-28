"use server";

import { ensureAdminSession } from "@/lib/authz";
import CashSession from "@/models/CashSession";
import { buildCashSessionPrintDocumentV2 } from "@/lib/print-report";

export async function getClosedCashSessionPrintDocumentAction(sessionId: string) {
    await ensureAdminSession();

    const session = await CashSession.findById(sessionId).populate("eventId").lean();
    if (!session) {
        throw new Error("Sessione cassa non trovata.");
    }

    if (session.status !== "CLOSED") {
        throw new Error("La sessione di cassa deve essere chiusa per visualizzare il report.");
    }

    const document = buildCashSessionPrintDocumentV2({
        sessionId: session._id.toString(),
        eventName: session.eventId.name,
        posDeviceName: "Da Backend", // Just a fallback for preview
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt!.toISOString(),
        openingFloatAmount: session.openingTotals?.expectedFloatAmount || 0,
        cashSalesAmount: session.closingTotals?.cashSalesAmount || 0,
        cardSalesAmount: session.closingTotals?.cardSalesAmount || 0,
        otherSalesAmount: session.closingTotals?.otherSalesAmount || 0,
        expectedCashAmount: session.closingTotals?.expectedCashAmount || 0,
        closingCountedCashAmount: session.closingTotals?.countedCashAmount || 0,
        varianceAmount: session.closingTotals?.varianceAmount || 0,
        paidOrdersCount: session.ordersCount || 0,
        openingNotes: session.openingNotes,
        closingNotes: session.closingNotes,
        createdAt: new Date(),
    });

    return document;
}
