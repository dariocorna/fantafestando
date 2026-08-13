import { randomUUID } from "node:crypto";
import dbConnect from "@/lib/mongoose";
import Event from "@/models/Event";
import PrintJob from "@/models/PrintJob";
import Printer from "@/models/Printer";
import { completeSumUpPrintIntentsForSentJob } from "@/lib/sumup-print-routing";

const PRINT_QUEUE_LEASE_MS = 5 * 60 * 1000;

type DispatchResult = {
    success: boolean;
    recoverable?: boolean;
    error?: string;
    rawCapturePath?: string;
    automaticRetryCount?: number;
};

export type HeldPrintQueueDispatcher = (
    eventId: string,
    jobId: string
) => Promise<DispatchResult>;

const queuedKitchenJob = {
    source: "ORDER",
    printType: "KITCHEN_ORDER",
    queueRecoverable: true,
    heldSince: { $exists: true }
} as const;

function leaseAvailabilityFilter(now: Date) {
    return {
        $or: [
            { printQueueLeaseToken: { $exists: false } },
            { printQueueLeaseExpiresAt: { $exists: false } },
            { printQueueLeaseExpiresAt: { $lte: now } }
        ]
    };
}

export function buildPrintQueueLease(deadlineFrom: Date = new Date()) {
    const token = randomUUID();
    const expiresAt = new Date(deadlineFrom.getTime() + PRINT_QUEUE_LEASE_MS);
    return { token, expiresAt };
}

export async function claimKitchenPrinterQueueLease(
    printerId: unknown,
    token: string,
    expiresAt: Date
): Promise<boolean> {
    if (!printerId || !token) return false;

    await dbConnect();
    const printer = await Printer.findOneAndUpdate(
        {
            _id: printerId,
            type: "KITCHEN",
            ...leaseAvailabilityFilter(new Date())
        },
        {
            $set: {
                printQueueLeaseToken: token,
                printQueueLeaseExpiresAt: expiresAt
            }
        },
        { returnDocument: "after" }
    ).select("_id").lean();

    return Boolean(printer);
}

export async function refreshKitchenPrinterQueueLease(
    printerId: unknown,
    token: string,
    expiresAt: Date
): Promise<boolean> {
    if (!printerId || !token) return false;

    await dbConnect();
    const result = await Printer.updateOne(
        { _id: printerId, printQueueLeaseToken: token },
        { $set: { printQueueLeaseExpiresAt: expiresAt } }
    );
    return (result.matchedCount ?? result.modifiedCount) === 1;
}

export async function releaseKitchenPrinterQueueLease(
    printerId: unknown,
    token: string
): Promise<void> {
    if (!printerId || !token) return;

    await dbConnect();
    await Printer.updateOne(
        { _id: printerId, printQueueLeaseToken: token },
        { $unset: { printQueueLeaseToken: 1, printQueueLeaseExpiresAt: 1 } }
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || "Invio stampa fallito");
}

export function isRecoverablePrintFailure(error: unknown): boolean {
    if (typeof error === "object" && error !== null && "code" in error) {
        const code = String(error.code).toUpperCase();
        if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EPIPE"].includes(code)) {
            return true;
        }
    }

    const message = errorMessage(error).toLowerCase();
    return [
        "printer not reachable",
        "printer connection timeout",
        "printer execution timeout",
        "econnrefused",
        "econnreset",
        "ehostunreach",
        "enetunreach",
        "etimedout",
        "connection refused",
        "not reachable"
    ].some((fragment) => message.includes(fragment));
}

export async function recoverStaleLiveKitchenPrintJobs(scope: {
    eventId: string;
    orderId?: string;
    printerId?: string;
}) {
    await dbConnect();
    const now = new Date();
    const result = await PrintJob.updateMany(
        {
            eventId: scope.eventId,
            ...(scope.orderId ? { orderId: scope.orderId } : {}),
            ...(scope.printerId ? { printerId: scope.printerId } : {}),
            source: "ORDER",
            printType: "KITCHEN_ORDER",
            queueRecoverable: true,
            status: "QUEUED",
            heldSince: { $exists: false },
            queueClaimToken: { $exists: false },
            retryClaimedAt: { $exists: false },
            $or: [
                { liveClaimExpiresAt: { $lte: now } },
                {
                    liveClaimExpiresAt: { $exists: false },
                    createdAt: { $lte: new Date(now.getTime() - PRINT_QUEUE_LEASE_MS) }
                }
            ]
        },
        {
            $set: {
                status: "FAILED",
                errorMessage: "Invio reparto interrotto: verifica la stampa prima di riprovare"
            },
            $unset: { liveClaimExpiresAt: 1, queueClaimExpiresAt: 1 }
        }
    );
    return { recovered: result.modifiedCount || 0 };
}

export async function recoverStaleManualPrintRetryClaims(eventId: string, orderId: string) {
    await dbConnect();
    if (!eventId || !orderId) return { recovered: 0 };

    const result = await PrintJob.updateMany(
        {
            eventId,
            orderId,
            source: "ORDER",
            status: "QUEUED",
            heldSince: { $exists: false },
            retryClaimedAt: { $lte: new Date(Date.now() - PRINT_QUEUE_LEASE_MS) }
        },
        {
            $set: { status: "FAILED", errorMessage: "Reinvio interrotto: riprova" },
            $unset: { retryClaimedAt: 1 }
        }
    );
    const live = await recoverStaleLiveKitchenPrintJobs({ eventId, orderId });
    return { recovered: (result.modifiedCount || 0) + live.recovered };
}

export async function holdFailedKitchenPrintJobs({
    eventId,
    orderId,
    jobIds
}: {
    eventId: string;
    orderId: string;
    jobIds: string[];
}): Promise<{ held: number; busyPrinterIds: string[] }> {
    await dbConnect();
    if (!eventId || !orderId || jobIds.length === 0) return { held: 0, busyPrinterIds: [] };

    const sourceJobs = {
        eventId,
        orderId,
        _id: { $in: jobIds },
        source: "ORDER",
        printType: "KITCHEN_ORDER",
        queueRecoverable: true,
        status: "FAILED"
    };
    const referencedPrinterIds = await PrintJob.distinct("printerId", sourceJobs);
    if (referencedPrinterIds.length === 0) return { held: 0, busyPrinterIds: [] };

    const kitchenPrinterIds = await Printer.distinct("_id", {
        _id: { $in: referencedPrinterIds },
        eventId,
        type: "KITCHEN"
    });
    if (kitchenPrinterIds.length === 0) return { held: 0, busyPrinterIds: [] };

    let held = 0;
    const busyPrinterIds: string[] = [];

    for (const printerId of kitchenPrinterIds) {
        const lease = buildPrintQueueLease();
        const claimed = await claimKitchenPrinterQueueLease(printerId, lease.token, lease.expiresAt);
        if (!claimed) {
            busyPrinterIds.push(String(printerId));
            continue;
        }

        try {
            const result = await PrintJob.updateMany(
                { ...sourceJobs, printerId },
                {
                    $set: { status: "HELD", heldSince: new Date() },
                    $unset: {
                        retryClaimedAt: 1,
                        liveClaimExpiresAt: 1,
                        queueClaimToken: 1,
                        queueClaimExpiresAt: 1
                    }
                }
            );
            held += result.modifiedCount || 0;
        } finally {
            await releaseKitchenPrinterQueueLease(printerId, lease.token);
        }
    }

    return { held, busyPrinterIds };
}

async function drainPrinterQueue(
    printerId: unknown,
    activeEventIds: unknown[],
    dispatcher: HeldPrintQueueDispatcher
): Promise<{ sent: number; held: number; failed: number }> {
    const lease = buildPrintQueueLease();
    const claimed = await claimKitchenPrinterQueueLease(printerId, lease.token, lease.expiresAt);
    if (!claimed) return { sent: 0, held: 0, failed: 0 };

    let sent = 0;
    let held = 0;
    let failed = 0;

    try {
        while (true) {
            const claimLease = buildPrintQueueLease();
            const leaseRefreshed = await refreshKitchenPrinterQueueLease(
                printerId,
                lease.token,
                claimLease.expiresAt
            );
            if (!leaseRefreshed) break;

            const job = await PrintJob.findOneAndUpdate(
                {
                    printerId,
                    eventId: { $in: activeEventIds },
                    status: "HELD",
                    ...queuedKitchenJob
                },
                {
                    $set: {
                        status: "QUEUED",
                        queueClaimToken: lease.token,
                        queueClaimExpiresAt: claimLease.expiresAt
                    },
                    $unset: { retryClaimedAt: 1 }
                },
                {
                    sort: { createdAt: 1, _id: 1 },
                    returnDocument: "after"
                }
            ).select("_id eventId").lean() as ({ _id: unknown; eventId: unknown } | null);
            if (!job) break;

            let dispatchResult: DispatchResult;
            try {
                dispatchResult = await dispatcher(String(job.eventId), String(job._id));
            } catch (error) {
                dispatchResult = {
                    success: false,
                    recoverable: isRecoverablePrintFailure(error),
                    error: errorMessage(error)
                };
            }

            const claim = {
                _id: job._id,
                status: "QUEUED",
                queueClaimToken: lease.token
            };
            const automaticRetryCount = dispatchResult.automaticRetryCount ?? 0;

            if (dispatchResult.success) {
                const successUpdate: Record<string, unknown> = {
                    $set: {
                        status: "SENT",
                        automaticRetryCount,
                        ...(dispatchResult.rawCapturePath
                            ? { rawCapturePath: dispatchResult.rawCapturePath }
                            : {})
                    },
                    $unset: {
                        errorMessage: 1,
                        heldSince: 1,
                        retryClaimedAt: 1,
                        liveClaimExpiresAt: 1,
                        queueClaimToken: 1,
                        queueClaimExpiresAt: 1,
                        ...(dispatchResult.rawCapturePath ? {} : { rawCapturePath: 1 })
                    }
                };
                const finalized = await PrintJob.updateOne(claim, successUpdate);
                if ((finalized.matchedCount ?? finalized.modifiedCount) !== 1) break;
                await completeSumUpPrintIntentsForSentJob(String(job.eventId), String(job._id));
                sent += 1;
                continue;
            }

            const recoverable = dispatchResult.recoverable
                ?? isRecoverablePrintFailure(dispatchResult.error);
            const finalized = await PrintJob.updateOne(
                claim,
                {
                    $set: {
                        status: recoverable ? "HELD" : "FAILED",
                        errorMessage: dispatchResult.error || "Invio stampa fallito",
                        automaticRetryCount
                    },
                    $unset: {
                        retryClaimedAt: 1,
                        liveClaimExpiresAt: 1,
                        queueClaimToken: 1,
                        queueClaimExpiresAt: 1,
                        ...(recoverable ? {} : { heldSince: 1 })
                    }
                }
            );
            if ((finalized.matchedCount ?? finalized.modifiedCount) !== 1) break;

            if (recoverable) {
                held += 1;
                break;
            }
            failed += 1;
        }
    } finally {
        await releaseKitchenPrinterQueueLease(printerId, lease.token);
    }

    return { sent, held, failed };
}

export async function drainHeldPrintQueues(dispatcher: HeldPrintQueueDispatcher): Promise<{
    recovered: number;
    sent: number;
    held: number;
    failed: number;
}> {
    await dbConnect();
    const now = new Date();
    const activeEventIds = await Event.distinct("_id", {
        active: true,
        archived: { $ne: true }
    });
    const recovered = await PrintJob.updateMany(
        {
            eventId: { $in: activeEventIds },
            status: "QUEUED",
            ...queuedKitchenJob,
            queueClaimToken: { $exists: true },
            queueClaimExpiresAt: { $lte: now }
        },
        {
            $set: { status: "HELD" },
            $unset: {
                retryClaimedAt: 1,
                liveClaimExpiresAt: 1,
                queueClaimToken: 1,
                queueClaimExpiresAt: 1
            }
        }
    );
    const recoveredLive = await Promise.all(
        activeEventIds.map((eventId) => recoverStaleLiveKitchenPrintJobs({ eventId: String(eventId) }))
    );
    const recoveredLiveCount = recoveredLive.reduce((total, result) => total + result.recovered, 0);

    const printerIds = await PrintJob.distinct("printerId", {
        eventId: { $in: activeEventIds },
        status: "HELD",
        printerId: { $exists: true },
        ...queuedKitchenJob
    });
    const results = await Promise.all(
        printerIds.map((printerId) => drainPrinterQueue(printerId, activeEventIds, dispatcher))
    );

    return results.reduce<{ recovered: number; sent: number; held: number; failed: number }>(
        (totals, result) => ({
            recovered: totals.recovered,
            sent: totals.sent + result.sent,
            held: totals.held + result.held,
            failed: totals.failed + result.failed
        }),
        { recovered: (recovered.modifiedCount || 0) + recoveredLiveCount, sent: 0, held: 0, failed: 0 }
    );
}
