import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { drainHeldPrintQueuesMock, dispatchHeldKitchenPrintJobMock } = vi.hoisted(() => ({
    drainHeldPrintQueuesMock: vi.fn(),
    dispatchHeldKitchenPrintJobMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/print-queue", () => ({ drainHeldPrintQueues: drainHeldPrintQueuesMock }));
vi.mock("@/lib/printer", () => ({
    PrinterService: { dispatchHeldKitchenPrintJob: dispatchHeldKitchenPrintJobMock },
}));

describe("print queue scheduler", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        process.env.APP_SURFACE = "all";
        process.env.PRINTER_QUEUE_POLL_SECONDS = "1";
        delete (globalThis as typeof globalThis & {
            __fantafestandoPrintQueueSchedulerState?: unknown;
        }).__fantafestandoPrintQueueSchedulerState;
        drainHeldPrintQueuesMock.mockResolvedValue({ processed: 0 });
    });

    afterEach(() => {
        vi.useRealTimers();
        delete process.env.PRINTER_QUEUE_POLL_SECONDS;
        delete process.env.APP_SURFACE;
    });

    test("does not start on the public menu surface", async () => {
        process.env.APP_SURFACE = "menu";
        const { ensurePrintQueueSchedulerStarted } = await import("./print-queue-scheduler");

        ensurePrintQueueSchedulerStarted();
        await vi.runAllTicks();

        expect(drainHeldPrintQueuesMock).not.toHaveBeenCalled();
    });

    test("starts once and passes the physical dispatcher to every drain", async () => {
        const { ensurePrintQueueSchedulerStarted } = await import("./print-queue-scheduler");

        ensurePrintQueueSchedulerStarted();
        ensurePrintQueueSchedulerStarted();
        await vi.advanceTimersByTimeAsync(0);
        await vi.waitFor(() => expect(drainHeldPrintQueuesMock).toHaveBeenCalledTimes(1));

        const dispatcher = drainHeldPrintQueuesMock.mock.calls[0][0];
        dispatchHeldKitchenPrintJobMock.mockResolvedValue({ success: true });
        await expect(dispatcher("event-1", "job-1")).resolves.toEqual({ success: true });
        expect(dispatchHeldKitchenPrintJobMock).toHaveBeenCalledWith("event-1", "job-1");

        await vi.advanceTimersByTimeAsync(1000);
        expect(drainHeldPrintQueuesMock).toHaveBeenCalledTimes(2);
    });
});
