import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    ensureAdminSessionMock,
    cashSessionFindByIdMock,
    buildCashSessionPrintDocumentV2Mock,
    orderFindMock,
    productFindMock
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    cashSessionFindByIdMock: vi.fn(),
    buildCashSessionPrintDocumentV2Mock: vi.fn(),
    orderFindMock: vi.fn(),
    productFindMock: vi.fn()
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

vi.mock("@/models/Product", () => ({
    default: {
        find: productFindMock
    }
}));

vi.mock("@/lib/print-report", () => ({
    buildCashSessionPrintDocumentV2: buildCashSessionPrintDocumentV2Mock
}));

import { getClosedCashSessionPrintDocumentAction } from "./actions";

describe("getClosedCashSessionPrintDocumentAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAdminSessionMock.mockResolvedValue({
            ok: true,
            user: { id: "admin-1", username: "admin", role: "ADMIN" }
        });
    });

    it("rejects non-admin sessions before reading financial data", async () => {
        ensureAdminSessionMock.mockResolvedValue({
            ok: false,
            status: 403,
            error: "Accesso riservato agli amministratori"
        });

        await expect(getClosedCashSessionPrintDocumentAction("session-1"))
            .rejects.toThrow("Accesso riservato agli amministratori");
        expect(cashSessionFindByIdMock).not.toHaveBeenCalled();
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
                        {
                            productId: "p1",
                            snapshotName: "Birra",
                            quantity: 2,
                            selectedOptions: [{ name: "Media", priceVariation: 1 }],
                            discountApplied: 1
                        },
                        { productId: "p2", snapshotName: "Patatine", quantity: 1, selectedOptions: [] }
                    ]
                },
                {
                    cart: [
                        {
                            productId: "p1",
                            snapshotName: "Birra",
                            quantity: 1,
                            selectedOptions: [{ name: "Media", priceVariation: 1 }]
                        }
                    ]
                }
            ])
        });

        productFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                populate: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([
                        { _id: "p1", name: "Birra", shortName: "BIRRA", basePrice: 4, categoryId: { name: "Bar", printOrder: 1 } },
                        { _id: "p2", name: "Patatine", shortName: "PATATINE", basePrice: 5, categoryId: { name: "Cucina", printOrder: 2 } }
                    ])
                })
            })
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
            grossSalesAmount: 20,
            discountSalesAmount: 1,
            items: expect.arrayContaining([
                expect.objectContaining({ name: "BIRRA", qty: 1, lineTotal: 5, groupLabel: "PREZZO PIENO" }),
                expect.objectContaining({ name: "BIRRA", qty: 2, lineTotal: 9, groupLabel: "Sconto non classificato" }),
                expect.objectContaining({ name: "PATATINE", qty: 1, lineTotal: 5, groupLabel: "PREZZO PIENO" })
            ])
        }));
        expect(result).toEqual({ title: "MOCK DOCUMENT" });
    });
});
