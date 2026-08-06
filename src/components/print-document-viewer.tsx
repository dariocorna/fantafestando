"use client";

import Image from "next/image";
import { buildPreviewLines, normalizeLegacyPrintDocument } from "@/lib/print-report";
import type { PrintDocumentV2 } from "@/lib/print-report";

function formatDateTime(value: string | Date | undefined | null): string {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString("it-IT");
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

export function PrintDocumentViewer({
    document,
    escposPreviewUrl,
    escposPreviewError,
    hideLayout = false
}: {
    document: Record<string, unknown> | PrintDocumentV2;
    escposPreviewUrl?: string | null;
    escposPreviewError?: string | null;
    hideLayout?: boolean;
}) {
    const normalized = normalizeLegacyPrintDocument(document as Record<string, unknown>);
    const schemaLabel = normalized.schemaVersion === 2 ? "Schema V2" : "Legacy normalizzato";
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

    const lines = buildPreviewLines(document);
    const fallbackPreviewSrc = buildReceiptSvgDataUri(lines);
    const previewSrc = escposPreviewUrl || fallbackPreviewSrc;

    const breakdownNode = (
        <div className="space-y-3 rounded-xl border bg-white p-3" data-testid="print-job-breakdown">
            <div className="space-y-1 text-xs text-slate-700">
                <p><span className="font-semibold">Titolo:</span> {normalized.title}</p>
                <p><span className="font-semibold">Copia:</span> {normalized.copyLabel}</p>
                {normalized.eventName ? <p><span className="font-semibold">Festa:</span> {normalized.eventName}</p> : null}
                {normalized.referenceCode ? <p><span className="font-semibold">{referenceLabel}:</span> {normalized.referenceCode}</p> : null}
                {(normalized.printType === "CUSTOMER_ORDER" || normalized.printType === "KITCHEN_ORDER") && normalized.pizzaNumber
                    ? <p><span className="font-semibold">Piatto N°:</span> {normalized.pizzaNumber}</p>
                    : null}
                {(normalized.printType === "CUSTOMER_ORDER" || normalized.printType === "KITCHEN_ORDER") && normalized.pizzaBarcodeValue
                    ? <p><span className="font-semibold">Barcode piatto:</span> {normalized.pizzaBarcodeValue}</p>
                    : null}
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
                                {item.categoryName ? <p className="text-xs font-black uppercase text-slate-800">Categoria: {item.categoryName}</p> : null}
                                {item.groupLabel ? <p className="text-[11px] font-semibold uppercase text-slate-500">{item.groupLabel}</p> : null}
                                <p className="font-semibold">{item.qty}x {item.name}</p>
                                {item.notes ? <p className="text-slate-600">Note: {item.notes}</p> : null}
                                {typeof item.grossAmount === "number" || typeof item.discountAmount === "number" ? (
                                    <p className="text-slate-600">
                                        Lordo: {item.grossAmount?.toFixed(2) ?? "-"} EUR · Sconto: {item.discountAmount?.toFixed(2) ?? "-"} EUR · Netto: {item.lineTotal?.toFixed(2) ?? "-"} EUR
                                    </p>
                                ) : null}
                                {typeof item.grossAmount !== "number"
                                    && typeof item.discountAmount !== "number"
                                    && (typeof item.unitPrice === "number" || typeof item.lineTotal === "number") ? (
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
                            alt="Header logo stampato"
                            className="h-auto w-full rounded-sm object-contain"
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );

    const previewNode = (
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
            {escposPreviewError ? (
                <p className="mt-2 text-xs text-amber-700">{escposPreviewError}</p>
            ) : null}
        </div>
    );

    if (hideLayout) {
        return (
            <div className="space-y-4">
                {breakdownNode}
                {previewNode}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {breakdownNode}
            {previewNode}
        </div>
    );
}
