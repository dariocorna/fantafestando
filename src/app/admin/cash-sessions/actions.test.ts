import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    ensureAdminSessionMock,
    dbConnectMock,
    cashSessionFindByIdMock,
    cashSessionFindOneMock,
    cashSessionFindOneAndUpdateMock,
    cashSessionUpdateOneMock,
    getAdminContextEventIdMock,
    buildCashSessionPrintDocumentV2Mock,
    orderFindMock,
    orderExistsMock,
    transitionCashSessionStockMock,
    productFindMock
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    dbConnectMock: vi.fn(),
    cashSessionFindByIdMock: vi.fn(),
    cashSessionFindOneMock: vi.fn(),
    cashSessionFindOneAndUpdateMock: vi.fn(),
    cashSessionUpdateOneMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    buildCashSessionPrintDocumentV2Mock: vi.fn(),
    orderFindMock: vi.fn(),
    orderExistsMock: vi.fn(),
    transitionCashSessionStockMock: vi.fn(),
    productFindMock: vi.fn()
}));

vi.mock("@/lib/authz", () => ({
    ensureAdminSession: ensureAdminSessionMock
}));

vi.mock("@/models/CashSession", () => ({
    default: {
        findById: cashSessionFindByIdMock,
        findOne: cashSessionFindOneMock,
        findOneAndUpdate: cashSessionFindOneAndUpdateMock,
        updateOne: cashSessionUpdateOneMock
    }
}));

vi.mock("@/models/Order", () => ({
    default: {
        find: orderFindMock,
        exists: orderExistsMock
    }
}));

vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }));
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }));
vi.mock("@/lib/cash-session-stock", () => ({ transitionCashSessionStock: transitionCashSessionStockMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/models/Product", () => ({
    default: {
        find: productFindMock
    }
}));

vi.mock("@/lib/print-report", () => ({
    buildCashSessionPrintDocumentV2: buildCashSessionPrintDocumentV2Mock
}));

import { deleteCashSessionAction, getClosedCashSessionPrintDocumentAction, setCashSessionTestAction } from "./actions";

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

describe("setCashSessionTestAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAdminSessionMock.mockResolvedValue({ ok: true, user: { id: "admin-1", role: "ADMIN" } });
        orderExistsMock.mockResolvedValue(null);
        transitionCashSessionStockMock.mockResolvedValue({ success: true, approximateOrders: 0 });
        cashSessionUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    });

    it("allows only one new token to claim a closed-session transition", async () => {
        const session = {
            _id: "session-1",
            eventId: { toString: () => "event-1" },
            status: "CLOSED",
            isTest: false
        };
        cashSessionFindByIdMock.mockResolvedValue(session);
        cashSessionFindOneAndUpdateMock
            .mockResolvedValueOnce(session)
            .mockResolvedValueOnce(null);

        const results = await Promise.all([
            setCashSessionTestAction("session-1", true),
            setCashSessionTestAction("session-1", true)
        ]);

        expect(results.filter((result) => result.success)).toHaveLength(1);
        expect(results.filter((result) => !result.success)).toHaveLength(1);
        expect(transitionCashSessionStockMock).toHaveBeenCalledTimes(1);
        expect(cashSessionFindOneAndUpdateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: "session-1",
                status: "CLOSED",
                isTest: { $ne: true },
                $and: [
                    expect.objectContaining({ $or: expect.any(Array) }),
                    expect.objectContaining({ $or: expect.any(Array) })
                ]
            }),
            {
                $set: { transition: { token: expect.any(String), type: "TO_TEST", status: "IN_PROGRESS", claimedAt: expect.any(Date) } },
                $unset: { paymentClaim: 1 }
            },
            { returnDocument: "after" }
        );
    });

    it("does not inspect orders when a concurrent payment owns the session", async () => {
        const session = { _id: "session-1", status: "OPEN", isTest: false };
        cashSessionFindByIdMock.mockResolvedValue(session);
        cashSessionFindOneAndUpdateMock.mockResolvedValue(null);

        const result = await setCashSessionTestAction("session-1", true);

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("pagamento in corso") });
        expect(cashSessionFindOneAndUpdateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "OPEN",
                $and: [
                    expect.objectContaining({ $or: expect.any(Array) }),
                    expect.objectContaining({
                        $or: expect.arrayContaining([
                            { paymentClaim: null },
                            { "paymentClaim.claimedAt": { $lte: expect.any(Date) } }
                        ])
                    })
                ]
            }),
            expect.any(Object),
            { returnDocument: "after" }
        );
        expect(orderExistsMock).not.toHaveBeenCalled();
        expect(cashSessionUpdateOneMock).not.toHaveBeenCalled();
    });

    it("rechecks a webhook-completed payment only after acquiring the exclusive transition", async () => {
        const session = { _id: "session-1", status: "OPEN", isTest: false };
        cashSessionFindByIdMock.mockResolvedValue(session);
        cashSessionFindOneAndUpdateMock.mockResolvedValue(session);
        orderExistsMock.mockImplementation(async (query) =>
            query.$or?.some((branch: { status?: string }) => branch.status === "PAID")
                ? { _id: "order-1" }
                : null
        );

        const result = await setCashSessionTestAction("session-1", true);

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("rimborsa") });
        expect(cashSessionFindOneAndUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(orderExistsMock.mock.invocationCallOrder[0]);
        expect(cashSessionUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: "session-1",
                "transition.token": expect.any(String),
                "transition.type": "TO_TEST"
            }),
            { $unset: { transition: 1 } }
        );
    });

    it.each([
        ["OPEN", "PENDING", "in attesa"],
        ["CLOSED", "PENDING", "in attesa"],
        ["CLOSED", "PAID", "rimborsa"]
    ] as const)(
        "releases the %s-session transition when a %s SumUp order blocks TEST",
        async (status, orderStatus, errorFragment) => {
            const session = {
                _id: "session-1",
                eventId: { toString: () => "event-1" },
                status,
                isTest: false
            };
            cashSessionFindByIdMock.mockResolvedValue(session);
            cashSessionFindOneAndUpdateMock.mockResolvedValue(session);
            orderExistsMock.mockImplementation(async (query) => {
                const statuses = query.$or?.map((branch: { status?: string }) => branch.status) || [query.status];
                return statuses.includes(orderStatus) ? { _id: "order-1" } : null;
            });

            const result = await setCashSessionTestAction("session-1", true);

            expect(result).toMatchObject({ success: false, error: expect.stringContaining(errorFragment) });
            expect(cashSessionUpdateOneMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: "session-1",
                    "transition.token": expect.any(String),
                    "transition.type": "TO_TEST"
                }),
                { $unset: { transition: 1 } }
            );
            expect(transitionCashSessionStockMock).not.toHaveBeenCalled();
        }
    );

    it.each(["OPEN", "CLOSED"] as const)(
        "allows a %s session containing only manual CARD payments to become TEST",
        async (status) => {
            const session = {
                _id: "session-1",
                eventId: { toString: () => "event-1" },
                status,
                isTest: false
            };
            cashSessionFindByIdMock.mockResolvedValue(session);
            cashSessionFindOneAndUpdateMock.mockResolvedValue(session);

            const result = await setCashSessionTestAction("session-1", true);

            expect(result).toMatchObject({ success: true });
            expect(orderExistsMock).toHaveBeenNthCalledWith(1, {
                cashSessionId: "session-1",
                $or: [
                    {
                        status: "PAID",
                        $or: [
                            { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                            { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                        ]
                    },
                    {
                        status: "CANCELLED",
                        sumupLateSuccessDetectedAt: { $exists: true, $ne: null },
                        "stornoMeta.refundStatus": { $ne: "DONE" }
                    }
                ]
            });
            expect(orderExistsMock).toHaveBeenNthCalledWith(2, {
                cashSessionId: "session-1",
                status: "PENDING",
                sumupCheckoutId: { $exists: true, $nin: [null, ""] }
            });
            expect(cashSessionUpdateOneMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    _id: "session-1",
                    "transition.token": expect.any(String),
                    "transition.type": "TO_TEST",
                    ...(status === "OPEN" ? { status: "OPEN" } : {})
                }),
                status === "OPEN"
                    ? { $set: { isTest: true }, $unset: { transition: 1 } }
                    : {
                        $set: { isTest: true, stockEffectStatus: "REVERTED" },
                        $unset: { transition: 1 }
                    }
            );
        }
    );

    it("blocks TEST when a cancelled SumUp order has an unresolved late success without a transaction id", async () => {
        const session = {
            _id: "session-1",
            eventId: { toString: () => "event-1" },
            status: "CLOSED",
            isTest: false
        };
        cashSessionFindByIdMock.mockResolvedValue(session);
        cashSessionFindOneAndUpdateMock.mockResolvedValue(session);
        orderExistsMock.mockResolvedValueOnce({ _id: "late-order-1" });

        const result = await setCashSessionTestAction("session-1", true);

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("rimborsa") });
        expect(orderExistsMock).toHaveBeenCalledWith({
            cashSessionId: "session-1",
            $or: expect.arrayContaining([
                {
                    status: "CANCELLED",
                    sumupLateSuccessDetectedAt: { $exists: true, $ne: null },
                    "stornoMeta.refundStatus": { $ne: "DONE" }
                }
            ])
        });
        expect(transitionCashSessionStockMock).not.toHaveBeenCalled();
    });
});

describe("deleteCashSessionAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAdminSessionMock.mockResolvedValue({ ok: true, user: { id: "admin-1", role: "ADMIN" } });
        getAdminContextEventIdMock.mockResolvedValue("event-1");
        cashSessionUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    });

    it("keeps a session with an unresolved late SumUp success without a transaction id", async () => {
        const session = {
            _id: "session-1",
            eventId: { toString: () => "event-1" },
            status: "CLOSED",
            stockEffectStatus: "REVERTED"
        };
        cashSessionFindOneMock.mockResolvedValue(session);
        cashSessionFindOneAndUpdateMock.mockResolvedValue(session);
        orderExistsMock.mockResolvedValueOnce({ _id: "late-order-1" });

        const result = await deleteCashSessionAction("session-1", "ELIMINA");

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("rimborsa") });
        expect(orderExistsMock).toHaveBeenCalledWith({
            cashSessionId: "session-1",
            $or: expect.arrayContaining([
                {
                    status: "CANCELLED",
                    sumupLateSuccessDetectedAt: { $exists: true, $ne: null },
                    "stornoMeta.refundStatus": { $ne: "DONE" }
                }
            ])
        });
        expect(cashSessionUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: "session-1",
                "transition.type": "DELETE"
            }),
            { $unset: { transition: 1, deletionStatus: 1 } }
        );
        expect(transitionCashSessionStockMock).not.toHaveBeenCalled();
        expect(orderFindMock).not.toHaveBeenCalled();
    });
});
