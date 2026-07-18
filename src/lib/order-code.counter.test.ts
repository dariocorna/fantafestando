import { beforeEach, describe, expect, test, vi } from "vitest";

const { findOneAndUpdateMock } = vi.hoisted(() => ({
    findOneAndUpdateMock: vi.fn()
}));

vi.mock("@/models/OrderCounter", () => ({
    default: {
        findOneAndUpdate: findOneAndUpdateMock
    }
}));

import { getNextPizzaOrderNumber, getNextPublicOrderNumber } from "./order-code";

describe("order-code counters", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("increments the public order counter independently", async () => {
        findOneAndUpdateMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ seq: 41 })
            })
        });

        await expect(getNextPublicOrderNumber("evt-1")).resolves.toBe(41);
        expect(findOneAndUpdateMock).toHaveBeenCalledWith(
            { eventId: "evt-1", scope: "PUBLIC_ORDER" },
            { $inc: { seq: 1 } },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
    });

    test("increments the pizza order counter with a dedicated scope", async () => {
        findOneAndUpdateMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ seq: 9 })
            })
        });

        await expect(getNextPizzaOrderNumber("evt-1")).resolves.toBe(9);
        expect(findOneAndUpdateMock).toHaveBeenCalledWith(
            { eventId: "evt-1", scope: "PIZZA_ORDER" },
            { $inc: { seq: 1 } },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
    });
});
