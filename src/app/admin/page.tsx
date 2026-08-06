import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CreditCard, Download, Receipt, Wallet } from "lucide-react";
import { getAdminContextEvent } from "@/lib/events";
import dbConnect from "@/lib/mongoose";
import Order from "@/models/Order";
import Product from "@/models/Product";
import CashSession from "@/models/CashSession";
import "@/models/PosDevice";
import type { IEvent } from "@/models/Event";
import {
    computeDashboardStats,
    formatDashboardDateTime,
    getPaymentMethodLabel,
    type DashboardOrderInput,
    type DashboardProductInput
} from "@/lib/dashboard-stats";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrandSectionHeader } from "@/components/brand/brand-section-header";
import { CashSessionPreviewDialog } from "@/components/cash-session-preview-dialog";
import { CashSessionAdminActions } from "@/components/cash-session-admin-actions";

const currencyFormatter = new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR"
});

const numberFormatter = new Intl.NumberFormat("it-IT");

interface OrderProjection {
    _id: unknown
    status?: string
    createdAt?: Date | string
    totalAmount?: number
    paymentMethod?: string
    cart?: Array<{
        productId?: unknown
        snapshotName?: string
        quantity?: number
    }>
}

interface ProductProjection {
    _id: unknown
    name: string
}

interface CashSessionProjection {
    _id: unknown
    status?: "OPEN" | "CLOSED"
    openedAt?: Date | string
    closedAt?: Date | string
    openingFloatAmount?: number
    closingCountedCashAmount?: number
    paidOrdersCount?: number
    expectedCashAmount?: number
    varianceAmount?: number
    isTest?: boolean
    posDeviceId?: {
        _id?: unknown
        name?: string
    } | unknown
}

function formatCurrency(value: number): string {
    return currencyFormatter.format(value)
}

function getPosDeviceName(value: CashSessionProjection["posDeviceId"]): string {
    if (!value || typeof value !== "object") return "Postazione non trovata"
    const withName = value as { name?: string }
    return withName.name?.trim() || "Postazione non trovata"
}

export default async function AdminDashboard() {
    const contextEvent = await getAdminContextEvent() as IEvent | null;

    if (!contextEvent) {
        return (
            <div className="text-center p-10 text-muted-foreground">
                Nessuna festa attiva o selezionata. Seleziona una festa dalla barra in alto.
            </div>
        );
    }

    const eventId = String(contextEvent._id);
    await dbConnect();

    const cashSessions = await CashSession.find({ eventId })
        .sort({ openedAt: -1 })
        .populate({ path: "posDeviceId", select: "_id name" })
        .select("_id status isTest openedAt closedAt openingFloatAmount closingCountedCashAmount paidOrdersCount expectedCashAmount varianceAmount posDeviceId")
        .lean() as CashSessionProjection[];
    const excludedSessionIds = cashSessions.filter((session) => session.status === "CLOSED" && session.isTest).map((session) => session._id);
    const [orders, products] = await Promise.all([
        Order.find({ eventId, status: "PAID", cashSessionId: { $nin: excludedSessionIds } })
            .sort({ createdAt: -1 })
            .select("_id status createdAt totalAmount paymentMethod cart")
            .lean() as Promise<OrderProjection[]>,
        Product.find({ eventId }).select("_id name").lean() as Promise<ProductProjection[]>
    ]);

    const dashboardOrders: DashboardOrderInput[] = orders.map((order) => ({
        id: String(order._id),
        status: order.status || "PAID",
        createdAt: order.createdAt || null,
        totalAmount: order.totalAmount ?? 0,
        paymentMethod: order.paymentMethod || "OTHER",
        cart: Array.isArray(order.cart)
            ? order.cart.map((item) => ({
                productId: item.productId ? String(item.productId) : null,
                snapshotName: item.snapshotName || null,
                quantity: item.quantity ?? 0
            }))
            : []
    }));

    const dashboardProducts: DashboardProductInput[] = products.map((product) => ({
        id: String(product._id),
        name: product.name
    }));

    const stats = computeDashboardStats({
        orders: dashboardOrders,
        products: dashboardProducts,
        bestSellerLimit: 8,
        underperformingLimit: 8,
        underperformingThreshold: 1
    });

    const kpis = [
        {
            title: "Incasso Totale",
            value: formatCurrency(stats.summary.totalRevenue),
            description: "Ordini saldati evento corrente",
            icon: <Wallet className="h-4 w-4 text-slate-500" />,
            testId: "dashboard-kpi-total"
        },
        {
            title: "Incasso Contanti",
            value: formatCurrency(stats.summary.cashRevenue),
            description: "Pagamenti CASH",
            icon: <ArrowDownRight className="h-4 w-4 text-emerald-600" />,
            testId: "dashboard-kpi-cash"
        },
        {
            title: "Incasso Carta / POS",
            value: formatCurrency(stats.summary.cardRevenue),
            description: "Pagamenti elettronici",
            icon: <CreditCard className="h-4 w-4 text-blue-600" />,
            testId: "dashboard-kpi-card"
        },
        {
            title: "Ordini Saldati",
            value: numberFormatter.format(stats.summary.paidOrdersCount),
            description: "Totale operazioni concluse",
            icon: <Receipt className="h-4 w-4 text-violet-600" />,
            testId: "dashboard-kpi-orders"
        },
        {
            title: "Ticket Medio",
            value: formatCurrency(stats.summary.averageTicket),
            description: "Incasso medio per ordine",
            icon: <ArrowUpRight className="h-4 w-4 text-amber-600" />,
            testId: "dashboard-kpi-average"
        }
    ];

    return (
        <div className="space-y-6" data-testid="admin-dashboard-brand-shell">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <BrandSectionHeader title="Dashboard Statistiche" />
                    <p className="text-muted-foreground">
                        Festa: <span className="font-semibold text-foreground">{contextEvent.name}</span> · Aggiornata alle{" "}
                        {formatDashboardDateTime(stats.generatedAt)}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm">
                        <Link href="/admin/export?format=csv">
                            <Download className="h-4 w-4" />
                            Export CSV
                        </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/admin/export?format=xlsx">
                            <Download className="h-4 w-4" />
                            Export Excel
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {kpis.map((kpi) => (
                    <Card key={kpi.title} className="border-[#d9e6f8] shadow-sm">
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-medium">{kpi.title}</CardTitle>
                                {kpi.icon}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-black tracking-tight" data-testid={kpi.testId}>
                                {kpi.value}
                            </div>
                            <CardDescription>{kpi.description}</CardDescription>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Card className="border-[#d9e6f8] shadow-sm">
                    <CardHeader>
                        <CardTitle>Top Prodotti</CardTitle>
                        <CardDescription>Classifica per quantita venduta.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[70px]">#</TableHead>
                                    <TableHead>Prodotto</TableHead>
                                    <TableHead className="text-right">Quantita</TableHead>
                                    <TableHead className="text-right">Ordini</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.bestSellers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                                            Nessun ordine saldato per questa festa.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    stats.bestSellers.map((metric, index) => (
                                        <TableRow key={metric.productId}>
                                            <TableCell className="font-semibold">#{index + 1}</TableCell>
                                            <TableCell className="font-medium">{metric.productName}</TableCell>
                                            <TableCell className="text-right">{numberFormatter.format(metric.quantitySold)}</TableCell>
                                            <TableCell className="text-right">{numberFormatter.format(metric.ordersCount)}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Card className="border-[#d9e6f8] shadow-sm">
                    <CardHeader>
                        <CardTitle>Prodotti Sotto-Performanti</CardTitle>
                        <CardDescription>Prodotti con vendite minime o nulle (soglia ≤ 1).</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[70px]">#</TableHead>
                                    <TableHead>Prodotto</TableHead>
                                    <TableHead className="text-right">Quantita</TableHead>
                                    <TableHead className="text-right">Ordini</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.underperforming.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                                            Nessun prodotto sotto soglia.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    stats.underperforming.map((metric, index) => (
                                        <TableRow key={metric.productId}>
                                            <TableCell className="font-semibold">#{index + 1}</TableCell>
                                            <TableCell className="font-medium">{metric.productName}</TableCell>
                                            <TableCell className="text-right">{numberFormatter.format(metric.quantitySold)}</TableCell>
                                            <TableCell className="text-right">{numberFormatter.format(metric.ordersCount)}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-[#d9e6f8] shadow-sm">
                <CardHeader>
                    <CardTitle>Ultimi Ordini Saldati</CardTitle>
                    <CardDescription>Dettaglio operativo degli ultimi movimenti registrati.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Data</TableHead>
                                <TableHead>Ordine</TableHead>
                                <TableHead>Pagamento</TableHead>
                                <TableHead className="text-right">Articoli</TableHead>
                                <TableHead className="text-right">Importo</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {stats.paidOrders.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                                        Nessun ordine saldato disponibile.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                stats.paidOrders.slice(0, 10).map((order) => (
                                    <TableRow key={order.orderId}>
                                        <TableCell className="font-medium">{formatDashboardDateTime(order.createdAt)}</TableCell>
                                        <TableCell className="font-mono text-xs">{order.orderId}</TableCell>
                                        <TableCell>{getPaymentMethodLabel(order.paymentMethod)}</TableCell>
                                        <TableCell className="text-right">{numberFormatter.format(order.itemCount)}</TableCell>
                                        <TableCell className="text-right font-semibold">{formatCurrency(order.totalAmount)}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Sessioni Cassa</CardTitle>
                    <CardDescription>Storico aperture/chiusure postazioni cassa con download report.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table data-testid="cash-sessions-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Stato</TableHead>
                                <TableHead>Postazione</TableHead>
                                <TableHead>Apertura</TableHead>
                                <TableHead>Chiusura</TableHead>
                                <TableHead className="text-right">Fondo</TableHead>
                                <TableHead className="text-right">Contante Atteso</TableHead>
                                <TableHead className="text-right">Contato</TableHead>
                                <TableHead className="text-right">Differenza</TableHead>
                                <TableHead className="text-right">Ordini</TableHead>
                                <TableHead className="text-right">Report e azioni</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {cashSessions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                                        Nessuna sessione cassa registrata.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                cashSessions.map((session) => {
                                    const sessionId = String(session._id)
                                    const isClosed = session.status === "CLOSED"
                                    return (
                                        <TableRow key={sessionId} data-testid={`cash-session-row-${sessionId}`}>
                                            <TableCell>
                                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${isClosed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                                    {isClosed ? "Chiusa" : "Aperta"}
                                                </span>
                                                {session.isTest ? <span className="ml-1 inline-flex rounded-full bg-rose-100 px-2 py-1 text-xs font-black text-rose-700">TEST</span> : null}
                                            </TableCell>
                                            <TableCell className="font-medium">{getPosDeviceName(session.posDeviceId)}</TableCell>
                                            <TableCell>{formatDashboardDateTime(session.openedAt)}</TableCell>
                                            <TableCell>{formatDashboardDateTime(session.closedAt)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(session.openingFloatAmount ?? 0)}</TableCell>
                                            <TableCell className="text-right">
                                                {isClosed ? formatCurrency(session.expectedCashAmount ?? 0) : "-"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {isClosed ? formatCurrency(session.closingCountedCashAmount ?? 0) : "-"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {isClosed ? formatCurrency(session.varianceAmount ?? 0) : "-"}
                                            </TableCell>
                                            <TableCell className="text-right">{numberFormatter.format(session.paidOrdersCount ?? 0)}</TableCell>
                                            <TableCell className="text-right">
                                                {isClosed ? (
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        <CashSessionPreviewDialog
                                                            sessionId={sessionId}
                                                            posName={getPosDeviceName(session.posDeviceId)}
                                                        />
                                                        <Button asChild variant="outline" size="sm">
                                                            <Link
                                                                href={`/admin/cash-sessions/export?sessionId=${sessionId}&format=csv`}
                                                                data-testid={`cash-session-report-csv-${sessionId}`}
                                                            >
                                                                CSV
                                                            </Link>
                                                        </Button>
                                                        <Button asChild variant="outline" size="sm">
                                                            <Link
                                                                href={`/admin/cash-sessions/export?sessionId=${sessionId}&format=xlsx`}
                                                                data-testid={`cash-session-report-xls-${sessionId}`}
                                                            >
                                                                XLSX
                                                            </Link>
                                                        </Button>
                                                        <CashSessionAdminActions sessionId={sessionId} isClosed={isClosed} isTest={Boolean(session.isTest)} />
                                                    </div>
                                                ) : (
                                                    <CashSessionAdminActions sessionId={sessionId} isClosed={isClosed} isTest={Boolean(session.isTest)} />
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
