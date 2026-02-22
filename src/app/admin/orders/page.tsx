import dbConnect from "@/lib/mongoose";
import Order, { IOrder } from "@/models/Order";
import { IEvent } from "@/models/Event";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { reprintOrder } from "./actions";

export default async function AdminOrders() {
    await dbConnect();
    const orders = await Order.find({}).sort({ createdAt: -1 }).populate('eventId').lean();

    const getTotalRevenue = () => orders.reduce((acc: number, o: IOrder) => acc + o.totalAmount, 0);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Storico Ordini</h1>
                    <p className="text-muted-foreground">Monitoraggio vendite e ordini saldati.</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border p-4 rounded-xl shadow-sm">
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Totale Incasso</span>
                    <div className="text-2xl font-black text-green-600">{getTotalRevenue().toFixed(2)} €</div>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Festa</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Tavolo</TableHead>
                            <TableHead>Prodotti</TableHead>
                            <TableHead className="text-right">Importo</TableHead>
                            <TableHead className="text-right w-[100px]">Azioni</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {orders.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-10 text-slate-400 font-medium">
                                    Nessun ordine trovato.
                                </TableCell>
                            </TableRow>
                        ) : (
                            orders.map((order: IOrder) => (
                                <TableRow key={String(order._id)}>
                                    <TableCell className="font-medium whitespace-nowrap">
                                        {format(new Date(order.createdAt as unknown as string), "dd/MM/yyyy HH:mm")}
                                    </TableCell>
                                    <TableCell>{(order.eventId as unknown as IEvent)?.name || "N/A"}</TableCell>
                                    <TableCell>{order.customer?.name || "-"}</TableCell>
                                    <TableCell className="font-bold">{order.customer?.table || "-"}</TableCell>
                                    <TableCell>
                                        <div className="max-w-[200px] truncate" title={order.cart.map((i) => `${i.quantity}x ${i.snapshotName}`).join(", ")}>
                                            {order.cart.map((i) => `${i.quantity}x ${i.snapshotName}`).join(", ")}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-black text-blue-600">
                                        {order.totalAmount.toFixed(2)} €
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <form action={reprintOrder}>
                                            <input type="hidden" name="orderId" value={String(order._id)} />
                                            <Button variant="ghost" size="sm" title="Ristampa comanda">
                                                <Printer className="h-4 w-4" />
                                            </Button>
                                        </form>
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

