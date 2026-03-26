import { describe, expect, it } from "vitest";
import {
    type BuildOrderPrintDocumentInput,
    buildCashSessionPrintDocumentV2,
    buildOrderPrintDocumentV2,
    buildPreviewLines,
    normalizeLegacyPrintDocument,
    toOrderJobPayloadFromDocument
} from "./print-report";

describe("print-report", () => {
    /* ───────── buildOrderPrintDocumentV2 ───────── */

    it("builds order document v2 with default labels and normalized rows", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "CASHIER_SUMMARY",
            title: "Scontrino Cassa",
            eventName: "Evento Test",
            orderId: "order-abcdef123456",
            shortCode: "321",
            customerName: "Mario",
            tableNumber: "A2",
            items: [
                { name: "Panino", quantity: 2, unitPrice: 5, lineTotal: 10 },
                { name: "Bibita", quantity: 1, notes: "Senza ghiaccio" }
            ],
            totals: [
                { label: "TOTALE", value: "10.00 EUR", emphasis: "strong" },
                { label: "PAGAMENTO", value: "Contanti" }
            ]
        });

        expect(document.schemaVersion).toBe(2);
        expect(document.copyLabel).toBe("COPIA CASSA");
        expect(document.referenceCode).toBe("321");
        expect(document.eventName).toBe("Evento Test");
        expect(document.headerLines[0]).toBe("FESTA: Evento Test");
        expect(document.items[0]).toMatchObject({ qty: 2, quantity: 2, name: "Panino" });
        expect(document.footerLines).toContain("Vale solo per il ritiro");
    });

    it("builds order document v2 with minimal input (no optional fields)", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "CUSTOMER_ORDER",
            title: "Comanda",
            orderId: "order-12345678",
            items: []
        });

        expect(document.schemaVersion).toBe(2);
        expect(document.kind).toBe("COMANDA");
        expect(document.copyLabel).toBe("COPIA CLIENTE");
        expect(document.referenceCode).toBe("12345678");
        expect(document.headerLines).toEqual([]);
        expect(document.items).toEqual([]);
        expect(document.totals).toEqual([]);
        expect(document.eventName).toBeUndefined();
        expect(document.customerName).toBeUndefined();
        expect(document.tableNumber).toBeUndefined();
        expect(document.branding?.logoMode).toBe("none");
    });

    it("builds order document v2 with custom copyLabel, footerLines and brandingLogoUrl", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "KITCHEN_ORDER",
            title: "Comanda Cucina",
            orderId: "order-99887766",
            items: [{ name: "Pasta", quantity: 1 }],
            copyLabel: "CUCINA",
            footerLines: ["Numero tavolo confermato"],
            brandingLogoUrl: "/uploads/menu-headers/logo.png"
        });

        expect(document.copyLabel).toBe("CUCINA");
        expect(document.kind).toBe("COMANDA");
        expect(document.footerLines).toContain("Numero tavolo confermato");
        expect(document.branding?.logoPath).toBe("/uploads/menu-headers/logo.png");
        expect(document.branding?.logoMode).toBe("attempted");
        // KITCHEN_ORDER should NOT have "Vale solo per il ritiro"
        expect(document.footerLines).not.toContain("Vale solo per il ritiro");
    });

    it("carries pizza number and barcode fields when present", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "KITCHEN_ORDER",
            title: "Comanda Pizza",
            orderId: "order-pizza-1",
            shortCode: "701",
            pizzaNumber: 33,
            pizzaBarcodeValue: "PZ:order-pizza-1",
            items: [{ name: "Margherita", quantity: 1 }]
        });

        expect(document.pizzaNumber).toBe(33);
        expect(document.pizzaBarcodeValue).toBe("PZ:order-pizza-1");
    });

    it("builds order document v2 for CASHIER_SUMMARY kind as CASH_RECEIPT", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "CASHIER_SUMMARY",
            title: "Scontrino",
            orderId: "ord-1",
            items: []
        });

        expect(document.kind).toBe("CASH_RECEIPT");
    });

    it("falls back orderId reference code to last 8 chars uppercase when no shortCode", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "CUSTOMER_ORDER",
            title: "Comanda",
            orderId: "order-abcdefgh",
            items: []
        });

        expect(document.referenceCode).toBe("ABCDEFGH");
    });

    it("normalizes item quantities: uses qty if provided, defaults to 1", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "CUSTOMER_ORDER",
            title: "Comanda",
            orderId: "order-1",
            items: [
                { name: "Item A", quantity: 0 },   // should become 1
                { name: "Item B", quantity: 3 }
            ]
        });

        expect(document.items[0].qty).toBe(1);
        expect(document.items[1].qty).toBe(3);
    });

    it("filters out items with empty or missing name", () => {
        const invalidItems = [
            { name: "", quantity: 1 },
            { name: "Valid", quantity: 1 }
        ] as unknown as BuildOrderPrintDocumentInput["items"];

        const document = buildOrderPrintDocumentV2({
            printType: "CUSTOMER_ORDER",
            title: "Comanda",
            orderId: "order-1",
            items: invalidItems
        });

        expect(document.items).toHaveLength(1);
        expect(document.items[0].name).toBe("Valid");
    });

    it("normalizes item selectedOptions, filtering invalid ones", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "CUSTOMER_ORDER",
            title: "Comanda",
            orderId: "order-1",
            items: [{
                name: "Panino",
                quantity: 1,
                selectedOptions: [
                    { name: "Extra formaggio", priceVariation: 1.5 },
                    { name: "", priceVariation: 0 },       // invalid: empty name
                    { name: "Salsa", priceVariation: 0 }
                ]
            }]
        });

        expect(document.items[0].selectedOptions).toHaveLength(2);
        expect(document.items[0].selectedOptions![0].name).toBe("Extra formaggio");
        expect(document.items[0].selectedOptions![1].name).toBe("Salsa");
    });

    /* ───────── buildCashSessionPrintDocumentV2 ───────── */

    it("builds cash session document with totals and notes", () => {
        const document = buildCashSessionPrintDocumentV2({
            sessionId: "session-12345678",
            eventName: "Evento Test",
            posDeviceName: "Cassa 1",
            openedAt: "2026-02-28T10:00:00.000Z",
            closedAt: "2026-02-28T12:00:00.000Z",
            openingFloatAmount: 100,
            cashSalesAmount: 50,
            cardSalesAmount: 20,
            otherSalesAmount: 5,
            expectedCashAmount: 150,
            closingCountedCashAmount: 149,
            varianceAmount: -1,
            paidOrdersCount: 7,
            openingNotes: "Apertura regolare",
            closingNotes: "Consegna completata"
        });

        expect(document.printType).toBe("CASH_SESSION_SUMMARY");
        expect(document.referenceCode).toBe("12345678");
        expect(document.headerLines[0]).toContain("FESTA: Evento Test");
        expect(document.totals.map((row) => row.label)).toContain("TOTALE INCASSI");
        expect(document.footerLines.join(" ")).toContain("NOTE APERTURA");
    });

    it("builds cash session document with zero amounts and missing notes", () => {
        const document = buildCashSessionPrintDocumentV2({
            sessionId: "session-00000000",
            openingFloatAmount: 0,
            cashSalesAmount: 0,
            cardSalesAmount: 0,
            otherSalesAmount: 0,
            expectedCashAmount: 0,
            closingCountedCashAmount: 0,
            varianceAmount: 0,
            paidOrdersCount: 0
        });

        expect(document.title).toBe("CHIUSURA CASSA");
        expect(document.copyLabel).toBe("COPIA CASSA");
        expect(document.posDeviceName).toBe("-");
        expect(document.totals.find((r) => r.label === "FONDO INIZIALE")!.value).toBe("0.00 EUR");
        expect(document.totals.find((r) => r.label === "ORDINI SALDATI")!.value).toBe("0");
        // No notes in footer (just the date)
        expect(document.footerLines.some((l) => l.includes("NOTE APERTURA"))).toBe(false);
    });

    it("builds cash session document with custom title and copyLabel", () => {
        const document = buildCashSessionPrintDocumentV2({
            sessionId: "session-abc",
            openingFloatAmount: 50,
            cashSalesAmount: 10,
            cardSalesAmount: 0,
            otherSalesAmount: 0,
            expectedCashAmount: 60,
            closingCountedCashAmount: 60,
            varianceAmount: 0,
            paidOrdersCount: 1,
            title: "REPORT CASSA",
            copyLabel: "ORIGINALE"
        });

        expect(document.title).toBe("REPORT CASSA");
        expect(document.copyLabel).toBe("ORIGINALE");
    });

    /* ───────── normalizeLegacyPrintDocument ───────── */

    it("normalizes legacy print document with object totals", () => {
        const normalized = normalizeLegacyPrintDocument({
            kind: "CASH_RECEIPT",
            title: "Scontrino",
            shortCode: "555",
            orderId: "order-1",
            customerName: "Luca",
            tableNumber: "B3",
            items: [{ name: "Lasagna", quantity: 1 }],
            totals: {
                totale: "8.00 EUR",
                pagamento: "Contanti"
            },
            createdAt: "2026-02-28T10:30:00.000Z"
        });

        expect(normalized.schemaVersion).toBe(2);
        expect(normalized.printType).toBe("CASHIER_SUMMARY");
        expect(normalized.totals).toEqual([
            { label: "TOTALE", value: "8.00 EUR", emphasis: "strong" },
            { label: "PAGAMENTO", value: "Contanti", emphasis: "normal" }
        ]);
        expect(normalized.headerLines.join(" ")).toContain("CLIENTE: Luca");
    });

    it("handles null input", () => {
        const normalized = normalizeLegacyPrintDocument(null);
        expect(normalized.schemaVersion).toBe(2);
        expect(normalized.printType).toBe("CUSTOMER_ORDER");
        expect(normalized.items).toEqual([]);
        expect(normalized.totals).toEqual([]);
    });

    it("handles undefined input", () => {
        const normalized = normalizeLegacyPrintDocument(undefined);
        expect(normalized.schemaVersion).toBe(2);
    });

    it("handles empty object input", () => {
        const normalized = normalizeLegacyPrintDocument({});
        expect(normalized.schemaVersion).toBe(2);
        expect(normalized.printType).toBe("CUSTOMER_ORDER");
        expect(normalized.title).toBe("COMANDA");
    });

    it("passes through v2 schema documents preserving fields", () => {
        const input = {
            schemaVersion: 2,
            kind: "COMANDA",
            printType: "KITCHEN_ORDER",
            title: "Comanda Cucina",
            copyLabel: "COPIA CUCINA",
            referenceCode: "REF-123",
            pizzaNumber: 55,
            pizzaBarcodeValue: "PZ:ord-1",
            createdAt: "2026-02-28T10:00:00.000Z",
            headerLines: ["FESTA: Test"],
            items: [{ name: "Pasta", qty: 2 }],
            totals: [{ label: "TOTALE", value: "10.00 EUR", emphasis: "strong" }],
            footerLines: ["Grazie"],
            eventName: "Test Event",
            shortCode: "T1",
            orderId: "ord-1",
            customerName: "Mario",
            tableNumber: "A1"
        };

        const normalized = normalizeLegacyPrintDocument(input);
        expect(normalized.schemaVersion).toBe(2);
        expect(normalized.printType).toBe("KITCHEN_ORDER");
        expect(normalized.title).toBe("Comanda Cucina");
        expect(normalized.copyLabel).toBe("COPIA CUCINA");
        expect(normalized.referenceCode).toBe("REF-123");
        expect(normalized.pizzaNumber).toBe(55);
        expect(normalized.pizzaBarcodeValue).toBe("PZ:ord-1");
        expect(normalized.eventName).toBe("Test Event");
    });

    it("normalizes v2 document branding modes correctly", () => {
        const withPrinted = normalizeLegacyPrintDocument({
            schemaVersion: 2,
            branding: { logoPath: "/logo.png", logoMode: "printed" }
        });
        expect(withPrinted.branding?.logoMode).toBe("printed");
        expect(withPrinted.branding?.logoPath).toBe("/logo.png");

        const withAttempted = normalizeLegacyPrintDocument({
            schemaVersion: 2,
            branding: { logoPath: "/logo.png", logoMode: "attempted" }
        });
        expect(withAttempted.branding?.logoMode).toBe("attempted");

        const withNone = normalizeLegacyPrintDocument({
            schemaVersion: 2,
            branding: { logoMode: "none" }
        });
        expect(withNone.branding?.logoMode).toBe("none");
    });

    it("normalizes legacy CASH_SESSION_SUMMARY kind", () => {
        const normalized = normalizeLegacyPrintDocument({
            kind: "CASH_SESSION_SUMMARY",
            title: "Chiusura Cassa",
            sessionId: "session-aabbccdd",
            posDeviceName: "Cassa 1",
            openedAt: "2026-02-28T10:00:00.000Z",
            closedAt: "2026-02-28T12:00:00.000Z"
        });

        expect(normalized.printType).toBe("CASH_SESSION_SUMMARY");
        expect(normalized.kind).toBe("CASH_SESSION_SUMMARY");
        expect(normalized.headerLines.join(" ")).toContain("SESSIONE:");
        expect(normalized.headerLines.join(" ")).toContain("POSTAZIONE: Cassa 1");
    });

    it("normalizes legacy document with MANUAL_TEST kind", () => {
        const normalized = normalizeLegacyPrintDocument({
            kind: "MANUAL_TEST",
            title: "Test Stampa",
            items: [{ name: "Item 1", qty: 1 }]
        });

        expect(normalized.printType).toBe("MANUAL_TEST");
    });

    it("normalizes totals from array with missing label/value", () => {
        const normalized = normalizeLegacyPrintDocument({
            items: [],
            totals: [
                { label: "TOTALE", value: "5.00 EUR" },
                { label: "", value: "orphan" },            // invalid: empty label
                { label: "VALIDO", value: "" },             // invalid: empty value
                null,
                42
            ]
        });

        expect(normalized.totals).toHaveLength(1);
        expect(normalized.totals[0].label).toBe("TOTALE");
    });

    /* ───────── buildPreviewLines ───────── */

    it("builds preview lines from normalized structure", () => {
        const lines = buildPreviewLines({
            schemaVersion: 2,
            printType: "CUSTOMER_ORDER",
            kind: "COMANDA",
            title: "Comanda Cliente",
            copyLabel: "COPIA CLIENTE",
            referenceCode: "123",
            pizzaNumber: 44,
            createdAt: "2026-02-28T10:00:00.000Z",
            headerLines: ["FESTA: Evento Test", "CLIENTE: Mario", "TAVOLO: C1"],
            items: [{ qty: 1, quantity: 1, name: "Panino" }],
            totals: [{ label: "TOTALE", value: "5.00 EUR", emphasis: "strong" }],
            footerLines: ["Vale solo per il ritiro"]
        });

        expect(lines).toContain("COMANDA CLIENTE");
        expect(lines).toContain("COPIA CLIENTE");
        expect(lines).toContain("PIZZA N° 44");
        expect(lines).toContain("ORDINE N° 123");
        expect(lines).toContain("DESCRIZIONE");
        expect(lines).toContain("1x Panino");
        expect(lines).toContain("TOTALE --> 5.00 EUR");
    });

    it("builds preview lines for cash session with SESSIONE N° prefix", () => {
        const lines = buildPreviewLines({
            schemaVersion: 2,
            printType: "CASH_SESSION_SUMMARY",
            kind: "CASH_SESSION_SUMMARY",
            title: "Chiusura Cassa",
            copyLabel: "COPIA CASSA",
            referenceCode: "AABBCCDD",
            createdAt: "2026-02-28T10:00:00.000Z",
            headerLines: ["POSTAZIONE: Cassa 1"],
            items: [],
            totals: [
                { label: "FONDO INIZIALE", value: "100.00 EUR" },
                { label: "TOTALE INCASSI", value: "75.00 EUR", emphasis: "strong" }
            ],
            footerLines: []
        });

        expect(lines).toContain("SESSIONE N° AABBCCDD");
        expect(lines.some((l) => l.includes("TOTALE INCASSI --> 75.00 EUR"))).toBe(true);
        expect(lines.some((l) => l.includes("FONDO INIZIALE: 100.00 EUR"))).toBe(true);
    });

    it("builds preview lines with item notes and options", () => {
        const lines = buildPreviewLines({
            schemaVersion: 2,
            printType: "CUSTOMER_ORDER",
            kind: "COMANDA",
            title: "Comanda",
            copyLabel: "COPIA CLIENTE",
            createdAt: "2026-02-28T10:00:00.000Z",
            headerLines: [],
            items: [
                {
                    qty: 1, quantity: 1, name: "Hamburger",
                    notes: "Ben cotto",
                    selectedOptions: [
                        { name: "Extra formaggio", priceVariation: 1.5 },
                        { name: "Senape" }
                    ]
                }
            ],
            totals: [],
            footerLines: []
        });

        expect(lines).toContain("1x Hamburger");
        expect(lines).toContain("NOTE: Ben cotto");
        expect(lines.some((l) => l.includes("+ Extra formaggio (1.50 EUR)"))).toBe(true);
        expect(lines.some((l) => l.includes("+ Senape"))).toBe(true);
    });

    it("wraps lines longer than maxLength", () => {
        const lines = buildPreviewLines({
            schemaVersion: 2,
            printType: "CUSTOMER_ORDER",
            kind: "COMANDA",
            title: "Titolo Molto Lungo Che Supera Il Limite Di Trentasei Caratteri",
            copyLabel: "COPIA",
            createdAt: "2026-02-28T10:00:00.000Z",
            headerLines: [],
            items: [],
            totals: [],
            footerLines: []
        });

        // Title should have been wrapped
        const titleLines = lines.filter((l) => l.includes("TITOLO") || l.includes("CARATTERI") || l.includes("LUNGO"));
        expect(titleLines.length).toBeGreaterThanOrEqual(2);
    });

    it("produces minimal preview for empty items and totals", () => {
        const lines = buildPreviewLines({
            schemaVersion: 2,
            printType: "CUSTOMER_ORDER",
            kind: "COMANDA",
            title: "Vuota",
            copyLabel: "COPIA",
            createdAt: "2026-02-28T10:00:00.000Z",
            headerLines: [],
            items: [],
            totals: [],
            footerLines: []
        });

        expect(lines).toContain("VUOTA");
        expect(lines).toContain("COPIA");
        // Should not contain DESCRIZIONE since no items
        expect(lines).not.toContain("DESCRIZIONE");
    });

    it("caps preview lines at 120", () => {
        const manyItems = Array.from({ length: 200 }, (_, i) => ({
            qty: 1, quantity: 1, name: `Product ${i}`
        }));

        const lines = buildPreviewLines({
            schemaVersion: 2,
            printType: "CUSTOMER_ORDER",
            kind: "COMANDA",
            title: "Megaordine",
            copyLabel: "COPIA",
            createdAt: "2026-02-28T10:00:00.000Z",
            headerLines: [],
            items: manyItems,
            totals: [],
            footerLines: []
        });

        expect(lines.length).toBeLessThanOrEqual(120);
    });

    /* ───────── toOrderJobPayloadFromDocument ───────── */

    it("converts document to order payload for retry", () => {
        const payload = toOrderJobPayloadFromDocument({
            kind: "COMANDA",
            title: "Comanda",
            shortCode: "ABC",
            pizzaNumber: 18,
            pizzaBarcodeValue: "PZ:retry-order",
            customerName: "Anna",
            tableNumber: "T5",
            items: [{ name: "Patatine", quantity: 2 }],
            totals: [{ label: "TOTALE", value: "6.00 EUR" }]
        }, "fallback-order");

        expect(payload.orderId).toBe("fallback-order");
        expect(payload.shortCode).toBe("ABC");
        expect(payload.pizzaNumber).toBe(18);
        expect(payload.pizzaBarcodeValue).toBe("PZ:retry-order");
        expect(payload.items[0]).toMatchObject({ name: "Patatine", quantity: 2 });
        expect(payload.totals[0]).toMatchObject({ label: "TOTALE", value: "6.00 EUR" });
    });

    it("defaults priceVariation to 0 for options missing it", () => {
        const payload = toOrderJobPayloadFromDocument({
            items: [{
                name: "Panino",
                quantity: 1,
                selectedOptions: [
                    { name: "Ketchup" }   // no priceVariation
                ]
            }],
            totals: []
        }, "fallback");

        expect(payload.items[0].selectedOptions![0].priceVariation).toBe(0);
    });

    it("uses fallbackOrderId when document has no orderId", () => {
        const payload = toOrderJobPayloadFromDocument({
            title: "No Order ID",
            items: [],
            totals: []
        }, "my-fallback-id");

        expect(payload.orderId).toBe("my-fallback-id");
    });

    it("preserves brandingLogoUrl from normalized branding", () => {
        const payload = toOrderJobPayloadFromDocument({
            schemaVersion: 2,
            branding: { logoPath: "/uploads/menu-headers/logo.png", logoMode: "printed" },
            items: [],
            totals: []
        }, "fb");

        expect(payload.brandingLogoUrl).toBe("/uploads/menu-headers/logo.png");
    });
});
