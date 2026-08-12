import { beforeEach, describe, expect, test, vi } from "vitest";

const { requirePosPageAccessMock, ensurePrintQueueSchedulerStartedMock } = vi.hoisted(() => ({
    requirePosPageAccessMock: vi.fn(),
    ensurePrintQueueSchedulerStartedMock: vi.fn(),
}));

vi.mock("@/lib/pos-access", () => ({ requirePosPageAccess: requirePosPageAccessMock }));
vi.mock("@/lib/print-queue-scheduler", () => ({
    ensurePrintQueueSchedulerStarted: ensurePrintQueueSchedulerStartedMock,
}));

import PosLayout from "./layout";

describe("PosLayout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("starts the persistent print queue after POS access is granted", async () => {
        requirePosPageAccessMock.mockResolvedValue({ user: { id: "cashier-1" } });

        const child = <div>POS</div>;
        await expect(PosLayout({ children: child })).resolves.toBe(child);

        expect(requirePosPageAccessMock).toHaveBeenCalledTimes(1);
        expect(ensurePrintQueueSchedulerStartedMock).toHaveBeenCalledTimes(1);
    });

    test("does not start the scheduler when POS access is rejected", async () => {
        requirePosPageAccessMock.mockRejectedValue(new Error("forbidden"));

        await expect(PosLayout({ children: <div>POS</div> })).rejects.toThrow("forbidden");
        expect(ensurePrintQueueSchedulerStartedMock).not.toHaveBeenCalled();
    });
});
