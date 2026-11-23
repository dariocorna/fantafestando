import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminContextEvent } from "@/lib/events";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import CashSession from "@/models/CashSession";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import type { IEvent } from "@/models/Event";
import { OrderRowActions } from "./order-row-actions";
import { OrderDateTime } from "./order-date-time";
import { ResetOrdersForm } from "./reset-orders-form";

const ORDERS_PER_PAGE = 50

interface OrderProjection {
    _id: unknown
    status: "PENDING" | "PAID" | "CANCELLED"
    createdAt?: Date | string
    customer?: { name?: string, table?: string }
    cart: Array<{ quantity: number, snapshotName: string }>
    totalAmount: number
    discountApplied?: number
    paymentMethod?: "CASH" | "CARD" | "OTHER"
    sumupCheckoutId?: string
    sumupPaymentId?: string
    sumupInitiatedAt?: Date | string
    sumupLateSuccessDetectedAt?: Date | string
    stornoMeta?: {
        reason?: string
        refundStatus?: "SKIPPED" | "DONE" | "FAILED"
    }
}

function getPaymentMethodLabel(paymentMethod?: "CASH" | "CARD" | "OTHER") {
    if (paymentMethod === "CASH") return "Contanti"
    if (paymentMethod === "CARD") return "Carta / POS"
    return "Altro"
}

export default async function AdminOrders({
    searchParams
}: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
    const contextEvent = await getAdminContextEvent() as IEvent | null
    if (!contextEvent) {
        return (
            <div className="text-center p-10 text-muted-foreground">
                Nessuna festa attiva o selezionata. Seleziona una festa dalla barra in alto.
            </div>
        )
    }

    const eventId = String(contextEvent._id)
    const resolvedSearchParams: Record<string, string | string[] | undefined> = searchParams
        ? await searchParams
        : {}
    const rawPage = Array.isArray(resolvedSearchParams.page) ? resolvedSearchParams.page[0] : resolvedSearchParams.page
    const parsedPage = Number(rawPage)
    const requestedPage = rawPage && /^\d+$/.test(rawPage) && Number.isSafeInteger(parsedPage) && parsedPage > 0
        ? parsedPage
        : 1
    await dbConnect();
    const excludedSessionIds = (await CashSession.find({ eventId, isTest: true }).select("_id").lean() as Array<{ _id: unknown }>).map((session) => session._id)
    const orderFilter = {
        eventId: contextEvent._id,
        $or: [
            {
                status: { $in: ["PAID", "CANCELLED"] },
                cashSessionId: { $nin: excludedSessionIds }
            },
            {
                status: "PENDING",
                sumupCheckoutId: { $type: "string", $ne: "" },
                sumupPaymentId: { $in: [null, ""] },
                cashSessionId: { $nin: excludedSessionIds }
            },
            {
                status: "CANCELLED",
                sumupLateSuccessDetectedAt: { $exists: true, $ne: null },
                "stornoMeta.refundStatus": { $ne: "DONE" }
            }
        ]
    }
    const [totalOrders, revenueSummary] = await Promise.all([
        Order.countDocuments(orderFilter),
        Order.aggregate<{ totalRevenue: number }>([
            { $match: { ...orderFilter, status: "PAID" } },
            { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" } } }
        ])
    ])
    const totalPages = Math.max(1, Math.ceil(totalOrders / ORDERS_PER_PAGE))
    const currentPage = Math.min(requestedPage, totalPages)
    const hasCanonicalPageParam = currentPage === 1
        ? resolvedSearchParams.page === undefined
        : typeof resolvedSearchParams.page === "string" && resolvedSearchParams.page === String(currentPage)
    if (!hasCanonicalPageParam) {
        redirect(currentPage === 1 ? "/admin/orders" : `/admin/orders?page=${currentPage}`)
    }
    const orders = await Order.find(orderFilter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((currentPage - 1) * ORDERS_PER_PAGE)
        .limit(ORDERS_PER_PAGE)
        .select("_id status createdAt customer cart totalAmount discountApplied paymentMethod stornoMeta.reason stornoMeta.refundStatus sumupCheckoutId sumupPaymentId sumupInitiatedAt sumupLateSuccessDetectedAt")
        .lean() as OrderProjection[]
    const totalRevenue = revenueSummary[0]?.totalRevenue ?? 0
    const firstOrder = totalOrders === 0 ? 0 : (currentPage - 1) * ORDERS_PER_PAGE + 1
    const lastOrder = Math.min(currentPage * ORDERS_PER_PAGE, totalOrders)

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Storico Ordini</h1>
                    <p className="text-muted-foreground">
                        Festa selezionata: <span className="font-semibold text-foreground">{contextEvent.name}</span>
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-900 border p-4 rounded-xl shadow-sm">
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Totale Incasso Netto</span>
                    <div className="text-2xl font-black text-green-600">{totalRevenue.toFixed(2)} €</div>
                </div>
            </div>

            <ResetOrdersForm eventName={contextEvent.name} />

            <div className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Stato</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Tavolo</TableHead>
                            <TableHead>Prodotti</TableHead>
                            <TableHead>Pagamento</TableHead>
                            <TableHead className="text-right">Sconto</TableHead>
                            <TableHead className="text-right">Importo</TableHead>
                            <TableHead className="text-right w-[180px]">Azioni</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {orders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="text-center py-10 text-slate-400 font-medium">
                                    Nessun ordine trovato.
                                </TableCell>
                            </TableRow>
                        ) : (
                            orders.map((order) => (
                                <TableRow key={String(order._id)} data-testid={`order-row-${String(order._id)}`}>
                                    <TableCell className="font-medium whitespace-nowrap">
                                        <OrderDateTime value={order.createdAt ? new Date(order.createdAt).toISOString() : null} />
                                    </TableCell>
                                    <TableCell>
                                        {order.status === "PAID" ? (
                                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                                                Pagato
                                            </span>
                                        ) : order.status === "PENDING" ? (
                                            <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                                                SumUp da verificare
                                            </span>
                                        ) : order.sumupLateSuccessDetectedAt && order.stornoMeta?.refundStatus !== "DONE" ? (
                                            <span className="inline-flex rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-800">
                                                SumUp tardivo da rimborsare
                                            </span>
                                        ) : (
                                            <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700">
                                                Stornato
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>{order.customer?.name || "-"}</TableCell>
                                    <TableCell className="font-bold">{order.customer?.table || "-"}</TableCell>
                                    <TableCell>
                                        <div className="max-w-[200px] truncate" title={order.cart.map((i) => `${i.quantity}x ${i.snapshotName}`).join(", ")}>
                                            {order.cart.map((i) => `${i.quantity}x ${i.snapshotName}`).join(", ")}
                                        </div>
                                        {order.status === "CANCELLED" && order.stornoMeta?.reason ? (
                                            <p className="mt-1 text-xs font-semibold text-rose-600">
                                                Motivo storno: {order.stornoMeta.reason}
                                            </p>
                                        ) : null}
                                    </TableCell>
                                    <TableCell>{getPaymentMethodLabel(order.paymentMethod)}</TableCell>
                                    <TableCell className="text-right font-semibold text-amber-700">
                                        {(order.discountApplied ?? 0).toFixed(2)} €
                                    </TableCell>
                                    <TableCell className={`text-right font-black ${order.status === "PAID" ? "text-blue-600" : "text-slate-400 line-through"}`}>
                                        {order.totalAmount.toFixed(2)} €
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <OrderRowActions
                                            orderId={String(order._id)}
                                            canReprint={order.status === "PAID"}
                                            canStorno={order.status === "PAID" || Boolean(order.sumupLateSuccessDetectedAt && order.stornoMeta?.refundStatus !== "DONE")}
                                            isLateSumUpRefund={Boolean(order.sumupLateSuccessDetectedAt && order.stornoMeta?.refundStatus !== "DONE")}
                                            canRecoverSumUp={order.status === "PENDING" && Boolean(order.sumupCheckoutId?.trim()) && !order.sumupPaymentId?.trim()}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {totalPages > 1 ? (
                <nav aria-label="Paginazione storico ordini" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                        Ordini {firstOrder}–{lastOrder} di {totalOrders}
                    </p>
                    <div className="flex items-center gap-3">
                        {currentPage > 1 ? (
                            <Button asChild variant="outline" size="sm">
                                <Link href={currentPage === 2 ? "/admin/orders" : `/admin/orders?page=${currentPage - 1}`} aria-label="Pagina precedente">
                                    Precedente
                                </Link>
                            </Button>
                        ) : (
                            <Button variant="outline" size="sm" disabled aria-label="Pagina precedente">
                                Precedente
                            </Button>
                        )}
                        <span className="text-sm font-medium" aria-current="page">
                            Pagina {currentPage} di {totalPages}
                        </span>
                        {currentPage < totalPages ? (
                            <Button asChild variant="outline" size="sm">
                                <Link href={`/admin/orders?page=${currentPage + 1}`} aria-label="Pagina successiva">
                                    Successiva
                                </Link>
                            </Button>
                        ) : (
                            <Button variant="outline" size="sm" disabled aria-label="Pagina successiva">
                                Successiva
                            </Button>
                        )}
                    </div>
                </nav>
            ) : null}
        </div>
    );
}
