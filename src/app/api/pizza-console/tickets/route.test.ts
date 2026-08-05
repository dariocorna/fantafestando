import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    ensureAuthenticatedSessionMock,
    adminUnauthorizedJsonMock,
    getActiveEventMock,
    dbConnectMock,
    orderFindMock
} = vi.hoisted(() => ({
    ensureAuthenticatedSessionMock: vi.fn(),
    adminUnauthorizedJsonMock: vi.fn(),
    getActiveEventMock: vi.fn(),
    dbConnectMock: vi.fn(),
    orderFindMock: vi.fn()
}));

vi.mock("@/lib/authz", () => ({
    ensureAuthenticatedSession: ensureAuthenticatedSessionMock,
    adminUnauthorizedJson: adminUnauthorizedJsonMock
}));

vi.mock("@/lib/events", () => ({
    getActiveEvent: getActiveEventMock
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/Order", () => ({
    default: {
        find: orderFindMock
    }
}));

import { GET } from "./route";

describe("GET /api/pizza-console/tickets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAuthenticatedSessionMock.mockResolvedValue({
            ok: true,
            user: { id: "user-1", username: "kitchen", role: "CASHIER" }
        });
        adminUnauthorizedJsonMock.mockImplementation((sessionCheck) =>
            Response.json({ error: sessionCheck.error }, { status: sessionCheck.status })
        );
    });

    test("rejects unauthenticated requests", async () => {
        ensureAuthenticatedSessionMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        });

        const response = await GET();

        expect(response.status).toBe(401);
        expect(getActiveEventMock).not.toHaveBeenCalled();
        expect(orderFindMock).not.toHaveBeenCalled();
    });

    test("returns queued and ready pizza tickets for the active event", async () => {
        getActiveEventMock.mockResolvedValue({
            _id: { toString: () => "evt-1" },
            name: "Festa Pizza"
        });
        orderFindMock
            .mockReturnValueOnce({
                sort: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        select: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue([
                                {
                                    _id: { toString: () => "507f1f77bcf86cd799439011" },
                                    pickupNumber: 12,
                                    dishTickets: [
                                        { snapshotName: "Calamari", pizzaNumber: 18, state: "QUEUED" },
                                        { snapshotName: "Arrosticini", pizzaNumber: 19, state: "READY" }
                                    ],
                                    customer: { name: "Mario", table: "A1" },
                                    createdAt: "2026-03-26T11:00:00.000Z"
                                }
                            ])
                        })
                    })
                })
            })
            .mockReturnValueOnce({
                sort: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        select: vi.fn().mockReturnValue({
                            lean: vi.fn().mockResolvedValue([
                                {
                                    _id: { toString: () => "507f1f77bcf86cd799439012" },
                                    dishTickets: [{
                                        snapshotName: "Arrosticini",
                                        pizzaNumber: 19,
                                        state: "READY",
                                        readyAt: "2026-03-26T11:20:00.000Z"
                                    }]
                                }
                            ])
                        })
                    })
                })
            });

        const response = await GET();
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(orderFindMock).toHaveBeenNthCalledWith(1, {
            eventId: "evt-1",
            status: "PAID",
            "dishTickets.state": "QUEUED"
        });
        expect(orderFindMock).toHaveBeenNthCalledWith(2, {
            eventId: "evt-1",
            status: "PAID",
            "dishTickets.state": "READY"
        });
        expect(payload).toEqual({
            eventName: "Festa Pizza",
            queuedTickets: [{
                orderId: "507f1f77bcf86cd799439011",
                pizzaNumber: 18,
                productName: "Calamari",
                orderCode: "12",
                customerName: "Mario",
                table: "A1",
                createdAt: "2026-03-26T11:00:00.000Z"
            }],
            readyTickets: [{
                orderId: "507f1f77bcf86cd799439012",
                pizzaNumber: 19,
                productName: "Arrosticini",
                readyAt: "2026-03-26T11:20:00.000Z"
            }]
        });
    });
});
