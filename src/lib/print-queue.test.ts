const mocks = vi.hoisted(() => ({
    dbConnect: vi.fn(),
    printJobDistinct: vi.fn(),
    printJobUpdateMany: vi.fn(),
    printJobFindOneAndUpdate: vi.fn(),
    printJobUpdateOne: vi.fn(),
    eventDistinct: vi.fn(),
    printerDistinct: vi.fn(),
    printerFindOneAndUpdate: vi.fn(),
    printerUpdateOne: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({ default: mocks.dbConnect }));
vi.mock("@/models/PrintJob", () => ({
    default: {
        distinct: mocks.printJobDistinct,
        updateMany: mocks.printJobUpdateMany,
        findOneAndUpdate: mocks.printJobFindOneAndUpdate,
        updateOne: mocks.printJobUpdateOne
    }
}));
vi.mock("@/models/Event", () => ({
    default: {
        distinct: mocks.eventDistinct
    }
}));
vi.mock("@/models/Printer", () => ({
    default: {
        distinct: mocks.printerDistinct,
        findOneAndUpdate: mocks.printerFindOneAndUpdate,
        updateOne: mocks.printerUpdateOne
    }
}));

import {
    drainHeldPrintQueues,
    holdFailedKitchenPrintJobs,
    isRecoverablePrintFailure,
    recoverStaleLiveKitchenPrintJobs,
    recoverStaleManualPrintRetryClaims
} from "@/lib/print-queue";

function queryResult<T>(value: T) {
    return {
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(value)
        })
    };
}

function queueJobs(...jobs: Array<{ _id: string; eventId: string }>) {
    for (const job of jobs) {
        mocks.printJobFindOneAndUpdate.mockReturnValueOnce(queryResult(job));
    }
    mocks.printJobFindOneAndUpdate.mockReturnValueOnce(queryResult(null));
}

describe("print queue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.dbConnect.mockResolvedValue(undefined);
        mocks.printJobUpdateMany.mockResolvedValue({ modifiedCount: 0 });
        mocks.printJobDistinct.mockResolvedValue([]);
        mocks.printJobUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        mocks.eventDistinct.mockResolvedValue(["event-1"]);
        mocks.printerDistinct.mockResolvedValue([]);
        mocks.printerFindOneAndUpdate.mockReturnValue(queryResult(null));
        mocks.printerUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    });

    test("holds only failed ORDER kitchen jobs backed by a KITCHEN printer", async () => {
        mocks.printJobDistinct.mockResolvedValueOnce(["printer-kitchen", "printer-cashier"]);
        mocks.printerDistinct.mockResolvedValueOnce(["printer-kitchen"]);
        mocks.printerFindOneAndUpdate.mockReturnValueOnce(queryResult({ _id: "printer-kitchen" }));
        mocks.printJobUpdateMany.mockResolvedValueOnce({ modifiedCount: 1 });

        await expect(holdFailedKitchenPrintJobs({
            eventId: "event-1",
            orderId: "order-1",
            jobIds: ["job-kitchen", "job-cashier"]
        })).resolves.toEqual({ held: 1, busyPrinterIds: [] });

        const sourceQuery = {
            eventId: "event-1",
            orderId: "order-1",
            _id: { $in: ["job-kitchen", "job-cashier"] },
            source: "ORDER",
            printType: "KITCHEN_ORDER",
            queueRecoverable: true,
            status: "FAILED"
        };
        expect(mocks.printJobDistinct).toHaveBeenCalledWith("printerId", sourceQuery);
        expect(mocks.printerDistinct).toHaveBeenCalledWith("_id", {
            _id: { $in: ["printer-kitchen", "printer-cashier"] },
            eventId: "event-1",
            type: "KITCHEN"
        });
        expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(
            { ...sourceQuery, printerId: "printer-kitchen" },
            expect.objectContaining({
                $set: expect.objectContaining({ status: "HELD", heldSince: expect.any(Date) }),
                $unset: {
                    retryClaimedAt: 1,
                    liveClaimExpiresAt: 1,
                    queueClaimToken: 1,
                    queueClaimExpiresAt: 1
                }
            })
        );
    });

    test("recovers expired manual retry claims without touching held queue claims", async () => {
        mocks.printJobUpdateMany.mockResolvedValueOnce({ modifiedCount: 1 });

        await expect(recoverStaleManualPrintRetryClaims("event-1", "order-1")).resolves.toEqual({ recovered: 1 });

        expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(
            {
                eventId: "event-1",
                orderId: "order-1",
                source: "ORDER",
                status: "QUEUED",
                heldSince: { $exists: false },
                retryClaimedAt: { $lte: expect.any(Date) }
            },
            {
                $set: { status: "FAILED", errorMessage: "Reinvio interrotto: riprova" },
                $unset: { retryClaimedAt: 1 }
            }
        );
    });

    test("recovers stale initial live sends without touching active, held, or manually retried jobs", async () => {
        mocks.printJobUpdateMany.mockResolvedValueOnce({ modifiedCount: 1 });

        await expect(recoverStaleLiveKitchenPrintJobs({
            eventId: "event-1",
            orderId: "order-1",
            printerId: "printer-1"
        })).resolves.toEqual({ recovered: 1 });

        expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(
            {
                eventId: "event-1",
                orderId: "order-1",
                printerId: "printer-1",
                source: "ORDER",
                printType: "KITCHEN_ORDER",
                queueRecoverable: true,
                status: "QUEUED",
                heldSince: { $exists: false },
                queueClaimToken: { $exists: false },
                retryClaimedAt: { $exists: false },
                $or: [
                    { liveClaimExpiresAt: { $lte: expect.any(Date) } },
                    {
                        liveClaimExpiresAt: { $exists: false },
                        createdAt: { $lte: expect.any(Date) }
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
    });

    test("requires the per-job live claim to expire before recovering a persisted live send", async () => {
        mocks.printJobUpdateMany.mockResolvedValueOnce({ modifiedCount: 0 });

        await expect(recoverStaleLiveKitchenPrintJobs({
            eventId: "event-1",
            printerId: "printer-1"
        })).resolves.toEqual({ recovered: 0 });

        expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                eventId: "event-1",
                printerId: "printer-1",
                $or: [
                    { liveClaimExpiresAt: { $lte: expect.any(Date) } },
                    expect.objectContaining({ liveClaimExpiresAt: { $exists: false } })
                ]
            }),
            expect.any(Object)
        );
    });

    test("includes stale initial live sends in the scheduler recovery count", async () => {
        mocks.printJobUpdateMany
            .mockResolvedValueOnce({ modifiedCount: 2 })
            .mockResolvedValueOnce({ modifiedCount: 1 });

        await expect(drainHeldPrintQueues(vi.fn())).resolves.toEqual({
            recovered: 3,
            sent: 0,
            held: 0,
            failed: 0
        });
    });

    test("does not convert FAILED jobs to HELD while another live sender owns the printer lease", async () => {
        mocks.printJobDistinct.mockResolvedValueOnce(["printer-kitchen"]);
        mocks.printerDistinct.mockResolvedValueOnce(["printer-kitchen"]);
        mocks.printerFindOneAndUpdate.mockReturnValueOnce(queryResult(null));

        await expect(holdFailedKitchenPrintJobs({
            eventId: "event-1",
            orderId: "order-1",
            jobIds: ["job-kitchen"]
        })).resolves.toEqual({
            held: 0,
            busyPrinterIds: ["printer-kitchen"]
        });

        expect(mocks.printJobUpdateMany).not.toHaveBeenCalled();
    });

    test("claims held jobs FIFO by creation time and id", async () => {
        mocks.printJobDistinct.mockResolvedValueOnce(["printer-1"]);
        mocks.printerFindOneAndUpdate.mockReturnValueOnce(queryResult({ _id: "printer-1" }));
        queueJobs({ _id: "job-1", eventId: "event-1" });

        await drainHeldPrintQueues(vi.fn().mockResolvedValue({ success: true }));

        expect(mocks.printJobFindOneAndUpdate).toHaveBeenNthCalledWith(
            1,
            {
                printerId: "printer-1",
                eventId: { $in: ["event-1"] },
                status: "HELD",
                source: "ORDER",
                printType: "KITCHEN_ORDER",
                queueRecoverable: true,
                heldSince: { $exists: true }
            },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: "QUEUED",
                    queueClaimToken: expect.any(String),
                    queueClaimExpiresAt: expect.any(Date)
                })
            }),
            { sort: { createdAt: 1, _id: 1 }, returnDocument: "after" }
        );
    });

    test("an active printer lease excludes a concurrent drain", async () => {
        mocks.printJobDistinct.mockResolvedValue(["printer-1"]);
        mocks.printerFindOneAndUpdate
            .mockReturnValueOnce(queryResult({ _id: "printer-1" }))
            .mockReturnValueOnce(queryResult(null));
        queueJobs({ _id: "job-1", eventId: "event-1" });
        const dispatcher = vi.fn().mockResolvedValue({ success: true });

        await Promise.all([
            drainHeldPrintQueues(dispatcher),
            drainHeldPrintQueues(dispatcher)
        ]);

        expect(mocks.printerFindOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(dispatcher).toHaveBeenCalledTimes(1);
        expect(dispatcher).toHaveBeenCalledWith("event-1", "job-1");
    });

    test("recovers only expired queue claims before looking for held work", async () => {
        mocks.printJobUpdateMany.mockResolvedValueOnce({ modifiedCount: 2 });

        await expect(drainHeldPrintQueues(vi.fn())).resolves.toEqual({
            recovered: 2,
            sent: 0,
            held: 0,
            failed: 0
        });

        expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(
            {
                eventId: { $in: ["event-1"] },
                status: "QUEUED",
                source: "ORDER",
                printType: "KITCHEN_ORDER",
                queueRecoverable: true,
                heldSince: { $exists: true },
                queueClaimToken: { $exists: true },
                queueClaimExpiresAt: { $lte: expect.any(Date) }
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
    });

    test("recovers and drains only active unarchived event queues", async () => {
        mocks.eventDistinct.mockResolvedValueOnce(["event-active"]);
        mocks.printJobDistinct.mockResolvedValueOnce(["printer-active"]);
        mocks.printerFindOneAndUpdate.mockReturnValueOnce(queryResult({ _id: "printer-active" }));
        queueJobs({ _id: "job-active", eventId: "event-active" });
        const dispatcher = vi.fn().mockResolvedValue({ success: true });

        await drainHeldPrintQueues(dispatcher);

        expect(mocks.eventDistinct).toHaveBeenCalledWith("_id", {
            active: true,
            archived: { $ne: true }
        });
        expect(mocks.printJobDistinct).toHaveBeenCalledWith("printerId", {
            eventId: { $in: ["event-active"] },
            status: "HELD",
            printerId: { $exists: true },
            source: "ORDER",
            printType: "KITCHEN_ORDER",
            queueRecoverable: true,
            heldSince: { $exists: true }
        });
        expect(mocks.printJobFindOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ eventId: { $in: ["event-active"] } }),
            expect.any(Object),
            expect.any(Object)
        );
        expect(dispatcher).toHaveBeenCalledWith("event-active", "job-active");
    });

    test("does not claim inactive or archived event queues", async () => {
        mocks.eventDistinct.mockResolvedValueOnce([]);
        const dispatcher = vi.fn();

        await drainHeldPrintQueues(dispatcher);

        expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(
            expect.objectContaining({ eventId: { $in: [] } }),
            expect.any(Object)
        );
        expect(mocks.printJobDistinct).toHaveBeenCalledWith(
            "printerId",
            expect.objectContaining({ eventId: { $in: [] } })
        );
        expect(mocks.printerFindOneAndUpdate).not.toHaveBeenCalled();
        expect(dispatcher).not.toHaveBeenCalled();
    });

    test("finalizes success, skips permanent failures, and stops on a recoverable failure", async () => {
        mocks.printJobDistinct.mockResolvedValueOnce(["printer-1"]);
        mocks.printerFindOneAndUpdate.mockReturnValueOnce(queryResult({ _id: "printer-1" }));
        queueJobs(
            { _id: "job-sent", eventId: "event-1" },
            { _id: "job-failed", eventId: "event-1" },
            { _id: "job-held", eventId: "event-1" },
            { _id: "job-newer", eventId: "event-1" }
        );
        const dispatcher = vi.fn()
            .mockResolvedValueOnce({ success: true, rawCapturePath: "/capture.bin", automaticRetryCount: 1 })
            .mockResolvedValueOnce({ success: false, recoverable: false, error: "Documento non valido" })
            .mockResolvedValueOnce({ success: false, recoverable: true, error: "Printer execution error", automaticRetryCount: 5 });

        await expect(drainHeldPrintQueues(dispatcher)).resolves.toEqual({
            recovered: 0,
            sent: 1,
            held: 1,
            failed: 1
        });

        expect(dispatcher).toHaveBeenCalledTimes(3);
        expect(mocks.printJobFindOneAndUpdate).toHaveBeenCalledTimes(3);
        expect(mocks.printJobUpdateOne).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ _id: "job-sent", status: "QUEUED", queueClaimToken: expect.any(String) }),
            expect.objectContaining({
                $set: expect.objectContaining({ status: "SENT", rawCapturePath: "/capture.bin", automaticRetryCount: 1 })
            })
        );
        expect(mocks.printJobUpdateOne).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ _id: "job-failed", status: "QUEUED", queueClaimToken: expect.any(String) }),
            expect.objectContaining({
                $set: expect.objectContaining({ status: "FAILED", errorMessage: "Documento non valido" })
            })
        );
        expect(mocks.printJobUpdateOne).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ _id: "job-held", status: "QUEUED", queueClaimToken: expect.any(String) }),
            expect.objectContaining({
                $set: expect.objectContaining({ status: "HELD", errorMessage: "Printer execution error", automaticRetryCount: 5 })
            })
        );
    });

    test("recognizes transport failures as recoverable", () => {
        expect(isRecoverablePrintFailure(Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }))).toBe(true);
        expect(isRecoverablePrintFailure("Printer execution timeout")).toBe(true);
        expect(isRecoverablePrintFailure("Documento stampa non valido")).toBe(false);
    });
});
