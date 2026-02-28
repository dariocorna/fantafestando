"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileSearch } from "lucide-react";
import { getClosedCashSessionPrintDocumentAction } from "@/app/admin/cash-sessions/actions";
import { PrintDocumentViewer } from "./print-document-viewer";

export function CashSessionPreviewDialog({ sessionId, posName }: { sessionId: string; posName: string }) {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [document, setDocument] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleOpenChange = async (newOpen: boolean) => {
        setOpen(newOpen);
        if (newOpen && !document) {
            setIsLoading(true);
            setError(null);
            try {
                const doc = await getClosedCashSessionPrintDocumentAction(sessionId, posName);
                setDocument(doc);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <FileSearch className="h-4 w-4" />
                    Anteprima
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Anteprima Chiusura Cassa: {posName}</DialogTitle>
                    <DialogDescription>
                        Finto scontrino riepilogativo della sessione (Schema V2)
                    </DialogDescription>
                </DialogHeader>
                <div className="mt-4">
                    {isLoading ? (
                        <p className="py-8 text-center text-sm text-slate-500">Generazione anteprima in corso...</p>
                    ) : error ? (
                        <p className="py-8 text-center text-sm text-rose-600">{error}</p>
                    ) : document ? (
                        <PrintDocumentViewer document={document} hideLayout />
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
