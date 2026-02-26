"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

type PrintJobStatus = "QUEUED" | "SENT" | "FAILED";
type PrintJobType = "CUSTOMER_ORDER" | "KITCHEN_ORDER" | "CASHIER_SUMMARY" | "CASH_SESSION_SUMMARY" | "MANUAL_TEST";

interface MonitorPrinterOption {
    id: string;
    name: string;
    ip: string;
    port?: number;
}

interface PrintJobItem {
    id: string;
    status: PrintJobStatus;
    source: "ORDER" | "CASH_SESSION" | "MANUAL_TEST";
    printType: PrintJobType;
    destinationHost: string;
    destinationPort: number;
    isVirtual: boolean;
    copies: number;
    document: Record<string, unknown>;
    errorMessage?: string;
    createdAt: string;
    printer?: {
        id: string;
        name: string;
        ip: string;
        port: number;
        type: "CASHIER" | "KITCHEN";
        isVirtual: boolean;
        emulatorSlot?: number;
    } | null;
}

function formatDateTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("it-IT");
}

function statusBadgeClass(status: PrintJobStatus) {
    if (status === "SENT") return "bg-emerald-100 text-emerald-700";
    if (status === "FAILED") return "bg-rose-100 text-rose-700";
    return "bg-amber-100 text-amber-700";
}

function printTypeBadgeClass(type: PrintJobType) {
    if (type === "CASHIER_SUMMARY" || type === "CASH_SESSION_SUMMARY") return "bg-sky-100 text-sky-700";
    if (type === "KITCHEN_ORDER") return "bg-fuchsia-100 text-fuchsia-700";
    if (type === "MANUAL_TEST") return "bg-slate-200 text-slate-700";
    return "bg-indigo-100 text-indigo-700";
}

function printTypeLabel(type: PrintJobType) {
    if (type === "CUSTOMER_ORDER") return "Comanda cliente";
    if (type === "KITCHEN_ORDER") return "Comanda reparto";
    if (type === "CASHIER_SUMMARY") return "Riepilogo cassa";
    if (type === "CASH_SESSION_SUMMARY") return "Chiusura cassa";
    return "Test manuale";
}

function stringifyMaybe(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return "";
}

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function wrapLine(value: string, maxLength: number): string[] {
    const normalized = value.trim();
    if (!normalized) return [];
    if (normalized.length <= maxLength) return [normalized];

    const words = normalized.split(/\s+/);
    const lines: string[] = [];
    let current = "";

    words.forEach((word) => {
        const next = current ? `${current} ${word}` : word;
        if (next.length <= maxLength) {
            current = next;
            return;
        }
        if (current) lines.push(current);
        current = word;
    });

    if (current) lines.push(current);
    return lines;
}

function buildReceiptLines(document: Record<string, unknown>): string[] {
    const kind = stringifyMaybe(document.kind).toUpperCase();
    const title = stringifyMaybe(document.title);
    const shortCode = stringifyMaybe(document.shortCode);
    const customerName = stringifyMaybe(document.customerName);
    const tableNumber = stringifyMaybe(document.tableNumber);
    const items = Array.isArray(document.items)
        ? document.items as Array<{ name?: string; quantity?: number; notes?: string }>
        : [];
    const totals = (document.totals && typeof document.totals === "object")
        ? document.totals as Record<string, unknown>
        : undefined;

    const lines: string[] = [];

    if (kind) lines.push(kind);
    if (title) lines.push(...wrapLine(title.toUpperCase(), 36));
    lines.push("--------------------------------");
    if (shortCode) lines.push(`CODICE: ${shortCode}`);
    if (customerName) lines.push(...wrapLine(`CLIENTE: ${customerName}`, 36));
    if (tableNumber) lines.push(`TAVOLO: ${tableNumber}`);
    if (shortCode || customerName || tableNumber) {
        lines.push("--------------------------------");
    }

    if (items.length > 0) {
        items.forEach((item) => {
            lines.push(...wrapLine(`${item.quantity || 0}x ${item.name || "Voce"}`, 36));
            if (item.notes) lines.push(...wrapLine(`NOTE: ${item.notes}`, 36));
        });
        lines.push("--------------------------------");
    }

    if (totals) {
        Object.entries(totals).forEach(([label, value]) => {
            lines.push(...wrapLine(`${label.toUpperCase()}: ${stringifyMaybe(value)}`, 36));
        });
        lines.push("--------------------------------");
    }

    return lines.slice(0, 80);
}

function buildReceiptSvgDataUri(lines: string[]): string {
    const width = 384;
    const lineHeight = 20;
    const topPadding = 20;
    const leftPadding = 18;
    const minHeight = 200;
    const calculatedHeight = topPadding + (lines.length * lineHeight) + 20;
    const height = Math.max(minHeight, calculatedHeight);

    const textNodes = lines
        .map((line, index) => {
            const y = topPadding + (index * lineHeight);
            return `<text x="${leftPadding}" y="${y}" font-family="Courier New, monospace" font-size="14" fill="#111827">${escapeXml(line)}</text>`;
        })
        .join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/><rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#d1d5db" stroke-width="2"/>${textNodes}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function renderDocumentPreview(document: Record<string, unknown>) {
    const title = stringifyMaybe(document.title);
    const lines = buildReceiptLines(document);
    const previewSrc = buildReceiptSvgDataUri(lines);

    return (
        <div className="rounded-xl border bg-slate-50 p-3 shadow-sm">
            <Image
                src={previewSrc}
                alt={title ? `Anteprima ricevuta ${title}` : "Anteprima ricevuta"}
                width={384}
                height={640}
                unoptimized
                className="mx-auto w-full max-w-[360px] rounded-md border bg-white shadow-sm"
            />
        </div>
    );
}

export function PrintJobsMonitor({
    eventId,
    printers
}: {
    eventId: string;
    printers: MonitorPrinterOption[];
}) {
    const [jobs, setJobs] = useState<PrintJobItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<"ALL" | PrintJobStatus>("ALL");
    const [printerFilter, setPrinterFilter] = useState<string>("ALL");
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
    const [isRetrying, setIsRetrying] = useState(false);
    const [retryMessage, setRetryMessage] = useState<string | null>(null);

    const loadJobs = useCallback(async () => {
        setIsLoading(true);
        const params = new URLSearchParams({
            eventId,
            limit: "40"
        });
        if (statusFilter !== "ALL") params.set("status", statusFilter);
        if (printerFilter !== "ALL") params.set("printerId", printerFilter);

        const response = await fetch(`/api/admin/print-jobs?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) {
            setJobs([]);
            setIsLoading(false);
            return;
        }

        const payload = await response.json() as { jobs?: PrintJobItem[] };
        const nextJobs = payload.jobs || [];
        setJobs(nextJobs);
        setIsLoading(false);
        if (nextJobs.length > 0 && !selectedJobId) {
            setSelectedJobId(nextJobs[0].id);
        }
    }, [eventId, printerFilter, selectedJobId, statusFilter]);

    useEffect(() => {
        const initialTimeout = setTimeout(() => {
            void loadJobs();
        }, 0);
        const interval = setInterval(() => {
            void loadJobs();
        }, 4000);
        return () => {
            clearTimeout(initialTimeout);
            clearInterval(interval);
        };
    }, [loadJobs]);

    const selectedJob = useMemo(
        () => jobs.find((job) => job.id === selectedJobId) || jobs[0] || null,
        [jobs, selectedJobId]
    );

    const retrySelectedJob = useCallback(async () => {
        if (!selectedJob || selectedJob.status !== "FAILED") return;

        setIsRetrying(true);
        setRetryMessage(null);
        const response = await fetch(`/api/admin/print-jobs/${selectedJob.id}`, {
            method: "POST"
        });
        const payload = await response.json().catch(() => ({} as { error?: string }));

        if (!response.ok) {
            setRetryMessage(payload.error || "Reinvio fallito");
            setIsRetrying(false);
            return;
        }

        setRetryMessage("Reinvio eseguito, aggiorno lo stato...");
        await loadJobs();
        setIsRetrying(false);
    }, [loadJobs, selectedJob]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-xl">Monitor Stampa Runtime</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                        <div className="w-full md:max-w-[220px]">
                            <Select value={statusFilter} onValueChange={(value: "ALL" | PrintJobStatus) => setStatusFilter(value)}>
                                <SelectTrigger aria-label="Filtro Stato Stampa">
                                    <SelectValue placeholder="Stato" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Tutti gli stati</SelectItem>
                                    <SelectItem value="QUEUED">In coda</SelectItem>
                                    <SelectItem value="SENT">Inviati</SelectItem>
                                    <SelectItem value="FAILED">Falliti</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="w-full md:max-w-[280px]">
                            <Select value={printerFilter} onValueChange={setPrinterFilter}>
                                <SelectTrigger aria-label="Filtro Stampante">
                                    <SelectValue placeholder="Stampante" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Tutte le stampanti</SelectItem>
                                    {printers.map((printer) => (
                                        <SelectItem key={printer.id} value={printer.id}>
                                            {printer.name} ({printer.ip}:{printer.port || 9100})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="gap-2 md:ml-auto"
                            onClick={() => void loadJobs()}
                        >
                            <RefreshCw className="h-4 w-4" />
                            Aggiorna
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Job recenti</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <p className="text-sm text-muted-foreground">Caricamento...</p>
                        ) : jobs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nessun job disponibile per i filtri selezionati.</p>
                        ) : (
                            <div className="space-y-2">
                                {jobs.map((job) => (
                                    <button
                                        key={job.id}
                                        type="button"
                                        onClick={() => setSelectedJobId(job.id)}
                                        className={`w-full rounded-xl border p-3 text-left transition ${selectedJob?.id === job.id ? "border-blue-500 bg-blue-50" : "hover:bg-slate-50"}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={`rounded-md px-2 py-1 text-xs font-black ${statusBadgeClass(job.status)}`}>
                                                {job.status}
                                            </span>
                                            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${printTypeBadgeClass(job.printType)}`}>
                                                {printTypeLabel(job.printType)}
                                            </span>
                                            <span className="text-xs font-semibold text-slate-500">{job.source}</span>
                                        </div>
                                        <p className="mt-1 text-sm font-semibold text-slate-800">
                                            {job.printer?.name || `${job.destinationHost}:${job.destinationPort}`}
                                        </p>
                                        <p className="text-xs text-slate-500">{formatDateTime(job.createdAt)}</p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Anteprima ricevuta</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!selectedJob ? (
                            <p className="text-sm text-muted-foreground">Seleziona un job per vedere il dettaglio.</p>
                        ) : (
                            <div className="space-y-3">
                                <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
                                    <p><span className="font-semibold">Tipo stampa:</span> {printTypeLabel(selectedJob.printType)}</p>
                                    <p><span className="font-semibold">Destinazione:</span> {selectedJob.destinationHost}:{selectedJob.destinationPort}</p>
                                    <p><span className="font-semibold">Copie:</span> {selectedJob.copies}</p>
                                    <p><span className="font-semibold">Modalità:</span> {selectedJob.isVirtual ? "Virtuale" : "Reale"}</p>
                                    {selectedJob.errorMessage ? (
                                        <p className="text-rose-700"><span className="font-semibold">Errore:</span> {selectedJob.errorMessage}</p>
                                    ) : null}
                                </div>
                                {selectedJob.status === "FAILED" ? (
                                    <div className="flex items-center gap-2">
                                        <Button type="button" variant="outline" onClick={() => void retrySelectedJob()} disabled={isRetrying}>
                                            {isRetrying ? "Reinvio..." : "Reinvia job fallito"}
                                        </Button>
                                        {retryMessage ? (
                                            <p className="text-xs text-slate-600">{retryMessage}</p>
                                        ) : null}
                                    </div>
                                ) : null}
                                {renderDocumentPreview(selectedJob.document)}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
