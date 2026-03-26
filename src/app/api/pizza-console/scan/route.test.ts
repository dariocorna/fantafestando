import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    getActiveEventIdMock,
    dbConnectMock,
    orderFindOneMock,
    orderUpdateOneMock
} = vi.hoisted(() => ({
    getActiveEventIdMock: vi.fn(),
    dbConnectMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderUpdateOneMock: vi.fn()
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
        getActiveEventIdMock.mockResolvedValue("evt-1");
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    });

    test("marks a queued pizza ticket as ready from a valid barcode", async () => {
        mockOrder({
            _id: "order-1",
            pizzaTicket: {
                pizzaNumber: 42,
                state: "QUEUED"
            }
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: "PZ:order-1" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.status).toBe("ready");
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            {
                _id: "order-1",
                eventId: "evt-1",
                status: "PAID",
                "pizzaTicket.pizzaNumber": 42
            },
            expect.objectContaining({
                $set: expect.objectContaining({
                    "pizzaTicket.state": "READY"
                })
            })
        );
    });

    test("returns already_ready without updating again", async () => {
        mockOrder({
            _id: "order-1",
            pizzaTicket: {
                pizzaNumber: 42,
                state: "READY",
                readyAt: "2026-03-26T10:10:00.000Z"
            }
        });

        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: "PZ:order-1" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.status).toBe("already_ready");
        expect(orderUpdateOneMock).not.toHaveBeenCalled();
    });

    test("rejects invalid barcodes", async () => {
        const response = await POST(new Request("http://localhost/api/pizza-console/scan", {
            method: "POST",
            body: JSON.stringify({ barcode: "BAD:order-1" }),
            headers: { "Content-Type": "application/json" }
        }) as unknown as import("next/server").NextRequest);
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload.status).toBe("invalid");
    });
});
