export type PrintJobType = "CUSTOMER_ORDER" | "KITCHEN_ORDER" | "CASHIER_SUMMARY" | "CASH_SESSION_SUMMARY" | "EASTER_EGG_IMAGE" | "MANUAL_TEST";

export type PrintLogoMode = "none" | "attempted" | "printed";

export interface PrintDocumentItemOption {
    name: string;
    priceVariation?: number;
}

export interface PrintDocumentItemRow {
    qty: number;
    quantity?: number;
    name: string;
    notes?: string;
    unitPrice?: number;
    lineTotal?: number;
    groupLabel?: string;
    categoryName?: string;
    grossAmount?: number;
    discountAmount?: number;
    selectedOptions?: PrintDocumentItemOption[];
}

export interface PrintDocumentTotalRow {
    label: string;
    value: string;
    emphasis?: "normal" | "strong";
}

export interface PrintDocumentV2 {
    schemaVersion: 2;
    kind: string;
    printType: PrintJobType;
    title: string;
    copyLabel: string;
    referenceCode?: string;
    pizzaNumber?: number;
    pizzaBarcodeValue?: string;
    createdAt: string;
    headerLines: string[];
    items: PrintDocumentItemRow[];
    totals: PrintDocumentTotalRow[];
    footerLines: string[];
    branding?: {
        logoPath?: string;
        logoMode: PrintLogoMode;
    };
    eventName?: string;
    shortCode?: string;
    orderId?: string;
    customerName?: string;
    tableNumber?: string;
    sessionId?: string;
    posDeviceName?: string;
    openedAt?: string;
    closedAt?: string;
}

export interface BuildOrderPrintDocumentInput {
    printType: PrintJobType;
    title: string;
    eventName?: string;
    orderId: string;
    shortCode?: string;
    pizzaNumber?: number;
    pizzaBarcodeValue?: string;
    customerName?: string;
    tableNumber?: string;
    items: Array<{
        name: string;
        quantity: number;
        notes?: string;
        unitPrice?: number;
        lineTotal?: number;
        selectedOptions?: Array<{
            name: string;
            priceVariation: number;
        }>;
    }>;
    totals?: Array<{
        label: string;
        value: string;
        emphasis?: "normal" | "strong";
    }>;
    copyLabel?: string;
    brandingLogoUrl?: string;
    createdAt?: Date | string;
    footerLines?: string[];
}

export interface BuildCashSessionPrintDocumentInput {
    sessionId: string;
    isTest?: boolean;
    eventName?: string;
    posDeviceName?: string;
    openedAt?: Date | string;
    closedAt?: Date | string;
    openingFloatAmount: number;
    cashSalesAmount: number;
    cardSalesAmount: number;
    otherSalesAmount: number;
    expectedCashAmount: number;
    closingCountedCashAmount: number;
    varianceAmount: number;
    paidOrdersCount: number;
    openingNotes?: string;
    closingNotes?: string;
    title?: string;
    copyLabel?: string;
    brandingLogoUrl?: string;
    createdAt?: Date | string;
    items?: PrintDocumentItemRow[];
    grossSalesAmount?: number;
    discountSalesAmount?: number;
    discountSummaries?: Array<{
        label: string;
        amount: number;
    }>;
}

export interface PrintOrderJobPayload {
    title: string;
    eventName?: string;
    copyLabel?: string;
    orderId: string;
    shortCode?: string;
    pizzaNumber?: number;
    pizzaBarcodeValue?: string;
    customerName?: string;
    tableNumber?: string;
    items: Array<{
        name: string;
        quantity: number;
        notes?: string;
        unitPrice?: number;
        lineTotal?: number;
        selectedOptions?: Array<{
            name: string;
            priceVariation: number;
        }>;
    }>;
    totals: Array<{
        label: string;
        value: string;
        emphasis?: "normal" | "strong";
    }>;
    brandingLogoUrl?: string;
}

const RECEIPT_SEPARATOR = "--------------------------------";

function asString(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return "";
}

function asNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
    const parsed = asNumber(value);
    if (!Number.isInteger(parsed) || !parsed || parsed <= 0) return undefined;
    return parsed;
}

function asTrimmedString(value: unknown): string | undefined {
    const normalized = asString(value).trim();
    return normalized.length > 0 ? normalized : undefined;
}

function toIsoDate(value?: Date | string | unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
}

function formatDateTime(value: Date | string | undefined): string {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleString("it-IT");
}

function formatEuro(value: number): string {
    const safe = Number.isFinite(value) ? Number(value) : 0;
    return `${safe.toFixed(2)} EUR`;
}

function defaultCopyLabel(printType: PrintJobType): string {
    if (printType === "CUSTOMER_ORDER") return "COPIA CLIENTE";
    if (printType === "KITCHEN_ORDER") return "COPIA REPARTO";
    if (printType === "CASHIER_SUMMARY") return "COPIA CASSA";
    if (printType === "CASH_SESSION_SUMMARY") return "COPIA CASSA";
    if (printType === "EASTER_EGG_IMAGE") return "EASTER EGG";
    return "COPIA TEST";
}

function resolveReferenceCode(orderId: string | undefined, shortCode: string | undefined): string | undefined {
    if (shortCode) return shortCode;
    if (!orderId) return undefined;
    const trimmed = orderId.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(-8).toUpperCase();
}

function normalizeItems(items: unknown): PrintDocumentItemRow[] {
    if (!Array.isArray(items)) return [];
    const mapped = items
        .map((rawItem) => {
            if (!rawItem || typeof rawItem !== "object") return null;
            const item = rawItem as Record<string, unknown>;
            const name = asTrimmedString(item.name);
            if (!name) return null;

            const qty = Math.max(1, Math.floor(asNumber(item.qty) || asNumber(item.quantity) || 1));
            const notes = asTrimmedString(item.notes);
            const unitPrice = asNumber(item.unitPrice);
            const lineTotal = asNumber(item.lineTotal);
            const groupLabel = asTrimmedString(item.groupLabel);
            const categoryName = asTrimmedString(item.categoryName);
            const grossAmount = asNumber(item.grossAmount);
            const discountAmount = asNumber(item.discountAmount);
            const selectedOptions = Array.isArray(item.selectedOptions)
                ? item.selectedOptions
                    .map((option: unknown) => {
                        if (!option || typeof option !== "object") return null;
                        const optionRecord = option as Record<string, unknown>;
                        const optionName = asTrimmedString(optionRecord.name);
                        if (!optionName) return null;
                        return {
                            name: optionName,
                            priceVariation: asNumber(optionRecord.priceVariation)
                        } as PrintDocumentItemOption;
                    })
                    .filter((option): option is PrintDocumentItemOption => Boolean(option))
                : undefined;

            return {
                qty,
                quantity: qty,
                name,
                notes,
                unitPrice,
                lineTotal,
                groupLabel,
                categoryName,
                grossAmount,
                discountAmount,
                selectedOptions
            } as PrintDocumentItemRow;
        });
    return mapped.filter((item): item is PrintDocumentItemRow => Boolean(item));
}

function humanizeLabel(value: string): string {
    return value
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[\-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
}

function normalizeTotals(totals: unknown): PrintDocumentTotalRow[] {
    if (Array.isArray(totals)) {
        const mapped = totals
            .map((rawRow) => {
                if (!rawRow || typeof rawRow !== "object") return null;
                const row = rawRow as Record<string, unknown>;
                const label = asTrimmedString(row.label);
                const value = asTrimmedString(row.value);
                if (!label || !value) return null;
                const emphasis = asTrimmedString(row.emphasis);
                return {
                    label,
                    value,
                    emphasis: emphasis === "strong" ? "strong" : "normal"
                } as PrintDocumentTotalRow;
            });
        return mapped.filter((row): row is PrintDocumentTotalRow => Boolean(row));
    }

    if (!totals || typeof totals !== "object") return [];

    const mappedEntries = Object.entries(totals as Record<string, unknown>)
        .map(([rawLabel, rawValue]) => {
            const value = asTrimmedString(rawValue);
            if (!value) return null;
            return {
                label: humanizeLabel(rawLabel),
                value,
                emphasis: rawLabel.toLowerCase().includes("totale") ? "strong" : "normal"
            } as PrintDocumentTotalRow;
        });
    return mappedEntries.filter((row): row is PrintDocumentTotalRow => Boolean(row));
}

function normalizeLines(lines: unknown): string[] {
    if (!Array.isArray(lines)) return [];
    return lines
        .map((line) => asTrimmedString(line))
        .filter((line): line is string => Boolean(line));
}

function inferPrintTypeFromLegacy(document: Record<string, unknown>): PrintJobType {
    const explicit = asTrimmedString(document.printType);
    if (
        explicit === "CUSTOMER_ORDER"
        || explicit === "KITCHEN_ORDER"
        || explicit === "CASHIER_SUMMARY"
        || explicit === "CASH_SESSION_SUMMARY"
        || explicit === "EASTER_EGG_IMAGE"
        || explicit === "MANUAL_TEST"
    ) {
        return explicit;
    }

    const kind = asTrimmedString(document.kind)?.toUpperCase();
    if (kind === "CASH_SESSION_SUMMARY") return "CASH_SESSION_SUMMARY";
    if (kind === "CASH_RECEIPT") return "CASHIER_SUMMARY";
    if (kind === "EASTER_EGG_IMAGE") return "EASTER_EGG_IMAGE";
    if (kind === "MANUAL_TEST") return "MANUAL_TEST";
    return "CUSTOMER_ORDER";
}

function buildLegacyHeaderLines(document: Record<string, unknown>, printType: PrintJobType): string[] {
    const lines: string[] = [];
    const customerName = asTrimmedString(document.customerName);
    const tableNumber = asTrimmedString(document.tableNumber);
    const orderId = asTrimmedString(document.orderId);
    const sessionId = asTrimmedString(document.sessionId);
    const posDeviceName = asTrimmedString(document.posDeviceName);
    const openedAt = asTrimmedString(document.openedAt);
    const closedAt = asTrimmedString(document.closedAt);

    if (orderId) lines.push(`ID: ${orderId.slice(-8).toUpperCase()}`);
    if (sessionId) lines.push(`SESSIONE: ${sessionId.slice(-8).toUpperCase()}`);
    if (posDeviceName) lines.push(`POSTAZIONE: ${posDeviceName}`);
    if (openedAt && printType === "CASH_SESSION_SUMMARY") lines.push(`APERTURA: ${openedAt}`);
    if (closedAt && printType === "CASH_SESSION_SUMMARY") lines.push(`CHIUSURA: ${closedAt}`);
    if (customerName) lines.push(`CLIENTE: ${customerName}`);
    if (tableNumber) lines.push(`TAVOLO: ${tableNumber}`);

    return lines;
}

function buildLegacyFooterLines(document: Record<string, unknown>, printType: PrintJobType, createdAt: string): string[] {
    const lines: string[] = [];
    const openingNotes = asTrimmedString(document.openingNotes);
    const closingNotes = asTrimmedString(document.closingNotes);
    if (openingNotes) lines.push(`NOTE APERTURA: ${openingNotes}`);
    if (closingNotes) lines.push(`NOTE CHIUSURA: ${closingNotes}`);

    if (printType === "CUSTOMER_ORDER" || printType === "CASHIER_SUMMARY") {
        lines.push("Vale solo per il ritiro");
    }

    lines.push(formatDateTime(createdAt));
    return lines;
}

function withBranding(logoPath?: string, logoMode: PrintLogoMode = "none") {
    if (!logoPath) {
        return { logoMode } as const;
    }
    return {
        logoPath,
        logoMode
    } as const;
}

export function buildOrderPrintDocumentV2(input: BuildOrderPrintDocumentInput): PrintDocumentV2 {
    const createdAt = toIsoDate(input.createdAt);
    const printType = input.printType;
    const shortCode = asTrimmedString(input.shortCode);
    const orderId = asTrimmedString(input.orderId) || "";
    const pizzaNumber = asPositiveInteger(input.pizzaNumber);
    const pizzaBarcodeValue = asTrimmedString(input.pizzaBarcodeValue);
    const customerName = asTrimmedString(input.customerName);
    const tableNumber = asTrimmedString(input.tableNumber);
    const eventName = asTrimmedString(input.eventName);

    const headerLines = [
        ...(eventName ? [`FESTA: ${eventName}`] : []),
        ...(customerName ? [`CLIENTE: ${customerName}`] : []),
        ...(tableNumber ? [`TAVOLO: ${tableNumber}`] : [])
    ];

    const footerLines = [
        ...(input.footerLines || []),
        ...(printType === "CUSTOMER_ORDER" || printType === "CASHIER_SUMMARY" ? ["Vale solo per il ritiro"] : []),
        formatDateTime(createdAt)
    ].filter((line) => line.trim().length > 0);

    return {
        schemaVersion: 2,
        kind: printType === "CASHIER_SUMMARY" ? "CASH_RECEIPT" : "COMANDA",
        printType,
        title: asTrimmedString(input.title) || "COMANDA",
        copyLabel: asTrimmedString(input.copyLabel) || defaultCopyLabel(printType),
        referenceCode: resolveReferenceCode(orderId, shortCode),
        pizzaNumber,
        pizzaBarcodeValue,
        createdAt,
        headerLines,
        items: normalizeItems(input.items),
        totals: normalizeTotals(input.totals),
        footerLines,
        branding: withBranding(asTrimmedString(input.brandingLogoUrl), input.brandingLogoUrl ? "attempted" : "none"),
        eventName,
        shortCode,
        orderId,
        customerName,
        tableNumber
    };
}

export function buildCashSessionPrintDocumentV2(input: BuildCashSessionPrintDocumentInput): PrintDocumentV2 {
    const createdAt = toIsoDate(input.createdAt);
    const sessionId = asTrimmedString(input.sessionId) || "";
    const eventName = asTrimmedString(input.eventName);
    const posDeviceName = asTrimmedString(input.posDeviceName) || "-";
    const openedAt = formatDateTime(input.openedAt);
    const closedAt = formatDateTime(input.closedAt);
    const netSalesAmount = input.cashSalesAmount + input.cardSalesAmount + input.otherSalesAmount;
    const discountSalesAmount = Math.max(0, Number(input.discountSalesAmount) || 0);
    const grossSalesAmount = Number.isFinite(input.grossSalesAmount)
        ? Math.max(0, Number(input.grossSalesAmount))
        : netSalesAmount + discountSalesAmount;
    const discountRows = (input.discountSummaries || [])
        .filter((summary) => summary.label.trim() && Number(summary.amount) > 0)
        .map((summary): PrintDocumentTotalRow => ({
            label: `SCONTO ${summary.label.trim().toUpperCase()}`,
            value: formatEuro(-Math.abs(summary.amount))
        }));

    const totals: PrintDocumentTotalRow[] = [
        { label: "LORDO", value: formatEuro(grossSalesAmount) },
        ...discountRows,
        ...(discountRows.length === 0 && discountSalesAmount > 0
            ? [{ label: "SCONTI", value: formatEuro(-discountSalesAmount) } as PrintDocumentTotalRow]
            : []),
        { label: "NETTO / INCASSI", value: formatEuro(netSalesAmount), emphasis: "strong" },
        { label: "INCASSO CONTANTI", value: formatEuro(input.cashSalesAmount) },
        { label: "INCASSO CARTA", value: formatEuro(input.cardSalesAmount) },
        { label: "INCASSO ALTRO", value: formatEuro(input.otherSalesAmount) },
        { label: "FONDO INIZIALE", value: formatEuro(input.openingFloatAmount) },
        { label: "CONTANTE ATTESO", value: formatEuro(input.expectedCashAmount), emphasis: "strong" },
        { label: "CONTANTE CONTATO", value: formatEuro(input.closingCountedCashAmount) },
        { label: "DIFFERENZA", value: formatEuro(input.varianceAmount), emphasis: "strong" },
        { label: "ORDINI SALDATI", value: String(Math.max(0, Math.floor(input.paidOrdersCount || 0))) }
    ];

    const footerLines: string[] = input.isTest ? ["SESSIONE TEST - NON CONTABILIZZARE"] : [];
    const openingNotes = asTrimmedString(input.openingNotes);
    const closingNotes = asTrimmedString(input.closingNotes);
    if (openingNotes) footerLines.push(`NOTE APERTURA: ${openingNotes}`);
    if (closingNotes) footerLines.push(`NOTE CHIUSURA: ${closingNotes}`);
    footerLines.push(formatDateTime(createdAt));

    return {
        schemaVersion: 2,
        kind: "CASH_SESSION_SUMMARY",
        printType: "CASH_SESSION_SUMMARY",
        title: asTrimmedString(input.title) || (input.isTest ? "SESSIONE TEST - NON CONTABILIZZARE" : "CHIUSURA CASSA"),
        copyLabel: asTrimmedString(input.copyLabel) || defaultCopyLabel("CASH_SESSION_SUMMARY"),
        referenceCode: sessionId.slice(-8).toUpperCase(),
        createdAt,
        headerLines: [
            ...(eventName ? [`FESTA: ${eventName}`] : []),
            `POSTAZIONE: ${posDeviceName}`,
            `APERTURA: ${openedAt}`,
            `CHIUSURA: ${closedAt}`
        ],
        items: normalizeItems(input.items),
        totals,
        footerLines,
        branding: withBranding(asTrimmedString(input.brandingLogoUrl), input.brandingLogoUrl ? "attempted" : "none"),
        eventName,
        sessionId,
        posDeviceName,
        openedAt,
        closedAt
    };
}

export function normalizeLegacyPrintDocument(document: Record<string, unknown> | undefined | null): PrintDocumentV2 {
    const source = document && typeof document === "object" ? document : {};
    const record = source as Record<string, unknown>;

    const schemaVersion = asNumber(record.schemaVersion);
    if (schemaVersion === 2) {
        const printType = inferPrintTypeFromLegacy(record);
        const createdAt = toIsoDate(record.createdAt);
        return {
            schemaVersion: 2,
            kind: asTrimmedString(record.kind) || (printType === "CASH_SESSION_SUMMARY" ? "CASH_SESSION_SUMMARY" : "COMANDA"),
            printType,
            title: asTrimmedString(record.title) || "RICEVUTA",
            copyLabel: asTrimmedString(record.copyLabel) || defaultCopyLabel(printType),
            referenceCode: asTrimmedString(record.referenceCode),
            pizzaNumber: asPositiveInteger(record.pizzaNumber),
            pizzaBarcodeValue: asTrimmedString(record.pizzaBarcodeValue),
            createdAt,
            headerLines: normalizeLines(record.headerLines),
            items: normalizeItems(record.items),
            totals: normalizeTotals(record.totals),
            footerLines: normalizeLines(record.footerLines),
            branding: withBranding(
                asTrimmedString((record.branding && typeof record.branding === "object" ? (record.branding as Record<string, unknown>).logoPath : undefined)),
                asTrimmedString((record.branding && typeof record.branding === "object" ? (record.branding as Record<string, unknown>).logoMode : undefined)) === "printed"
                    ? "printed"
                    : asTrimmedString((record.branding && typeof record.branding === "object" ? (record.branding as Record<string, unknown>).logoMode : undefined)) === "attempted"
                        ? "attempted"
                        : "none"
            ),
            eventName: asTrimmedString(record.eventName),
            shortCode: asTrimmedString(record.shortCode),
            orderId: asTrimmedString(record.orderId),
            customerName: asTrimmedString(record.customerName),
            tableNumber: asTrimmedString(record.tableNumber),
            sessionId: asTrimmedString(record.sessionId),
            posDeviceName: asTrimmedString(record.posDeviceName),
            openedAt: asTrimmedString(record.openedAt),
            closedAt: asTrimmedString(record.closedAt)
        };
    }

    const printType = inferPrintTypeFromLegacy(record);
    const title = asTrimmedString(record.title)
        || (printType === "CASH_SESSION_SUMMARY" ? "CHIUSURA CASSA" : "COMANDA");
    const shortCode = asTrimmedString(record.shortCode);
    const orderId = asTrimmedString(record.orderId);
    const sessionId = asTrimmedString(record.sessionId);
    const createdAt = toIsoDate(record.createdAt);

    return {
        schemaVersion: 2,
        kind: asTrimmedString(record.kind) || (printType === "CASH_SESSION_SUMMARY" ? "CASH_SESSION_SUMMARY" : "COMANDA"),
        printType,
        title,
        copyLabel: defaultCopyLabel(printType),
        referenceCode: shortCode || sessionId?.slice(-8).toUpperCase() || resolveReferenceCode(orderId, undefined),
        pizzaNumber: asPositiveInteger(record.pizzaNumber),
        pizzaBarcodeValue: asTrimmedString(record.pizzaBarcodeValue),
        createdAt,
        headerLines: buildLegacyHeaderLines(record, printType),
        items: normalizeItems(record.items),
        totals: normalizeTotals(record.totals),
        footerLines: buildLegacyFooterLines(record, printType, createdAt),
        branding: withBranding(undefined, "none"),
        eventName: asTrimmedString(record.eventName),
        shortCode,
        orderId,
        customerName: asTrimmedString(record.customerName),
        tableNumber: asTrimmedString(record.tableNumber),
        sessionId,
        posDeviceName: asTrimmedString(record.posDeviceName),
        openedAt: asTrimmedString(record.openedAt),
        closedAt: asTrimmedString(record.closedAt)
    };
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

export function buildPreviewLines(document: Record<string, unknown> | PrintDocumentV2, maxLength = 36): string[] {
    const normalized = normalizeLegacyPrintDocument(document as Record<string, unknown>);
    const lines: string[] = [];

    lines.push(...wrapLine(normalized.title.toUpperCase(), maxLength));
    lines.push(...wrapLine(normalized.copyLabel.toUpperCase(), maxLength));
    lines.push(RECEIPT_SEPARATOR);

    const showsDishNumber = normalized.printType === "CUSTOMER_ORDER" || normalized.printType === "KITCHEN_ORDER";
    if (showsDishNumber && typeof normalized.pizzaNumber === "number") {
        lines.push(...wrapLine(`PIATTO N° ${normalized.pizzaNumber}`, maxLength));
        if (normalized.pizzaBarcodeValue) {
            lines.push(...wrapLine(`BARCODE: ${normalized.pizzaBarcodeValue}`, maxLength));
        }
        lines.push(RECEIPT_SEPARATOR);
    }

    if (normalized.referenceCode) {
        const referencePrefix = normalized.printType === "CASH_SESSION_SUMMARY" ? "SESSIONE N°" : "ORDINE N°";
        lines.push(...wrapLine(`${referencePrefix} ${normalized.referenceCode}`, maxLength));
        lines.push(RECEIPT_SEPARATOR);
    }

    normalized.headerLines.forEach((line) => {
        lines.push(...wrapLine(line, maxLength));
    });

    if (normalized.headerLines.length > 0) lines.push(RECEIPT_SEPARATOR);

    if (normalized.items.length > 0) {
        const isCashSession = normalized.printType === "CASH_SESSION_SUMMARY";
        lines.push(isCashSession ? "DESCRIZIONE         Q.TA   NETTO" : "DESCRIZIONE");
        lines.push(RECEIPT_SEPARATOR);
        let activeGroup: string | null = null;
        let activeCategory: string | null = null;
        let groupItems: PrintDocumentItemRow[] = [];
        let categoryItems: PrintDocumentItemRow[] = [];
        const appendCashSessionGroupTotals = () => {
            if (!isCashSession || groupItems.length === 0) return;
            const gross = groupItems.reduce((sum, item) => sum + (item.grossAmount ?? item.lineTotal ?? 0), 0);
            const discount = groupItems.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0);
            const net = groupItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
            lines.push(...wrapLine(`SUBTOTALE LORDO: ${formatEuro(gross)}`, maxLength));
            lines.push(...wrapLine(`SUBTOTALE SCONTO: ${formatEuro(discount)}`, maxLength));
            lines.push(...wrapLine(`SUBTOTALE NETTO: ${formatEuro(net)}`, maxLength));
            lines.push(RECEIPT_SEPARATOR);
        };
        const appendCashSessionCategoryTotals = () => {
            if (!isCashSession || categoryItems.length === 0) return;
            const quantity = categoryItems.reduce((sum, item) => sum + item.qty, 0);
            const gross = categoryItems.reduce((sum, item) => sum + (item.grossAmount ?? item.lineTotal ?? 0), 0);
            const discount = categoryItems.reduce((sum, item) => sum + (item.discountAmount ?? 0), 0);
            const net = categoryItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
            lines.push(...wrapLine(`TOTALE CATEGORIA Q.TA: ${quantity}`, maxLength));
            lines.push(...wrapLine(`LORDO: ${formatEuro(gross)} SCONTO: ${formatEuro(discount)}`, maxLength));
            lines.push(...wrapLine(`NETTO: ${formatEuro(net)}`, maxLength));
            lines.push(RECEIPT_SEPARATOR);
        };

        normalized.items.forEach((item) => {
            const categoryName = item.categoryName || "Non categorizzato";
            if (isCashSession && activeCategory !== categoryName) {
                appendCashSessionGroupTotals();
                appendCashSessionCategoryTotals();
                activeCategory = categoryName;
                activeGroup = null;
                groupItems = [];
                categoryItems = [];
                lines.push(...wrapLine(`CATEGORIA: ${categoryName.toUpperCase()}`, maxLength));
            }
            const groupLabel = item.groupLabel || "DETTAGLIO VENDUTO";
            if (isCashSession && activeGroup !== groupLabel) {
                appendCashSessionGroupTotals();
                activeGroup = groupLabel;
                groupItems = [];
                lines.push(...wrapLine(groupLabel.toUpperCase(), maxLength));
            }
            groupItems.push(item);
            categoryItems.push(item);

            if (isCashSession) {
                const descriptionWidth = Math.max(12, maxLength - 13);
                const nameLines = wrapLine(item.name, descriptionWidth);
                nameLines.forEach((nameLine, index) => {
                    lines.push(
                        nameLine.padEnd(descriptionWidth)
                        + (index === 0 ? String(item.qty).padStart(4) : " ".repeat(4))
                        + (index === 0 && typeof item.lineTotal === "number"
                            ? item.lineTotal.toFixed(2).padStart(9)
                            : " ".repeat(9))
                    );
                });
            } else {
                lines.push(...wrapLine(`${item.qty}x ${item.name}`, maxLength));
            }
            if (item.notes) lines.push(...wrapLine(`NOTE: ${item.notes}`, maxLength));

            (item.selectedOptions || []).forEach((option) => {
                if (typeof option.priceVariation === "number") {
                    lines.push(...wrapLine(`+ ${option.name} (${formatEuro(option.priceVariation)})`, maxLength));
                    return;
                }
                lines.push(...wrapLine(`+ ${option.name}`, maxLength));
            });
        });
        if (isCashSession) {
            appendCashSessionGroupTotals();
            appendCashSessionCategoryTotals();
        }
        else lines.push(RECEIPT_SEPARATOR);
    }

    normalized.totals.forEach((total) => {
        const normalizedLabel = total.label.toUpperCase();
        const renderedTotal = normalizedLabel.includes("TOTALE")
            ? `${normalizedLabel} --> ${total.value}`
            : `${normalizedLabel}: ${total.value}`;
        lines.push(...wrapLine(renderedTotal, maxLength));
    });

    if (normalized.totals.length > 0) lines.push(RECEIPT_SEPARATOR);

    normalized.footerLines.forEach((line) => {
        lines.push(...wrapLine(line, maxLength));
    });

    return lines.slice(0, 120);
}

export function toOrderJobPayloadFromDocument(
    document: Record<string, unknown>,
    fallbackOrderId: string
): PrintOrderJobPayload {
    const normalized = normalizeLegacyPrintDocument(document);

    return {
        title: normalized.title,
        eventName: normalized.eventName,
        copyLabel: normalized.copyLabel,
        orderId: normalized.orderId || fallbackOrderId,
        shortCode: normalized.shortCode || normalized.referenceCode,
        pizzaNumber: normalized.pizzaNumber,
        pizzaBarcodeValue: normalized.pizzaBarcodeValue,
        customerName: normalized.customerName,
        tableNumber: normalized.tableNumber,
        items: normalized.items.map((item) => ({
            name: item.name,
            quantity: item.qty,
            notes: item.notes,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
            selectedOptions: (item.selectedOptions || []).map((option) => ({
                name: option.name,
                priceVariation: Number.isFinite(option.priceVariation)
                    ? Number(option.priceVariation)
                    : 0
            }))
        })),
        totals: normalized.totals.map((total) => ({
            label: total.label,
            value: total.value,
            emphasis: total.emphasis === "strong" ? "strong" : "normal"
        })),
        brandingLogoUrl: asTrimmedString(normalized.branding?.logoPath)
    };
}
