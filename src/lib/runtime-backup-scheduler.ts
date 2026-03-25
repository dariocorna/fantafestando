import "server-only";

import { normalizeAppSurface } from "@/lib/runtime-surface";
import { maybeRunScheduledBackup } from "@/lib/runtime-backup";

type RuntimeBackupSchedulerState = {
    started: boolean;
    timer: NodeJS.Timeout | null;
    checkInFlight: boolean;
};

const runtimeSchedulerGlobal = globalThis as typeof globalThis & {
    __fantafestandoRuntimeBackupSchedulerState?: RuntimeBackupSchedulerState;
};

function getRuntimeSchedulerState(): RuntimeBackupSchedulerState {
    if (!runtimeSchedulerGlobal.__fantafestandoRuntimeBackupSchedulerState) {
        runtimeSchedulerGlobal.__fantafestandoRuntimeBackupSchedulerState = {
            started: false,
            timer: null,
            checkInFlight: false,
        };
    }
    return runtimeSchedulerGlobal.__fantafestandoRuntimeBackupSchedulerState;
}

function getSchedulerPollMs() {
    const parsed = Number.parseInt(process.env.BACKUP_SCHEDULER_POLL_SECONDS || "60", 10);
    if (!Number.isFinite(parsed) || parsed < 15) {
        return 60_000;
    }
    return parsed * 1000;
}

export function ensureRuntimeBackupSchedulerStarted() {
    if (normalizeAppSurface(process.env.APP_SURFACE) !== "backoffice") {
        return;
    }

    const state = getRuntimeSchedulerState();
    if (state.started) {
        return;
    }

    const tick = async () => {
        if (state.checkInFlight) return;
        state.checkInFlight = true;
        try {
            await maybeRunScheduledBackup();
        } catch (error) {
            console.error("Runtime backup scheduler error:", error);
        } finally {
            state.checkInFlight = false;
        }
    };

    state.started = true;
    void tick();
    state.timer = setInterval(() => {
        void tick();
    }, getSchedulerPollMs());
    state.timer.unref?.();
}
