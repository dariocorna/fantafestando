import { beforeEach, expect, test, vi } from "vitest";

const { orderExists, orderUpdateOne, printJobExists } = vi.hoisted(() => ({
    orderExists: vi.fn(),
    orderUpdateOne: vi.fn(),
    printJobExists: vi.fn()
}));

vi.mock("@/models/Order", () => ({ default: { exists: orderExists, updateOne: orderUpdateOne } }));
vi.mock("@/models/PrintJob", () => ({ default: { exists: printJobExists } }));

import { completeSumUpPrintIntentsIfSent, hasPendingSumUpPrintRouting } from "./sumup-print-routing";

beforeEach(() => {
    orderExists.mockReset();
    orderUpdateOne.mockReset();
    printJobExists.mockReset();
});

test("finds pending SumUp orders using products directly or as menu components", async () => {
    orderExists.mockResolvedValue({ _id: "order-1" });

    await expect(hasPendingSumUpPrintRouting("event-1", [" product-1 ", "product-2"])).resolves.toBe(true);

    expect(orderExists).toHaveBeenCalledWith({
        eventId: "event-1",
        $and: [{
            $or: [
                {
                    status: "PENDING",
                    sumupCheckoutId: { $exists: true, $nin: [null, ""] }
                },
                {
                    status: "PAID",
                    sumupPrintCompletedAt: { $exists: false },
                    $or: [
                        { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                        { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                    ]
                }
            ]
        }],
        $or: [
            { "cart.productId": { $in: ["product-1", "product-2"] } },
            { "cart.includedComponents.productId": { $in: ["product-1", "product-2"] } }
        ]
    });
});

test("keeps routing immutable until a paid SumUp order has persisted every print intent", async () => {
    orderExists.mockResolvedValue({ _id: "order-paid" });

    await expect(hasPendingSumUpPrintRouting("event-1", ["product-1"])).resolves.toBe(true);

    expect(orderExists).toHaveBeenCalledWith(expect.objectContaining({
        $and: [{
            $or: expect.arrayContaining([
                expect.objectContaining({
                    status: "PAID",
                    sumupPrintCompletedAt: { $exists: false }
                })
            ])
        }]
    }));
});

test("skips the database when no product can affect routing", async () => {
    await expect(hasPendingSumUpPrintRouting("event-1", [" "])).resolves.toBe(false);
    expect(orderExists).not.toHaveBeenCalled();
});

test("keeps the completion marker unset while a scoped print intent is not sent", async () => {
    printJobExists
        .mockResolvedValueOnce({ _id: "job-sent" })
        .mockResolvedValueOnce({ _id: "job-failed" });

    await expect(completeSumUpPrintIntentsIfSent("event-1", "order-1")).resolves.toBe(false);

    expect(printJobExists).toHaveBeenNthCalledWith(2, {
        eventId: "event-1",
        orderId: "order-1",
        source: "ORDER",
        idempotencyKey: /^SUMUP_CALLBACK:/,
        status: { $ne: "SENT" }
    });
    expect(orderUpdateOne).not.toHaveBeenCalled();
});

test("records completion after every scoped print intent was recovered", async () => {
    printJobExists
        .mockResolvedValueOnce({ _id: "job-sent" })
        .mockResolvedValueOnce(null);
    orderUpdateOne.mockResolvedValue({ matchedCount: 1 });

    await expect(completeSumUpPrintIntentsIfSent("event-1", "order-1")).resolves.toBe(true);

    expect(orderUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({
            _id: "order-1",
            eventId: "event-1",
            status: "PAID",
            sumupPrintCompletedAt: { $exists: false }
        }),
        { $set: { sumupPrintCompletedAt: expect.any(Date) } }
    );
});

test("does not complete an order when no scoped intent was ever persisted", async () => {
    printJobExists.mockResolvedValue(null);

    await expect(completeSumUpPrintIntentsIfSent("event-1", "order-1")).resolves.toBe(false);

    expect(printJobExists).toHaveBeenCalledOnce();
    expect(orderUpdateOne).not.toHaveBeenCalled();
});
