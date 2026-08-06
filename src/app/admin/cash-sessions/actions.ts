"use server";

import { ensureAdminSession } from "@/lib/authz";
import CashSession from "@/models/CashSession";
import Order from "@/models/Order";
import Product from "@/models/Product";
import PrintJob from "@/models/PrintJob";
import PosDevice from "@/models/PosDevice";
import dbConnect from "@/lib/mongoose";
import { transitionCashSessionStock } from "@/lib/cash-session-stock";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { PrinterService } from "@/lib/printer";
import { buildCashSessionPrintDocumentV2 } from "@/lib/print-report";
import {
    aggregateOrderProductSales,
    buildProductSalesPrintRows,
    type ProductConsumptionCatalogEntry,
    type ProductConsumptionOrder
} from "@/lib/product-consumption";

export async function getClosedCashSessionPrintDocumentAction(sessionId: string, _posDeviceName?: string) {
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
    const posDevice = session.posDeviceId
        ? await PosDevice.findById(session.posDeviceId).select("name").lean() as ({ name?: string } | null)
        : null;

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
        isTest: Boolean(session.isTest),
        eventName: (session.eventId as { name: string }).name,
        posDeviceName: posDevice?.name || _posDeviceName || "Sessione Cassa",
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

async function hasUnrefundedSumUpOrders(sessionId: string) {
    return Boolean(await Order.exists({
        cashSessionId: sessionId,
        status: "PAID",
        $or: [{ sumupCheckoutId: { $exists: true, $ne: "" } }, { sumupPaymentId: { $exists: true, $ne: "" } }]
    }))
}

export async function setCashSessionTestAction(sessionId: string, isTest: boolean) {
    const sessionCheck = await ensureAdminSession();
    if (!sessionCheck.ok) return { success: false as const, error: sessionCheck.error };
    await dbConnect();
    const session = await CashSession.findById(sessionId);
    if (!session) return { success: false as const, error: "Sessione cassa non trovata" };
    if (Boolean(session.isTest) === isTest) return { success: true as const, approximateOrders: 0 };

    if (session.status === "OPEN") {
        session.isTest = isTest;
        await session.save();
        revalidatePath("/admin");
        revalidatePath("/pos");
        return { success: true as const, approximateOrders: 0 };
    }

    if (isTest && await hasUnrefundedSumUpOrders(sessionId)) {
        return { success: false as const, error: "Storna e rimborsa i pagamenti SumUp prima di classificare la sessione come TEST" };
    }

    const type = isTest ? "TO_TEST" : "TO_NORMAL";
    const token = session.transition?.type === type && session.transition.token
        ? session.transition.token
        : randomUUID();
    session.transition = { token, type, status: "IN_PROGRESS" };
    await session.save();
    const result = await transitionCashSessionStock({
        eventId: session.eventId.toString(),
        sessionId,
        token,
        target: isTest ? "REVERTED" : "APPLIED"
    });
    if (!result.success) {
        session.transition = { token, type, status: "FAILED", error: result.error };
        await session.save();
        return { success: false as const, error: result.error, shortages: result.shortages };
    }

    session.isTest = isTest;
    session.stockEffectStatus = isTest ? "REVERTED" : "APPLIED";
    session.set("transition", undefined);
    await session.save();
    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    return { success: true as const, approximateOrders: result.approximateOrders };
}

export async function deleteCashSessionAction(sessionId: string, confirmation: string) {
    const sessionCheck = await ensureAdminSession();
    if (!sessionCheck.ok) return { success: false as const, error: sessionCheck.error };
    if (confirmation.trim() !== "ELIMINA") return { success: false as const, error: "Digita ELIMINA per confermare" };
    await dbConnect();
    const session = await CashSession.findOne({ _id: sessionId, status: "CLOSED" });
    if (!session) return { success: false as const, error: "È possibile eliminare soltanto una sessione chiusa" };
    if (await hasUnrefundedSumUpOrders(sessionId)) return { success: false as const, error: "Storna e rimborsa i pagamenti SumUp prima di eliminare la sessione" };

    const token = session.transition?.type === "DELETE" && session.transition.token ? session.transition.token : randomUUID();
    session.deletionStatus = "IN_PROGRESS";
    session.transition = { token, type: "DELETE", status: "IN_PROGRESS" };
    await session.save();
    if (session.stockEffectStatus !== "REVERTED") {
        const stockResult = await transitionCashSessionStock({ eventId: session.eventId.toString(), sessionId, token, target: "REVERTED" });
        if (!stockResult.success) {
            session.deletionStatus = "FAILED";
            session.transition = { token, type: "DELETE", status: "FAILED", error: stockResult.error };
            await session.save();
            return { success: false as const, error: stockResult.error };
        }
        session.stockEffectStatus = "REVERTED";
        await session.save();
    }

    const orderIds = (await Order.find({ cashSessionId: sessionId }).select("_id").lean() as Array<{ _id: { toString(): string } }>).map((order) => order._id.toString());
    await PrintJob.deleteMany({ eventId: session.eventId, $or: [{ orderId: { $in: orderIds } }, { source: "CASH_SESSION", "document.sessionId": sessionId }] });
    await Order.deleteMany({ cashSessionId: sessionId });
    await CashSession.deleteOne({ _id: sessionId });
    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    return { success: true as const };
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
