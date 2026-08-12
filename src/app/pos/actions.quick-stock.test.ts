import { beforeEach, describe, expect, it, vi } from "vitest";

const { productFindOneAndUpdateMock, productUpdateOneMock, eventExistsMock, ensurePosAccessMock, publishStockInvalidationMock } = vi.hoisted(() => ({
    productFindOneAndUpdateMock: vi.fn(),
    productUpdateOneMock: vi.fn(),
    eventExistsMock: vi.fn(),
    ensurePosAccessMock: vi.fn(),
    publishStockInvalidationMock: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }));
vi.mock("@/lib/pos-access", () => ({ ensurePosAccess: ensurePosAccessMock }));
vi.mock("@/models/Event", () => ({ default: { exists: eventExistsMock } }));
vi.mock("@/models/Product", () => ({
    default: { findOneAndUpdate: productFindOneAndUpdateMock, updateOne: productUpdateOneMock, find: vi.fn() }
}));
vi.mock("@/models/Order", () => ({ default: {} }));
vi.mock("@/models/PosDevice", () => ({ default: {} }));
vi.mock("@/models/CashSession", () => ({ default: {} }));
vi.mock("@/models/PrintJob", () => ({ default: {} }));
vi.mock("@/lib/printer", () => ({ PrinterService: {} }));
vi.mock("@/lib/sumup", () => ({ createSumUpCheckout: vi.fn() }));
vi.mock("@/lib/secrets", () => ({ decryptSecret: vi.fn() }));
vi.mock("@/lib/pos-stock-realtime", () => ({ publishStockInvalidation: publishStockInvalidationMock }));

import { updatePosStock } from "@/app/pos/actions";

function returns(doc: unknown) {
    return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(doc) }) };
}

describe("updatePosStock deltas", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensurePosAccessMock.mockResolvedValue({ ok: true, user: { id: "u1", role: "CASHIER" } });
        eventExistsMock.mockResolvedValue({ _id: "event-1" });
        productUpdateOneMock.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    });

    it("clamps a negative variant with an array predicate, never a positional one", async () => {
        productFindOneAndUpdateMock.mockReturnValue(returns({
            _id: { toString: () => "p1" },
            stockQuantity: 5,
            variants: [{ optionName: "Media", stockQuantity: -1 }]
        }));

        const result = await updatePosStock({
            eventId: "event-1", productId: "p1", variantName: "Media", stockQuantity: null, stockDelta: -1
        });

        expect(result.success).toBe(true);
        const [clampQuery, clampUpdate] = productUpdateOneMock.mock.calls[0];
        // the positional path is only legal in the update document
        expect(JSON.stringify(clampQuery)).not.toContain("variants.$.");
        expect(clampQuery).toMatchObject({
            variants: { $elemMatch: { optionName: "Media", stockQuantity: { $lt: 0 } } }
        });
        expect(clampUpdate).toEqual({ $set: { "variants.$.stockQuantity": 0 } });
        expect(publishStockInvalidationMock).toHaveBeenCalledWith("event-1");
    });

    it("does not clamp a variant that stayed positive", async () => {
        productFindOneAndUpdateMock.mockReturnValue(returns({
            _id: { toString: () => "p1" },
            stockQuantity: 5,
            variants: [{ optionName: "Media", stockQuantity: 3 }]
        }));

        await updatePosStock({
            eventId: "event-1", productId: "p1", variantName: "Media", stockQuantity: null, stockDelta: -1
        });

        expect(productUpdateOneMock).not.toHaveBeenCalled();
    });

    it("clamps a negative product only while it is still negative", async () => {
        productFindOneAndUpdateMock.mockReturnValue(returns({
            _id: { toString: () => "p1" }, stockQuantity: -2, variants: []
        }));

        await updatePosStock({ eventId: "event-1", productId: "p1", stockQuantity: null, stockDelta: -3 });

        expect(productUpdateOneMock.mock.calls[0][0]).toMatchObject({ stockQuantity: { $lt: 0 } });
    });

    it("refuses a delta on unlimited stock instead of writing", async () => {
        productFindOneAndUpdateMock.mockReturnValue(returns(null));

        const result = await updatePosStock({ eventId: "event-1", productId: "p1", stockQuantity: null, stockDelta: 1 });

        expect(result).toMatchObject({ success: false });
        expect(productUpdateOneMock).not.toHaveBeenCalled();
        expect(publishStockInvalidationMock).not.toHaveBeenCalled();
    });
});
