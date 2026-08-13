import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findOneAndUpdate: vi.fn(), updateOne: vi.fn() }));

vi.mock("@/models/Event", () => ({
    default: { findOneAndUpdate: mocks.findOneAndUpdate, updateOne: mocks.updateOne }
}));

import {
    claimSumUpEventOperation,
    refreshSumUpEventOperation,
    releaseSumUpEventOperation,
    startSumUpEventOperationHeartbeat
} from "./sumup-event-operation";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

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

test("refreshes only the owned event lease", async () => {
    mocks.updateOne.mockResolvedValue({ matchedCount: 1 });

    await expect(refreshSumUpEventOperation("event-1", "claim-1")).resolves.toBe(true);

    expect(mocks.updateOne).toHaveBeenCalledWith(
        { _id: "event-1", "sumupOperationClaim.token": "claim-1" },
        { $set: { "sumupOperationClaim.expiresAt": expect.any(Date) } }
    );
});

test("keeps a long-running event operation lease alive", async () => {
    vi.useFakeTimers();
    mocks.updateOne.mockResolvedValue({ matchedCount: 1 });

    const heartbeat = startSumUpEventOperationHeartbeat("event-1", "claim-1");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mocks.updateOne).toHaveBeenCalledWith(
        { _id: "event-1", "sumupOperationClaim.token": "claim-1" },
        { $set: { "sumupOperationClaim.expiresAt": expect.any(Date) } }
    );

    heartbeat.stop();
    mocks.updateOne.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.updateOne).not.toHaveBeenCalled();
});

test("reports ownership loss permanently after a rejected refresh", async () => {
    mocks.updateOne.mockResolvedValue({ matchedCount: 0 });
    const heartbeat = startSumUpEventOperationHeartbeat("event-1", "claim-1");

    await expect(heartbeat.ensureOwned()).resolves.toBe(false);
    mocks.updateOne.mockResolvedValue({ matchedCount: 1 });
    await expect(heartbeat.ensureOwned()).resolves.toBe(false);

    expect(mocks.updateOne).toHaveBeenCalledOnce();
    heartbeat.stop();
});
