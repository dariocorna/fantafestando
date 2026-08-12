"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import { PrintDocumentViewer } from "./print-document-viewer";

type PrintJobStatus = "QUEUED" | "SENT" | "FAILED";
type PrintJobType = "CUSTOMER_ORDER" | "KITCHEN_ORDER" | "CASHIER_SUMMARY" | "CASH_SESSION_SUMMARY" | "EASTER_EGG_IMAGE" | "MANUAL_TEST";

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
    automaticRetryCount: number;
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
    if (type === "EASTER_EGG_IMAGE") return "bg-amber-100 text-amber-800";
    if (type === "MANUAL_TEST") return "bg-slate-200 text-slate-700";
    return "bg-indigo-100 text-indigo-700";
}

function printTypeLabel(type: PrintJobType) {
    if (type === "CUSTOMER_ORDER") return "Comanda cliente";
    if (type === "KITCHEN_ORDER") return "Comanda reparto";
    if (type === "CASHIER_SUMMARY") return "Riepilogo cassa";
    if (type === "CASH_SESSION_SUMMARY") return "Chiusura cassa";
    if (type === "EASTER_EGG_IMAGE") return "Easter egg";
    return "Test manuale";
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
                                            {job.automaticRetryCount > 0 ? (
                                                <span className="rounded-md bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">
                                                    RETRY x{job.automaticRetryCount}
                                                </span>
                                            ) : null}
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
                                    {selectedJob.automaticRetryCount > 0 ? (
                                        <p><span className="font-semibold">Retry automatici:</span> {selectedJob.automaticRetryCount}</p>
                                    ) : null}
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

                                <PrintDocumentViewer
                                    document={selectedJob.document}
                                    escposPreviewUrl={escposPreviewUrl}
                                    escposPreviewError={escposPreviewError}
                                />
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
