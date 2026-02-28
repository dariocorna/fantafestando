import { describe, expect, it } from "vitest";
import {
    buildCashSessionPrintDocumentV2,
    buildOrderPrintDocumentV2,
    buildPreviewLines,
    normalizeLegacyPrintDocument,
    toOrderJobPayloadFromDocument
} from "./print-report";

describe("print-report", () => {
    it("builds order document v2 with default labels and normalized rows", () => {
        const document = buildOrderPrintDocumentV2({
            printType: "CASHIER_SUMMARY",
            title: "Scontrino Cassa",
            eventName: "Festa Oratorio",
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
        expect(document.eventName).toBe("Festa Oratorio");
        expect(document.headerLines[0]).toBe("FESTA: Festa Oratorio");
        expect(document.items[0]).toMatchObject({ qty: 2, quantity: 2, name: "Panino" });
        expect(document.footerLines).toContain("Vale solo per il ritiro");
    });

    it("builds cash session document with totals and notes", () => {
        const document = buildCashSessionPrintDocumentV2({
            sessionId: "session-12345678",
            eventName: "Festa Oratorio",
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
        expect(document.headerLines[0]).toContain("FESTA: Festa Oratorio");
        expect(document.totals.map((row) => row.label)).toContain("TOTALE INCASSI");
        expect(document.footerLines.join(" ")).toContain("NOTE APERTURA");
    });

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

    it("builds preview lines from normalized structure", () => {
        const lines = buildPreviewLines({
            schemaVersion: 2,
            printType: "CUSTOMER_ORDER",
            kind: "COMANDA",
            title: "Comanda Cliente",
            copyLabel: "COPIA CLIENTE",
            referenceCode: "123",
            createdAt: "2026-02-28T10:00:00.000Z",
            headerLines: ["FESTA: Festa Oratorio", "CLIENTE: Mario", "TAVOLO: C1"],
            items: [{ qty: 1, quantity: 1, name: "Panino" }],
            totals: [{ label: "TOTALE", value: "5.00 EUR", emphasis: "strong" }],
            footerLines: ["Vale solo per il ritiro"]
        });

        expect(lines).toContain("COMANDA CLIENTE");
        expect(lines).toContain("COPIA CLIENTE");
        expect(lines).toContain("ORDINE N° 123");
        expect(lines).toContain("DESCRIZIONE");
        expect(lines).toContain("1x Panino");
        expect(lines).toContain("TOTALE --> 5.00 EUR");
    });

    it("converts document to order payload for retry", () => {
        const payload = toOrderJobPayloadFromDocument({
            kind: "COMANDA",
            title: "Comanda",
            shortCode: "ABC",
            customerName: "Anna",
            tableNumber: "T5",
            items: [{ name: "Patatine", quantity: 2 }],
            totals: [{ label: "TOTALE", value: "6.00 EUR" }]
        }, "fallback-order");

        expect(payload.orderId).toBe("fallback-order");
        expect(payload.shortCode).toBe("ABC");
        expect(payload.items[0]).toMatchObject({ name: "Patatine", quantity: 2 });
        expect(payload.totals[0]).toMatchObject({ label: "TOTALE", value: "6.00 EUR" });
    });
});
