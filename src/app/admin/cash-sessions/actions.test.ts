import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureAdminSessionMock, cashSessionFindByIdMock, buildCashSessionPrintDocumentV2Mock } = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    cashSessionFindByIdMock: vi.fn(),
    buildCashSessionPrintDocumentV2Mock: vi.fn()
}));

vi.mock("@/lib/authz", () => ({
    ensureAdminSession: ensureAdminSessionMock
}));

vi.mock("@/models/CashSession", () => ({
    default: {
        findById: cashSessionFindByIdMock
    }
}));

vi.mock("@/lib/print-report", () => ({
    buildCashSessionPrintDocumentV2: buildCashSessionPrintDocumentV2Mock
}));

import { getClosedCashSessionPrintDocumentAction } from "./actions";

describe("getClosedCashSessionPrintDocumentAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws error if session is not found", async () => {
        cashSessionFindByIdMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        });

        await expect(getClosedCashSessionPrintDocumentAction("missing-id"))
            .rejects.toThrow("Sessione cassa non trovata.");
    });

    it("throws error if session is not CLOSED", async () => {
        cashSessionFindByIdMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: "session-1",
                    status: "OPEN",
                    openedAt: new Date()
                })
            })
        });

        await expect(getClosedCashSessionPrintDocumentAction("session-1"))
            .rejects.toThrow("La sessione di cassa deve essere chiusa per visualizzare il report.");
    });

    it("returns the document for a closed session", async () => {
        const mockSession = {
            _id: { toString: () => "session-123" },
            status: "CLOSED",
            openedAt: new Date("2026-02-28T10:00:00Z"),
            closedAt: new Date("2026-02-28T12:00:00Z"),
            eventId: { name: "Test Event", _id: "evt-1" },
            openingTotals: { expectedFloatAmount: 100 },
            closingTotals: {
                cashSalesAmount: 50,
                cardSalesAmount: 20,
                otherSalesAmount: 10,
                expectedCashAmount: 150,
                countedCashAmount: 150,
                varianceAmount: 0
            },
            ordersCount: 5
        };

        cashSessionFindByIdMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(mockSession)
            })
        });

        buildCashSessionPrintDocumentV2Mock.mockReturnValue({ title: "MOCK DOCUMENT" });

        const result = await getClosedCashSessionPrintDocumentAction("session-123");

        expect(ensureAdminSessionMock).toHaveBeenCalled();
        expect(buildCashSessionPrintDocumentV2Mock).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: "session-123",
            eventName: "Test Event",
            openingFloatAmount: 100,
            cashSalesAmount: 50
        }));
        expect(result).toEqual({ title: "MOCK DOCUMENT" });
    });
});
