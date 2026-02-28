"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import { buildPreviewLines, normalizeLegacyPrintDocument } from "@/lib/print-report";

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
    rawCapturePath?: string;
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

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function buildReceiptSvgDataUri(lines: string[]): string {
    const width = 384;
    const lineHeight = 22;
    const topPadding = 56;
    const leftPadding = 18;
    const minHeight = 220;
    const calculatedHeight = topPadding + (lines.length * lineHeight) + 20;
    const height = Math.max(minHeight, calculatedHeight);

    const textNodes = lines
        .map((line, index) => {
            const y = topPadding + (index * lineHeight);
            const trimmed = line.trim();
            const isSeparator = /^-+$/.test(trimmed);
            const isTitle = index === 0;
            const isCopyLabel = index === 1;
            const isReference = trimmed.startsWith("ORDINE N°") || trimmed.startsWith("SESSIONE N°");
            const isSection = trimmed === "DESCRIZIONE";
            const isStrongTotal = trimmed.startsWith("TOTALE");

            const fontSize = isTitle ? 18 : isCopyLabel || isReference || isSection ? 16 : isStrongTotal ? 15 : 14;
            const fontWeight = isSeparator ? 500 : isTitle || isCopyLabel || isReference || isSection || isStrongTotal ? 700 : 500;
            const anchor = isTitle || isCopyLabel || isReference || isSection ? "middle" : "start";
            const x = anchor === "middle" ? width / 2 : leftPadding;

            if (isSeparator) {
                return `<line x1="${leftPadding}" y1="${y - 6}" x2="${width - leftPadding}" y2="${y - 6}" stroke="#111827" stroke-width="1.6"/>`;
            }

            return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Courier New, monospace" font-size="${fontSize}" font-weight="${fontWeight}" fill="#111827">${escapeXml(line)}</text>`;
        })
        .join("");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/><rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#d1d5db" stroke-width="2"/>${textNodes}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function renderDocumentPreview(document: Record<string, unknown>, escposPreviewUrl: string | null, previewError: string | null) {
    const normalized = normalizeLegacyPrintDocument(document);
    const lines = buildPreviewLines(document);
    const fallbackPreviewSrc = buildReceiptSvgDataUri(lines);
    const previewSrc = escposPreviewUrl || fallbackPreviewSrc;

    return (
        <div className="rounded-xl border bg-slate-50 p-3 shadow-sm" data-testid="print-job-preview">
            <div className="mx-auto w-full max-w-[360px] rounded-md border bg-white shadow-sm">
                <Image
                    src={previewSrc}
                    alt={normalized.title ? `Anteprima ricevuta ${normalized.title}` : "Anteprima ricevuta"}
                    width={384}
                    height={640}
                    unoptimized
                    className="w-full rounded-md"
                />
            </div>
            {previewError ? (
                <p className="mt-2 text-xs text-amber-700">{previewError}</p>
            ) : null}
        </div>
    );
}

function renderDocumentBreakdown(document: Record<string, unknown>) {
    const normalized = normalizeLegacyPrintDocument(document);
    const schemaLabel = Number(document?.schemaVersion) === 2 ? "Schema V2" : "Legacy normalizzato";
    const logoMode = normalized.branding?.logoMode || "none";
    const referenceLabel = normalized.printType === "CASH_SESSION_SUMMARY" ? "Sessione N°" : "Ordine N°";
    const logoLabel = logoMode === "printed"
        ? "Logo stampato"
        : logoMode === "attempted"
            ? "Logo tentato"
            : "Solo testo";
    const printableLogoUrl = (typeof normalized.branding?.logoPath === "string" && normalized.branding.logoPath.startsWith("/uploads/"))
        ? normalized.branding.logoPath
        : null;

    return (
        <div className="space-y-3 rounded-xl border bg-white p-3" data-testid="print-job-breakdown">
            <div className="space-y-1 text-xs text-slate-700">
                <p><span className="font-semibold">Titolo:</span> {normalized.title}</p>
                <p><span className="font-semibold">Copia:</span> {normalized.copyLabel}</p>
                {normalized.eventName ? <p><span className="font-semibold">Festa:</span> {normalized.eventName}</p> : null}
                {normalized.referenceCode ? <p><span className="font-semibold">{referenceLabel}:</span> {normalized.referenceCode}</p> : null}
                <p><span className="font-semibold">Generato:</span> {formatDateTime(normalized.createdAt)}</p>
                <p><span className="font-semibold">Formato:</span> {schemaLabel}</p>
                <p><span className="font-semibold">Branding:</span> {logoLabel}</p>
            </div>

            {normalized.headerLines.length > 0 ? (
                <div>
                    <p className="text-xs font-semibold text-slate-800">Intestazione</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-700">
                        {normalized.headerLines.map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {normalized.items.length > 0 ? (
                <div>
                    <p className="text-xs font-semibold text-slate-800">Righe</p>
                    <div className="mt-1 space-y-1 text-xs text-slate-700">
                        {normalized.items.map((item, index) => (
                            <div key={`${item.name}-${index}`} className="rounded-md border bg-slate-50 p-2">
                                <p className="font-semibold">{item.qty}x {item.name}</p>
                                {item.notes ? <p className="text-slate-600">Note: {item.notes}</p> : null}
                                {typeof item.unitPrice === "number" || typeof item.lineTotal === "number" ? (
                                    <p className="text-slate-600">Prezzo: {item.unitPrice?.toFixed(2) ?? "-"} EUR · Totale: {item.lineTotal?.toFixed(2) ?? "-"} EUR</p>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {normalized.totals.length > 0 ? (
                <div>
                    <p className="text-xs font-semibold text-slate-800">Totali</p>
                    <div className="mt-1 space-y-1 text-xs text-slate-700" data-testid="print-job-totals">
                        {normalized.totals.map((total) => (
                            <p key={`${total.label}-${total.value}`} className={total.emphasis === "strong" ? "font-semibold text-slate-900" : ""}>
                                {total.label.toUpperCase().includes("TOTALE")
                                    ? `${total.label.toUpperCase()} --> ${total.value}`
                                    : `${total.label.toUpperCase()}: ${total.value}`}
                            </p>
                        ))}
                    </div>
                </div>
            ) : null}

            {normalized.footerLines.length > 0 ? (
                <div>
                    <p className="text-xs font-semibold text-slate-800">Footer</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-700">
                        {normalized.footerLines.map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {printableLogoUrl ? (
                <div>
                    <p className="text-xs font-semibold text-slate-800">Header logo usato in stampa</p>
                    <div className="mt-1 overflow-hidden rounded-md border bg-slate-50 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={printableLogoUrl}
                            alt="Header logo stampato via ESC/POS"
                            className="h-auto w-full rounded-sm object-contain"
                        />
                    </div>
                    <p className="mt-1 break-all text-[11px] text-slate-500">
                        <code>{printableLogoUrl}</code>
                    </p>
                </div>
            ) : null}
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
    const [escposPreviewUrl, setEscposPreviewUrl] = useState<string | null>(null);
    const [escposPreviewError, setEscposPreviewError] = useState<string | null>(null);

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

    useEffect(() => {
        const selectedId = selectedJob?.id;
        if (!selectedId) {
            return;
        }

        let isCancelled = false;
        const loadPreview = async () => {
            setEscposPreviewError(null);
            const response = await fetch(`/api/admin/print-jobs/${selectedId}/preview`, { cache: "no-store" });
            if (!response.ok) {
                if (!isCancelled) {
                    setEscposPreviewUrl(null);
                    setEscposPreviewError("Anteprima ESC/POS raw non disponibile, visualizzo fallback.");
                }
                return;
            }
            const payload = await response.json() as { imageDataUrl?: string };
            if (!isCancelled) {
                setEscposPreviewUrl(payload.imageDataUrl || null);
                if (!payload.imageDataUrl) {
                    setEscposPreviewError("Anteprima ESC/POS raw non disponibile, visualizzo fallback.");
                }
            }
        };
        void loadPreview();
        return () => {
            isCancelled = true;
        };
    }, [selectedJob?.id]);

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

            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
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
                                        <div className="flex flex-wrap items-center gap-2">
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
                        <CardTitle className="text-base">Anteprima e dettaglio</CardTitle>
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

                                {renderDocumentBreakdown(selectedJob.document)}
                                {renderDocumentPreview(selectedJob.document, escposPreviewUrl, escposPreviewError)}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
