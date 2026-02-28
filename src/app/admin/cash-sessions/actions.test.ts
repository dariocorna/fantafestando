import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureAdminSessionMock, cashSessionFindByIdMock, buildCashSessionPrintDocumentV2Mock, orderFindMock } = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    cashSessionFindByIdMock: vi.fn(),
    buildCashSessionPrintDocumentV2Mock: vi.fn(),
    orderFindMock: vi.fn()
}));

vi.mock("@/lib/authz", () => ({
    ensureAdminSession: ensureAdminSessionMock
}));

vi.mock("@/models/CashSession", () => ({
    default: {
        findById: cashSessionFindByIdMock
    }
}));

vi.mock("@/models/Order", () => ({
    default: {
        find: orderFindMock
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
            openingFloatAmount: 100,
            cashSalesAmount: 50,
            cardSalesAmount: 20,
            otherSalesAmount: 10,
            expectedCashAmount: 150,
            closingCountedCashAmount: 150,
            varianceAmount: 0,
            paidOrdersCount: 5
        };

        cashSessionFindByIdMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(mockSession)
            })
        });

        orderFindMock.mockReturnValue({
            lean: vi.fn().mockResolvedValue([
                {
                    cart: [
                        { productId: "p1", snapshotName: "Birra", quantity: 2, lineTotal: 10 },
                        { productId: "p2", snapshotName: "Patatine", quantity: 1, lineTotal: 5 }
                    ]
                },
                {
                    cart: [
                        { productId: "p1", snapshotName: "Birra", quantity: 1, lineTotal: 5 }
                    ]
                }
            ])
        });

        buildCashSessionPrintDocumentV2Mock.mockReturnValue({ title: "MOCK DOCUMENT" });

        const result = await getClosedCashSessionPrintDocumentAction("session-123", "Cassa Bar");

        expect(ensureAdminSessionMock).toHaveBeenCalled();
        expect(orderFindMock).toHaveBeenCalledWith({
            cashSessionId: expect.anything(),
            status: "PAID"
        });
        expect(buildCashSessionPrintDocumentV2Mock).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: "session-123",
            eventName: "Test Event",
            posDeviceName: "Cassa Bar",
            openingFloatAmount: 100,
            cashSalesAmount: 50,
            items: expect.arrayContaining([
                expect.objectContaining({ name: "Birra", qty: 3, lineTotal: 15 }),
                expect.objectContaining({ name: "Patatine", qty: 1, lineTotal: 5 })
            ])
        }));
        expect(result).toEqual({ title: "MOCK DOCUMENT" });
    });
});
