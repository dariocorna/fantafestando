"use server";

import { ensureAdminSession } from "@/lib/authz";
import CashSession from "@/models/CashSession";
import Order from "@/models/Order";
import Product from "@/models/Product";
import PrintJob from "@/models/PrintJob";
import PosDevice from "@/models/PosDevice";
import dbConnect from "@/lib/mongoose";
import { transitionCashSessionStock } from "@/lib/cash-session-stock";
import { buildCashSessionTransitionClaim, CASH_SESSION_TRANSITION_LEASE_MS } from "@/lib/cash-session-transition";
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
        const updated = await CashSession.updateOne(
            {
                _id: sessionId,
                status: "OPEN",
                transition: { $exists: false },
                $or: [
                    { paymentClaim: { $exists: false } },
                    { paymentClaim: null },
                    { "paymentClaim.claimedAt": { $lte: new Date(Date.now() - CASH_SESSION_TRANSITION_LEASE_MS) } }
                ]
            },
            { $set: { isTest }, $unset: { paymentClaim: 1 } }
        );
        if ((updated.matchedCount ?? updated.modifiedCount) !== 1) {
            return { success: false as const, error: "Chiusura o pagamento in corso sulla sessione", shortages: undefined };
        }
        revalidatePath("/admin");
        revalidatePath("/pos");
        return { success: true as const, approximateOrders: 0 };
    }

    if (isTest && await hasUnrefundedSumUpOrders(sessionId)) {
        return { success: false as const, error: "Storna e rimborsa i pagamenti SumUp prima di classificare la sessione come TEST" };
    }

    const type = isTest ? "TO_TEST" : "TO_NORMAL";
    const claim = buildCashSessionTransitionClaim(session.transition, type);
    if (!claim.success) return { success: false as const, error: claim.error, shortages: undefined };
    const { token } = claim;
    const claimedSession = await CashSession.findOneAndUpdate(
        { _id: sessionId, status: "CLOSED", isTest: { $ne: isTest }, ...claim.guard },
        { $set: { transition: claim.transition } },
        { returnDocument: "after" }
    );
    if (!claimedSession) {
        return { success: false as const, error: "Un'altra transizione è già in corso sulla sessione" };
    }
    const result = await transitionCashSessionStock({
        eventId: claimedSession.eventId.toString(),
        sessionId,
        token,
        target: isTest ? "REVERTED" : "APPLIED"
    });
    if (!result.success) {
        await CashSession.updateOne(
            { _id: sessionId, "transition.token": token, "transition.type": type, "transition.claimedAt": claim.transition.claimedAt },
            { $set: { transition: { ...claim.transition, status: "FAILED", error: result.error } } }
        );
        return { success: false as const, error: result.error, shortages: result.shortages };
    }

    const finalized = await CashSession.updateOne(
        { _id: sessionId, "transition.token": token, "transition.type": type, "transition.claimedAt": claim.transition.claimedAt },
        {
            $set: { isTest, stockEffectStatus: isTest ? "REVERTED" : "APPLIED" },
            $unset: { transition: 1 }
        }
    );
    if (finalized.matchedCount !== 1) {
        return { success: false as const, error: "Transizione interrotta: riprova per completarla" };
    }
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

    const type = "DELETE" as const;
    const claim = buildCashSessionTransitionClaim(session.transition, type);
    if (!claim.success) return claim;
    const { token } = claim;
    const claimedSession = await CashSession.findOneAndUpdate(
        { _id: sessionId, status: "CLOSED", ...claim.guard },
        {
            $set: {
                deletionStatus: "IN_PROGRESS",
                transition: claim.transition
            }
        },
        { returnDocument: "after" }
    );
    if (!claimedSession) return { success: false as const, error: "Un'altra transizione è già in corso sulla sessione" };

    if (claimedSession.stockEffectStatus !== "REVERTED") {
        const stockResult = await transitionCashSessionStock({ eventId: claimedSession.eventId.toString(), sessionId, token, target: "REVERTED" });
        if (!stockResult.success) {
            await CashSession.updateOne(
                { _id: sessionId, "transition.token": token, "transition.type": type, "transition.claimedAt": claim.transition.claimedAt },
                {
                    $set: {
                        deletionStatus: "FAILED",
                        transition: { ...claim.transition, status: "FAILED", error: stockResult.error }
                    }
                }
            );
            return { success: false as const, error: stockResult.error };
        }
        await CashSession.updateOne(
            { _id: sessionId, "transition.token": token, "transition.type": type, "transition.claimedAt": claim.transition.claimedAt },
            { $set: { stockEffectStatus: "REVERTED" } }
        );
    }

    const orderIds = (await Order.find({ cashSessionId: sessionId }).select("_id").lean() as Array<{ _id: { toString(): string } }>).map((order) => order._id.toString());
    await PrintJob.deleteMany({ eventId: claimedSession.eventId, $or: [{ orderId: { $in: orderIds } }, { source: "CASH_SESSION", "document.sessionId": sessionId }] });
    await Order.deleteMany({ cashSessionId: sessionId });
    await CashSession.deleteOne({ _id: sessionId, "transition.token": token, "transition.type": type, "transition.claimedAt": claim.transition.claimedAt });
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
