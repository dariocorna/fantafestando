import "server-only";

import { normalizeAppSurface } from "@/lib/runtime-surface";

type PrintQueueSchedulerState = {
    started: boolean;
    timer: NodeJS.Timeout | null;
    drainInFlight: boolean;
};

const schedulerGlobal = globalThis as typeof globalThis & {
    __fantafestandoPrintQueueSchedulerState?: PrintQueueSchedulerState;
};

function getSchedulerState(): PrintQueueSchedulerState {
    if (!schedulerGlobal.__fantafestandoPrintQueueSchedulerState) {
        schedulerGlobal.__fantafestandoPrintQueueSchedulerState = {
            started: false,
            timer: null,
            drainInFlight: false,
        };
    }
    return schedulerGlobal.__fantafestandoPrintQueueSchedulerState;
}

function getPollMs() {
    const parsed = Number.parseInt(process.env.PRINTER_QUEUE_POLL_SECONDS || "30", 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed * 1000 : 30_000;
}

export function ensurePrintQueueSchedulerStarted() {
    if (normalizeAppSurface(process.env.APP_SURFACE) === "menu") return;

    const state = getSchedulerState();
    if (state.started) return;

    const tick = async () => {
        if (state.drainInFlight) return;
        state.drainInFlight = true;
        try {
            const [{ drainHeldPrintQueues }, { PrinterService }] = await Promise.all([
                import("@/lib/print-queue"),
                import("@/lib/printer"),
            ]);
            await drainHeldPrintQueues((eventId, jobId) =>
                PrinterService.dispatchHeldKitchenPrintJob(eventId, jobId)
            );
        } catch (error) {
            console.error("Print queue scheduler error:", error);
        } finally {
            state.drainInFlight = false;
        }
    };

    state.started = true;
    void tick();
    state.timer = setInterval(() => {
        void tick();
    }, getPollMs());
    state.timer.unref?.();
}
