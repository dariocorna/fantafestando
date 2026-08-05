import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    getActiveEventMock,
    dbConnectMock,
    orderFindMock
} = vi.hoisted(() => ({
    getActiveEventMock: vi.fn(),
    dbConnectMock: vi.fn(),
    orderFindMock: vi.fn()
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

describe("GET /api/public/pizza-monitor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("returns ready pizza numbers only for paid orders of the active event", async () => {
        getActiveEventMock.mockResolvedValue({
            _id: { toString: () => "evt-1" },
            name: "Festa Pizza"
        });
        orderFindMock.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({
                        lean: vi.fn().mockResolvedValue([
                            {
                                dishTickets: [
                                    {
                                        pizzaNumber: 18,
                                        state: "READY",
                                        readyAt: "2026-03-26T11:20:00.000Z"
                                    },
                                    { pizzaNumber: 19, state: "QUEUED" }
                                ]
                            }
                        ])
                    })
                })
            })
        });

        const response = await GET();
        const payload = await response.json();

        expect(orderFindMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            status: "PAID",
            "dishTickets.state": "READY"
        });
        expect(payload).toEqual({
            eventName: "Festa Pizza",
            readyNumbers: [
                {
                    pizzaNumber: 18,
                    readyAt: "2026-03-26T11:20:00.000Z"
                }
            ]
        });
    });
});
