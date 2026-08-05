import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    ensureAuthenticatedSessionMock,
    adminUnauthorizedJsonMock,
    getActiveEventIdMock,
    dbConnectMock,
    orderFindOneMock,
    orderUpdateOneMock
} = vi.hoisted(() => ({
    ensureAuthenticatedSessionMock: vi.fn(),
    adminUnauthorizedJsonMock: vi.fn(),
    getActiveEventIdMock: vi.fn(),
    dbConnectMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderUpdateOneMock: vi.fn()
}));

vi.mock("@/lib/authz", () => ({
    ensureAuthenticatedSession: ensureAuthenticatedSessionMock,
    adminUnauthorizedJson: adminUnauthorizedJsonMock
}));

vi.mock("@/lib/events", () => ({
    getActiveEventId: getActiveEventIdMock
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/Order", () => ({
    default: {
        findOne: orderFindOneMock,
        updateOne: orderUpdateOneMock
    }
}));

import { POST } from "./route";

const ORDER_ID = "507f1f77bcf86cd799439011";

function mockOrder(order: unknown) {
    orderFindOneMock.mockReturnValue({
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(order)
        })
    });
}

describe("POST /api/pizza-console/remove", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAuthenticatedSessionMock.mockResolvedValue({
            ok: true,
            user: { id: "user-1", username: "kitchen", role: "CASHIER" }
        });
        adminUnauthorizedJsonMock.mockImplementation((sessionCheck) =>
            Response.json({ error: sessionCheck.error }, { status: sessionCheck.status })
        );
        getActiveEventIdMock.mockResolvedValue("evt-1");
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    });

    test("rejects unauthenticated requests before touching the database", async () => {
        ensureAuthenticatedSessionMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/remove", {
            method: "POST",
            body: JSON.stringify({ orderId: ORDER_ID, pizzaNumber: 42 }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);

        expect(response.status).toBe(401);
        expect(orderFindOneMock).not.toHaveBeenCalled();
        expect(getActiveEventIdMock).not.toHaveBeenCalled();
    });

    test("rejects malformed order ids", async () => {
        const response = await POST(new Request("http://localhost/api/pizza-console/remove", {
            method: "POST",
            body: JSON.stringify({ orderId: "abc" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload.status).toBe("invalid");
        expect(orderFindOneMock).not.toHaveBeenCalled();
    });

    test("removes a queued pizza ticket from the active console", async () => {
        mockOrder({
            _id: ORDER_ID,
            dishTickets: [{
                productId: "prod-1",
                pizzaNumber: 42,
                state: "QUEUED"
            }]
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/remove", {
            method: "POST",
            body: JSON.stringify({ orderId: ORDER_ID, pizzaNumber: 42 }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.status).toBe("removed");
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            {
                _id: ORDER_ID,
                eventId: "evt-1",
                status: "PAID"
            },
            expect.objectContaining({
                $set: expect.objectContaining({
                    "dishTickets.$[ticket].state": "REMOVED"
                }),
                $unset: expect.objectContaining({
                    "dishTickets.$[ticket].readyAt": 1
                })
            }),
            { arrayFilters: [{ "ticket.pizzaNumber": 42 }] }
        );
    });

    test("returns already_removed without updating again", async () => {
        mockOrder({
            _id: ORDER_ID,
            dishTickets: [{
                productId: "prod-1",
                pizzaNumber: 42,
                state: "REMOVED"
            }]
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/remove", {
            method: "POST",
            body: JSON.stringify({ orderId: ORDER_ID, pizzaNumber: 42 }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.status).toBe("already_removed");
        expect(orderUpdateOneMock).not.toHaveBeenCalled();
    });
});
