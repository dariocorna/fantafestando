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

describe("POST /api/pizza-console/scan", () => {
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

    test("rejects legacy order barcodes", async () => {
        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: `PZ:${ORDER_ID}` }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);

        expect(response.status).toBe(400);
        expect(orderFindOneMock).not.toHaveBeenCalled();
    });

    test("marks a queued dish ticket as ready from an EAN-8 barcode", async () => {
        mockOrder({
            _id: ORDER_ID,
            dishTickets: [{
                productId: "prod-1",
                pizzaNumber: 42,
                state: "QUEUED"
            }]
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: "00000420" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.status).toBe("ready");
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            {
                _id: ORDER_ID,
                eventId: "evt-1",
                status: "PAID"
            },
            expect.objectContaining({
                $set: expect.objectContaining({
                    "dishTickets.$[ticket].state": "READY"
                })
            }),
            { arrayFilters: [{ "ticket.pizzaNumber": 42 }] }
        );
    });

    test("marks a queued pizza ticket as ready from an EAN-8 pizza barcode", async () => {
        mockOrder({
            _id: ORDER_ID,
            dishTickets: [{
                productId: "prod-1",
                pizzaNumber: 42,
                state: "QUEUED"
            }]
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: "00000420" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.status).toBe("ready");
        expect(orderFindOneMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            status: "PAID",
            "dishTickets.pizzaNumber": 42
        });
    });

    test("accepts manual pizza numbers shorter than the printed barcode", async () => {
        mockOrder({
            _id: ORDER_ID,
            dishTickets: [{
                productId: "prod-1",
                pizzaNumber: 42,
                state: "QUEUED"
            }]
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: "42" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.status).toBe("ready");
        expect(orderFindOneMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            status: "PAID",
            "dishTickets.pizzaNumber": 42
        });
    });

    test("returns already_ready without updating again", async () => {
        mockOrder({
            _id: ORDER_ID,
            dishTickets: [{
                productId: "prod-1",
                pizzaNumber: 42,
                state: "READY",
                readyAt: "2026-03-26T10:10:00.000Z"
            }]
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: "42" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.status).toBe("already_ready");
        expect(orderUpdateOneMock).not.toHaveBeenCalled();
    });

    test("rejects unauthenticated requests before touching the database", async () => {
        ensureAuthenticatedSessionMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: `PZ:${ORDER_ID}` }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);

        expect(response.status).toBe(401);
        expect(orderFindOneMock).not.toHaveBeenCalled();
        expect(getActiveEventIdMock).not.toHaveBeenCalled();
    });

    test("rejects malformed barcode payloads", async () => {
        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: "00000042" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload.status).toBe("invalid");
    });
});
