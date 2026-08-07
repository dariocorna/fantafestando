"use server";

import { ensureAdminSession } from "@/lib/authz";
import dbConnect from "@/lib/mongoose";
import { PrinterService } from "@/lib/printer";
import CashSession from "@/models/CashSession";
import Order from "@/models/Order";
import Product from "@/models/Product";
import { buildCashSessionPrintDocumentV2 } from "@/lib/print-report";
import {
    aggregateOrderProductSales,
    buildProductSalesPrintRows,
    type ProductConsumptionCatalogEntry,
    type ProductConsumptionOrder
} from "@/lib/product-consumption";

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
    }).lean() as ProductConsumptionOrder[];

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
        })
            .select("_id name shortName basePrice categoryId")
            .populate("categoryId", "name printOrder")
            .lean() as Array<{
                _id: { toString(): string } | string
                name?: string
                shortName?: string
                basePrice?: number
                categoryId?: { name?: string; printOrder?: number }
            }>
        : [];

    const catalogByProductId = new Map<string, ProductConsumptionCatalogEntry>(
        catalogProducts.map((product) => [
            product._id.toString(),
            {
                name: product.name,
                shortName: product.shortName,
                basePrice: product.basePrice,
                categoryName: product.categoryId?.name,
                categoryOrder: product.categoryId?.printOrder
            }
        ] as const)
    );

    const salesBreakdown = aggregateOrderProductSales({
        orders,
        catalogByProductId
    });
    const items = buildProductSalesPrintRows(salesBreakdown);

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
        grossSalesAmount: salesBreakdown.totals.grossAmount,
        discountSalesAmount: salesBreakdown.totals.discountAmount,
        discountSummaries: salesBreakdown.discountSummaries.map((summary) => ({
            label: summary.label,
            amount: summary.discountAmount
        })),
        createdAt: new Date(),
        items
    });

    return document;
}

export async function reprintClosedCashSessionAction(sessionId: string) {
    const sessionCheck = await ensureAdminSession();
    if (!sessionCheck.ok) return { success: false as const, error: sessionCheck.error };
    await dbConnect();
    const session = await CashSession.findOne({ _id: sessionId, status: "CLOSED" }).select("eventId posDeviceId").lean() as ({ eventId: { toString(): string }; posDeviceId: { toString(): string } } | null);
    if (!session) return { success: false as const, error: "Sessione chiusa non trovata" };
    const document = await getClosedCashSessionPrintDocumentAction(sessionId);
    const printed = await PrinterService.printCashSessionSummary(
        session.eventId.toString(),
        session.posDeviceId.toString(),
        {
            sessionId,
            openingFloatAmount: 0,
            cashSalesAmount: 0,
            cardSalesAmount: 0,
            otherSalesAmount: 0,
            expectedCashAmount: 0,
            closingCountedCashAmount: 0,
            varianceAmount: 0,
            paidOrdersCount: 0
        },
        document
    );
    return printed ? { success: true as const } : { success: false as const, error: "Ristampa non riuscita" };
}
