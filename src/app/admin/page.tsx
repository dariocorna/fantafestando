import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CreditCard, Download, Receipt, Wallet } from "lucide-react";
import { AdminDashboardRealtimeRefresh } from "@/components/admin-dashboard-realtime-refresh";
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
    type DashboardProductInput,
    type DashboardSummary
} from "@/lib/dashboard-stats";
import { filterDashboardOrdersByTimeRange, resolveDashboardTimeRange, type DashboardTimeRangeMode } from "@/lib/dashboard-time-range";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrandSectionHeader } from "@/components/brand/brand-section-header";
import { CashSessionPreviewDialog } from "@/components/cash-session-preview-dialog";
import { CashSessionAdminActions } from "@/components/cash-session-admin-actions";
import { CashSessionsMultiExportForm } from "@/components/cash-sessions-multi-export-form";

const currencyFormatter = new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR"
});

const numberFormatter = new Intl.NumberFormat("it-IT");

interface OrderProjection {
    _id: unknown
    status?: string
    createdAt?: Date | string
    paidAt?: Date | string
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

function buildSummaryKpis(summary: DashboardSummary, testIdPrefix: string, totalDescription: string) {
    return [
        {
            title: "Incasso Totale",
            value: formatCurrency(summary.totalRevenue),
            description: totalDescription,
            icon: <Wallet className="h-4 w-4 text-slate-500" />,
            testId: `${testIdPrefix}-total`
        },
        {
            title: "Incasso Contanti",
            value: formatCurrency(summary.cashRevenue),
            description: "Pagamenti CASH",
            icon: <ArrowDownRight className="h-4 w-4 text-emerald-600" />,
            testId: `${testIdPrefix}-cash`
        },
        {
            title: "Incasso Carta / POS",
            value: formatCurrency(summary.cardRevenue),
            description: "Pagamenti elettronici",
            icon: <CreditCard className="h-4 w-4 text-blue-600" />,
            testId: `${testIdPrefix}-card`
        },
        {
            title: "Ordini Saldati",
            value: numberFormatter.format(summary.paidOrdersCount),
            description: "Totale operazioni concluse",
            icon: <Receipt className="h-4 w-4 text-violet-600" />,
            testId: `${testIdPrefix}-orders`
        },
        {
            title: "Ticket Medio",
            value: formatCurrency(summary.averageTicket),
            description: "Incasso medio per ordine",
            icon: <ArrowUpRight className="h-4 w-4 text-amber-600" />,
            testId: `${testIdPrefix}-average`
        }
    ]
}

function getFirstSearchParam(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0]?.trim() || null
    return value?.trim() || null
}

function buildDashboardFilterParams(mode: DashboardTimeRangeMode, from?: string, to?: string): URLSearchParams {
    const params = new URLSearchParams()
    params.set("range", mode)
    if (mode === "custom") {
        if (from) params.set("from", from)
        if (to) params.set("to", to)
    }
    return params
}

export default async function AdminDashboard({
    searchParams
}: {
    searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
}) {
    const contextEvent = await getAdminContextEvent() as IEvent | null;

    if (!contextEvent) {
        return (
            <div className="text-center p-10 text-muted-foreground">
                Nessuna festa attiva o selezionata. Seleziona una festa dalla barra in alto.
            </div>
        );
    }

    const eventId = String(contextEvent._id);
    const resolvedSearchParams = await Promise.resolve(searchParams ?? {})
    const activeRange = resolveDashboardTimeRange({
        mode: getFirstSearchParam(resolvedSearchParams.range),
        from: getFirstSearchParam(resolvedSearchParams.from),
        to: getFirstSearchParam(resolvedSearchParams.to),
        timezone: contextEvent.settings?.timezone
    })
    const timezone = activeRange.timezone
    const configuredRefreshMs = Number(process.env.DASHBOARD_REALTIME_REFRESH_MS ?? "15000")
    const realtimeRefreshMs = Number.isFinite(configuredRefreshMs) ? Math.max(1000, configuredRefreshMs) : 15000
    await dbConnect();

    const cashSessions = await CashSession.find({ eventId })
        .sort({ openedAt: -1 })
        .populate({ path: "posDeviceId", select: "_id name" })
        .select("_id status isTest openedAt closedAt openingFloatAmount closingCountedCashAmount paidOrdersCount expectedCashAmount varianceAmount posDeviceId")
        .lean() as CashSessionProjection[];
    const excludedSessionIds = cashSessions.filter((session) => session.isTest).map((session) => session._id);
    const [orders, products] = await Promise.all([
        Order.find({ eventId, status: "PAID", cashSessionId: { $nin: excludedSessionIds } })
            .sort({ createdAt: -1 })
            .select("_id status createdAt paidAt totalAmount paymentMethod cart")
            .lean() as Promise<OrderProjection[]>,
        Product.find({ eventId }).select("_id name").lean() as Promise<ProductProjection[]>
    ]);

    const dashboardOrders: DashboardOrderInput[] = orders.map((order) => ({
        id: String(order._id),
        status: order.status || "PAID",
        createdAt: order.createdAt || null,
        paidAt: order.paidAt || null,
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

    const filteredOrders = filterDashboardOrdersByTimeRange(dashboardOrders, activeRange)
    const stats = computeDashboardStats({
        orders: filteredOrders,
        products: dashboardProducts,
        bestSellerLimit: 8,
        underperformingLimit: 8,
        underperformingThreshold: 1
    });
    const kpis = buildSummaryKpis(stats.summary, "dashboard-kpi", `Ordini saldati · ${activeRange.label}`)
    const realtimeHref = `/admin?${buildDashboardFilterParams("realtime").toString()}`
    const eveningHref = `/admin?${buildDashboardFilterParams("evening").toString()}`
    const eventHref = `/admin?${buildDashboardFilterParams("event").toString()}`
    const exportParams = buildDashboardFilterParams(activeRange.mode, activeRange.startInput, activeRange.endInput)
    const csvExportHref = `/admin/export?format=csv&${exportParams.toString()}`
    const xlsxExportHref = `/admin/export?format=xlsx&${exportParams.toString()}`
    const pdfExportHref = `/admin/export?format=pdf&${exportParams.toString()}`

    return (
        <div className="space-y-6" data-testid="admin-dashboard-brand-shell">
            <AdminDashboardRealtimeRefresh enabled={activeRange.isRealtime && activeRange.isValid} intervalMs={realtimeRefreshMs} />
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <BrandSectionHeader title="Dashboard Statistiche" />
                    <p className="text-muted-foreground">
                        Festa: <span className="font-semibold text-foreground">{contextEvent.name}</span> · Aggiornata alle{" "}
                        {formatDashboardDateTime(stats.generatedAt, timezone)}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {activeRange.isValid ? (
                        <>
                            <Button asChild variant="outline" size="sm">
                                <Link href={csvExportHref}>
                                    <Download className="h-4 w-4" />
                                    Export CSV
                                </Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <Link href={xlsxExportHref}>
                                    <Download className="h-4 w-4" />
                                    Export Excel
                                </Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <Link href={pdfExportHref}>
                                    <Download className="h-4 w-4" />
                                    Export PDF
                                </Link>
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" size="sm" disabled>
                                <Download className="h-4 w-4" />
                                Export CSV
                            </Button>
                            <Button variant="outline" size="sm" disabled>
                                <Download className="h-4 w-4" />
                                Export Excel
                            </Button>
                            <Button variant="outline" size="sm" disabled>
                                <Download className="h-4 w-4" />
                                Export PDF
                            </Button>
                        </>
                    )}
                </div>
            </div>

            <Card className="border-[#d9e6f8] shadow-sm" data-testid="dashboard-time-range">
                <CardHeader>
                    <CardTitle>Intervallo dati</CardTitle>
                    <CardDescription data-testid="dashboard-time-range-label">{activeRange.label}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <Button asChild variant={activeRange.mode === "realtime" ? "default" : "outline"} size="sm">
                            <Link href={realtimeHref}>Tempo reale</Link>
                        </Button>
                        <Button asChild variant={activeRange.mode === "evening" ? "default" : "outline"} size="sm">
                            <Link href={eveningHref}>Serata corrente</Link>
                        </Button>
                        <Button asChild variant={activeRange.mode === "event" ? "default" : "outline"} size="sm">
                            <Link href={eventHref}>Intera festa</Link>
                        </Button>
                    </div>
                    <form method="GET" className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                        <input type="hidden" name="range" value="custom" />
                        <label className="grid gap-1 text-sm font-medium">
                            Dal
                            <input
                                type="datetime-local"
                                name="from"
                                defaultValue={activeRange.startInput}
                                aria-invalid={activeRange.error ? true : undefined}
                                aria-describedby={activeRange.error ? "dashboard-time-range-error-message" : undefined}
                                className="rounded-md border bg-background px-3 py-2"
                            />
                        </label>
                        <label className="grid gap-1 text-sm font-medium">
                            Al
                            <input
                                type="datetime-local"
                                name="to"
                                defaultValue={activeRange.endInput}
                                aria-invalid={activeRange.error ? true : undefined}
                                aria-describedby={activeRange.error ? "dashboard-time-range-error-message" : undefined}
                                className="rounded-md border bg-background px-3 py-2"
                            />
                        </label>
                        <Button type="submit" variant="outline">Applica filtro</Button>
                    </form>
                    {activeRange.error && (
                        <p
                            id="dashboard-time-range-error-message"
                            role="alert"
                            className="text-sm font-medium text-destructive"
                            data-testid="dashboard-time-range-error"
                        >
                            {activeRange.error}
                        </p>
                    )}
                </CardContent>
            </Card>

            <section aria-labelledby="dashboard-filtered-totals" className="space-y-3">
                <h2 id="dashboard-filtered-totals" className="text-lg font-bold">Statistiche intervallo attivo</h2>
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
            </section>

            <Card className="border-[#d9e6f8] shadow-sm" data-testid="dashboard-evening-products">
                <CardHeader>
                    <CardTitle>Prodotti venduti nell&apos;intervallo</CardTitle>
                    <CardDescription>{activeRange.label}</CardDescription>
                </CardHeader>
                <CardContent>
                    {stats.soldProducts.length === 0 ? (
                        <p className="text-center text-muted-foreground" data-testid="dashboard-evening-products-empty">
                            Nessun prodotto venduto nell&apos;intervallo selezionato.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            <ol className="divide-y" data-testid="dashboard-evening-products-top">
                                {stats.soldProducts.slice(0, 5).map((metric, index) => (
                                    <li
                                        key={metric.productId}
                                        className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 py-3"
                                        data-testid="dashboard-evening-product-row"
                                    >
                                        <span className="font-semibold text-muted-foreground">#{index + 1}</span>
                                        <span className="font-medium">{metric.productName}</span>
                                        <span className="font-semibold" data-testid="dashboard-evening-product-quantity">
                                            {numberFormatter.format(metric.quantitySold)}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                            {stats.soldProducts.length > 5 && (
                                <details className="group" data-testid="dashboard-evening-products-details">
                                    <summary
                                        className="w-fit cursor-pointer font-semibold text-primary"
                                        data-testid="dashboard-evening-products-toggle"
                                    >
                                        <span className="group-open:hidden">Mostra tutti</span>
                                        <span className="hidden group-open:inline">Riduci</span>
                                    </summary>
                                    <ol className="mt-3 divide-y" start={6}>
                                        {stats.soldProducts.slice(5).map((metric, index) => (
                                            <li
                                                key={metric.productId}
                                                className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 py-3"
                                                data-testid="dashboard-evening-product-row"
                                            >
                                                <span className="font-semibold text-muted-foreground">#{index + 6}</span>
                                                <span className="font-medium">{metric.productName}</span>
                                                <span className="font-semibold" data-testid="dashboard-evening-product-quantity">
                                                    {numberFormatter.format(metric.quantitySold)}
                                                </span>
                                            </li>
                                        ))}
                                    </ol>
                                </details>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

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
                                        <TableCell className="font-medium">{formatDashboardDateTime(order.createdAt, timezone)}</TableCell>
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
                <CardContent className="space-y-4">
                    <Table data-testid="cash-sessions-table">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-10"><span className="sr-only">Seleziona</span></TableHead>
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
                                    <TableCell colSpan={11} className="text-center text-muted-foreground">
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
                                                {isClosed ? (
                                                    <input
                                                        type="checkbox"
                                                        name="sessionId"
                                                        value={sessionId}
                                                        form="cash-sessions-multi-export"
                                                        aria-label={`Seleziona sessione ${getPosDeviceName(session.posDeviceId)}, apertura ${formatDashboardDateTime(session.openedAt, timezone)}, chiusura ${formatDashboardDateTime(session.closedAt, timezone)}`}
                                                        data-testid={`cash-session-select-${sessionId}`}
                                                        className="h-4 w-4 accent-primary"
                                                    />
                                                ) : null}
                                            </TableCell>
                                            <TableCell>
                                                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${isClosed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                                    {isClosed ? "Chiusa" : "Aperta"}
                                                </span>
                                                {session.isTest ? <span className="ml-1 inline-flex rounded-full bg-rose-100 px-2 py-1 text-xs font-black text-rose-700">TEST</span> : null}
                                            </TableCell>
                                            <TableCell className="font-medium">{getPosDeviceName(session.posDeviceId)}</TableCell>
                                            <TableCell>{formatDashboardDateTime(session.openedAt, timezone)}</TableCell>
                                            <TableCell>{formatDashboardDateTime(session.closedAt, timezone)}</TableCell>
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
                    <CashSessionsMultiExportForm hasClosedSessions={cashSessions.some((session) => session.status === "CLOSED")} />
                </CardContent>
            </Card>
        </div>
    );
}
