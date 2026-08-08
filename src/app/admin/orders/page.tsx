import { getAdminContextEvent } from "@/lib/events";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import CashSession from "@/models/CashSession";
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

interface OrderProjection {
    _id: unknown
    status: "PENDING" | "PAID" | "CANCELLED"
    createdAt?: Date | string
    customer?: { name?: string, table?: string }
    cart: Array<{ quantity: number, snapshotName: string }>
    totalAmount: number
    discountApplied?: number
    paymentMethod?: "CASH" | "CARD" | "OTHER"
    stornoMeta?: {
        reason?: string
    }
}

function getPaymentMethodLabel(paymentMethod?: "CASH" | "CARD" | "OTHER") {
    if (paymentMethod === "CASH") return "Contanti"
    if (paymentMethod === "CARD") return "Carta / POS"
    return "Altro"
}

export default async function AdminOrders() {
    const contextEvent = await getAdminContextEvent() as IEvent | null
    if (!contextEvent) {
        return (
            <div className="text-center p-10 text-muted-foreground">
                Nessuna festa attiva o selezionata. Seleziona una festa dalla barra in alto.
            </div>
        )
    }

    const eventId = String(contextEvent._id)
    await dbConnect();
    const excludedSessionIds = (await CashSession.find({ eventId, isTest: true }).select("_id").lean() as Array<{ _id: unknown }>).map((session) => session._id)
    const orders = await Order.find({
        eventId,
        status: { $in: ["PAID", "CANCELLED"] },
        cashSessionId: { $nin: excludedSessionIds }
    })
        .sort({ createdAt: -1 })
        .select("_id status createdAt customer cart totalAmount discountApplied paymentMethod stornoMeta.reason")
        .lean() as OrderProjection[]

    const totalRevenue = orders
        .filter((order) => order.status === "PAID")
        .reduce((acc, order) => acc + order.totalAmount, 0)

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
                                <TableRow key={String(order._id)}>
                                    <TableCell className="font-medium whitespace-nowrap">
                                        <OrderDateTime value={order.createdAt ? new Date(order.createdAt).toISOString() : null} />
                                    </TableCell>
                                    <TableCell>
                                        {order.status === "PAID" ? (
                                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                                                Pagato
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
                                            canStorno={order.status === "PAID"}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
