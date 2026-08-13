import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findOneAndUpdate: vi.fn(), updateOne: vi.fn() }));

vi.mock("@/models/Event", () => ({
    default: { findOneAndUpdate: mocks.findOneAndUpdate, updateOne: mocks.updateOne }
}));

import { claimSumUpEventOperation, releaseSumUpEventOperation } from "./sumup-event-operation";

beforeEach(() => vi.clearAllMocks());

test("claims an active event with an expiring atomic lease", async () => {
    const lean = vi.fn().mockResolvedValue({ _id: "event-1" });
    const select = vi.fn().mockReturnValue({ lean });
    mocks.findOneAndUpdate.mockReturnValue({ select });

    await expect(claimSumUpEventOperation("event-1", true)).resolves.toEqual(expect.any(String));

    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
            _id: "event-1",
            active: true,
            archived: { $ne: true },
            $or: expect.any(Array)
        }),
        { $set: { sumupOperationClaim: { token: expect.any(String), expiresAt: expect.any(Date) } } },
        { returnDocument: "after" }
    );
});

test("allows maintenance operations to claim an archived event", async () => {
    const lean = vi.fn().mockResolvedValue({ _id: "event-1" });
    const select = vi.fn().mockReturnValue({ lean });
    mocks.findOneAndUpdate.mockReturnValue({ select });

    await expect(claimSumUpEventOperation("event-1")).resolves.toEqual(expect.any(String));

    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
        {
            _id: "event-1",
            $or: expect.any(Array)
        },
        expect.any(Object),
        { returnDocument: "after" }
    );
});

test("releases only the owned event lease", async () => {
    await releaseSumUpEventOperation("event-1", "claim-1");
    expect(mocks.updateOne).toHaveBeenCalledWith(
        { _id: "event-1", "sumupOperationClaim.token": "claim-1" },
        { $unset: { sumupOperationClaim: 1 } }
    );
});
