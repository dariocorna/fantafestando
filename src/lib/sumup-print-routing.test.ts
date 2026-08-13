import { beforeEach, expect, test, vi } from "vitest";

const { orderExists } = vi.hoisted(() => ({ orderExists: vi.fn() }));

vi.mock("@/models/Order", () => ({ default: { exists: orderExists } }));

import { hasPendingSumUpPrintRouting } from "./sumup-print-routing";

beforeEach(() => {
    orderExists.mockReset();
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
