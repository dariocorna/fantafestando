"use server";

import { ensureAdminSession } from "@/lib/authz";
import { getAdminContextEventId } from "@/lib/events";
import CashSession from "@/models/CashSession";
import Order from "@/models/Order";
import Product from "@/models/Product";
import PrintJob from "@/models/PrintJob";
import PosDevice from "@/models/PosDevice";
import dbConnect from "@/lib/mongoose";
import { transitionCashSessionStock } from "@/lib/cash-session-stock";
import { buildCashSessionTransitionClaim, cashSessionTransitionGuard } from "@/lib/cash-session-transition";
import { hasPendingSumUpCheckouts, noActivePaymentClaim } from "@/lib/cash-session-payment-claim";
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
        $or: [
            {
                status: "PAID",
                $or: [
                    { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                    { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                ]
            },
            {
                status: "CANCELLED",
                sumupLateSuccessDetectedAt: { $exists: true, $ne: null },
                "stornoMeta.refundStatus": { $ne: "DONE" }
            }
        ]
    }))
}

export async function setCashSessionTestAction(sessionId: string, isTest: boolean) {
    const sessionCheck = await ensureAdminSession();
    if (!sessionCheck.ok) return { success: false as const, error: sessionCheck.error };
    await dbConnect();
    const session = await CashSession.findById(sessionId);
    if (!session) return { success: false as const, error: "Sessione cassa non trovata" };
    if (Boolean(session.isTest) === isTest) return { success: true as const, approximateOrders: 0 };

    const type = isTest ? "TO_TEST" : "TO_NORMAL";
    const claim = buildCashSessionTransitionClaim(session.transition, type);
    if (!claim.success) return { success: false as const, error: claim.error, shortages: undefined };
    const { token } = claim;
    const claimedSession = await CashSession.findOneAndUpdate(
        {
            _id: sessionId,
            status: session.status === "OPEN" ? "OPEN" : "CLOSED",
            isTest: { $ne: isTest },
            $and: [claim.guard, noActivePaymentClaim(claim.transition.claimedAt)]
        },
        { $set: { transition: claim.transition }, $unset: { paymentClaim: 1 } },
        { returnDocument: "after" }
    );
    if (!claimedSession) {
        return { success: false as const, error: "Chiusura o pagamento in corso sulla sessione", shortages: undefined };
    }

    let blockingError: string | undefined;
    if (isTest && await hasUnrefundedSumUpOrders(sessionId)) {
        blockingError = "Storna e rimborsa i pagamenti SumUp prima di classificare la sessione come TEST";
    } else if (isTest && await hasPendingSumUpCheckouts(sessionId)) {
        blockingError = "Completa o annulla i pagamenti SumUp in attesa prima di classificare la sessione come TEST";
    }
    if (blockingError) {
        await CashSession.updateOne(
            cashSessionTransitionGuard(sessionId, claim.transition),
            { $unset: { transition: 1 } }
        );
        return { success: false as const, error: blockingError };
    }

    if (session.status === "OPEN") {
        const updated = await CashSession.updateOne(
            { ...cashSessionTransitionGuard(sessionId, claim.transition), status: "OPEN" },
            { $set: { isTest }, $unset: { transition: 1 } }
        );
        if ((updated.matchedCount ?? updated.modifiedCount) !== 1) {
            return { success: false as const, error: "Transizione interrotta: riprova per completarla", shortages: undefined };
        }
        revalidatePath("/admin");
        revalidatePath("/pos");
        return { success: true as const, approximateOrders: 0 };
    }

    const result = await transitionCashSessionStock({
        eventId: claimedSession.eventId.toString(),
        sessionId,
        token,
        target: isTest ? "REVERTED" : "APPLIED"
    });
    if (!result.success) {
        await CashSession.updateOne(
            cashSessionTransitionGuard(sessionId, claim.transition),
            { $set: { transition: { ...claim.transition, status: "FAILED", error: result.error } } }
        );
        return { success: false as const, error: result.error, shortages: "shortages" in result ? result.shortages : undefined };
    }

    const finalized = await CashSession.updateOne(
        cashSessionTransitionGuard(sessionId, claim.transition),
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
    // scope every destructive query to the selected event: a foreign session id must not
    // delete another event's orders and print jobs
    const eventId = await getAdminContextEventId();
    if (!eventId) return { success: false as const, error: "Nessuna festa selezionata" };
    const session = await CashSession.findOne({ _id: sessionId, eventId, status: "CLOSED" });
    if (!session) return { success: false as const, error: "È possibile eliminare soltanto una sessione chiusa della festa selezionata" };
    const type = "DELETE" as const;
    const claim = buildCashSessionTransitionClaim(session.transition, type);
    if (!claim.success) return claim;
    const { token } = claim;
    const claimedSession = await CashSession.findOneAndUpdate(
        {
            _id: sessionId,
            eventId,
            status: "CLOSED",
            $and: [claim.guard, noActivePaymentClaim(claim.transition.claimedAt)]
        },
        {
            $set: {
                deletionStatus: "IN_PROGRESS",
                transition: claim.transition
            }
        },
        { returnDocument: "after" }
    );
    if (!claimedSession) return { success: false as const, error: "Un'altra transizione è già in corso sulla sessione" };

    const releaseDeleteClaim = () => CashSession.updateOne(
        cashSessionTransitionGuard(sessionId, claim.transition),
        { $unset: { transition: 1, deletionStatus: 1 } }
    );
    if (await hasUnrefundedSumUpOrders(sessionId)) {
        await releaseDeleteClaim();
        return { success: false as const, error: "Storna e rimborsa i pagamenti SumUp prima di eliminare la sessione" };
    }
    if (await hasPendingSumUpCheckouts(sessionId)) {
        await releaseDeleteClaim();
        return { success: false as const, error: "Completa o annulla i pagamenti SumUp in attesa prima di eliminare la sessione" };
    }

    if (claimedSession.stockEffectStatus !== "REVERTED") {
        const stockResult = await transitionCashSessionStock({ eventId: claimedSession.eventId.toString(), sessionId, token, target: "REVERTED" });
        if (!stockResult.success) {
            await CashSession.updateOne(
                cashSessionTransitionGuard(sessionId, claim.transition),
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
            cashSessionTransitionGuard(sessionId, claim.transition),
            { $set: { stockEffectStatus: "REVERTED" } }
        );
    }

    const orderIds = (await Order.find({ cashSessionId: sessionId }).select("_id").lean() as Array<{ _id: { toString(): string } }>).map((order) => order._id.toString());
    await PrintJob.deleteMany({ eventId: claimedSession.eventId, $or: [{ orderId: { $in: orderIds } }, { source: "CASH_SESSION", "document.sessionId": sessionId }] });
    await Order.deleteMany({ cashSessionId: sessionId });
    await CashSession.deleteOne(cashSessionTransitionGuard(sessionId, claim.transition));
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
