import sift from "sift";

const mocks = vi.hoisted(() => ({
    dbConnect: vi.fn(),
    printJobDistinct: vi.fn(),
    printJobFind: vi.fn(),
    printJobFindOne: vi.fn(),
    printJobExists: vi.fn(),
    printJobUpdateMany: vi.fn(),
    printJobFindOneAndUpdate: vi.fn(),
    printJobUpdateOne: vi.fn(),
    eventDistinct: vi.fn(),
    printerDistinct: vi.fn(),
    printerFindOneAndUpdate: vi.fn(),
    printerUpdateOne: vi.fn(),
    orderUpdateOne: vi.fn(),
    completeSumUpPrintIntentsForSentJob: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({ default: mocks.dbConnect }));
vi.mock("@/models/PrintJob", () => ({
    default: {
        distinct: mocks.printJobDistinct,
        find: mocks.printJobFind,
        findOne: mocks.printJobFindOne,
        exists: mocks.printJobExists,
        updateMany: mocks.printJobUpdateMany,
        findOneAndUpdate: mocks.printJobFindOneAndUpdate,
        updateOne: mocks.printJobUpdateOne
    }
}));
vi.mock("@/models/Order", () => ({ default: { updateOne: mocks.orderUpdateOne } }));
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
vi.mock("@/lib/sumup-print-routing", () => ({
    completeSumUpPrintIntentsForSentJob: mocks.completeSumUpPrintIntentsForSentJob
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
        mocks.printJobFind.mockReturnValue(queryResult([]));
        mocks.printJobFindOneAndUpdate.mockReturnValue(queryResult(null));
        mocks.printJobUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        mocks.eventDistinct.mockImplementation(async (_field, query) => query.active === true ? ["event-1"] : []);
        mocks.printerDistinct.mockResolvedValue([]);
        mocks.printerFindOneAndUpdate.mockReturnValue(queryResult(null));
        mocks.printerUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        mocks.completeSumUpPrintIntentsForSentJob.mockResolvedValue(false);
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
                $set: { status: "FAILED", errorMessage: "Reinvio interrotto: verifica la stampa prima di riprovare" },
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
                $or: expect.arrayContaining([{ eventId: { $in: ["event-1"] } }]),
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
                $or: expect.arrayContaining([{ eventId: { $in: ["event-1"] } }]),
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

    test("drains inactive SumUp queues without resuming inactive manual or archived jobs", async () => {
        const events = [
            { _id: "active", active: true, archived: false },
            { _id: "inactive", active: false, archived: false },
            { _id: "archived", active: true, archived: true },
            { _id: "inactive-archived", active: false, archived: true }
        ];
        const cases = [
            ["active-manual", "active", false, "HELD"],
            ["inactive-sumup", "inactive", true, "HELD"],
            ["inactive-sumup-stale", "inactive", true, "QUEUED"],
            ["inactive-manual", "inactive", false, "HELD"],
            ["inactive-manual-stale", "inactive", false, "QUEUED"],
            ["archived-sumup", "archived", true, "HELD"],
            ["archived-sumup-stale", "archived", true, "QUEUED"],
            ["inactive-archived-sumup", "inactive-archived", true, "HELD"],
            ["active-live", "active", false, "QUEUED", true],
            ["inactive-sumup-live", "inactive", true, "QUEUED", true],
            ["inactive-manual-live", "inactive", false, "QUEUED", true],
            ["inactive-archived-live", "inactive-archived", true, "QUEUED", true]
        ] as const;
        const jobs: Record<string, unknown>[] = cases.map(([_id, eventId, sumup, status, live = false], index) => ({
            _id, eventId, status, printerId: "printer-1", source: "ORDER", printType: "KITCHEN_ORDER",
            queueRecoverable: true, createdAt: new Date(index),
            ...(live ? { liveClaimExpiresAt: new Date(0) } : { heldSince: new Date(0) }),
            ...(sumup ? { idempotencyKey: `SUMUP_CALLBACK:${_id}` } : {}),
            ...(status === "QUEUED" && !live ? { queueClaimToken: "expired", queueClaimExpiresAt: new Date(0) } : {})
        }));
        function applyUpdate(job: Record<string, unknown>, update: { $set?: object; $unset?: object }) {
            Object.assign(job, update.$set);
            for (const key of Object.keys(update.$unset || {})) delete job[key];
        }
        mocks.eventDistinct.mockImplementation(async (_field, query) => events.filter(sift(query)).map((event) => event._id));
        mocks.printJobDistinct.mockImplementation(async (field, query) => [...new Set(jobs.filter(sift(query)).map((job) => job[field]))]);
        mocks.printJobUpdateMany.mockImplementation(async (query, update) => {
            const matched = jobs.filter(sift(query));
            matched.forEach((job) => applyUpdate(job, update));
            return { modifiedCount: matched.length };
        });
        mocks.printerFindOneAndUpdate.mockReturnValue(queryResult({ _id: "printer-1" }));
        mocks.printJobFindOneAndUpdate.mockImplementation((query, update) => {
            const job = jobs.find(sift(query));
            if (job) applyUpdate(job, update);
            return queryResult(job || null);
        });
        mocks.printJobUpdateOne.mockImplementation(async (query, update) => {
            const job = jobs.find(sift(query));
            if (job) applyUpdate(job, update);
            return { matchedCount: job ? 1 : 0 };
        });
        const dispatcher = vi.fn().mockResolvedValue({ success: true });

        await expect(drainHeldPrintQueues(dispatcher)).resolves.toEqual({ recovered: 3, sent: 3, held: 0, failed: 0 });

        expect(dispatcher.mock.calls).toEqual([
            ["active", "active-manual"],
            ["inactive", "inactive-sumup"],
            ["inactive", "inactive-sumup-stale"]
        ]);
        expect(jobs.map((job) => job.status)).toEqual([
            "SENT", "SENT", "SENT", "HELD", "QUEUED", "HELD", "QUEUED", "HELD",
            "FAILED", "FAILED", "QUEUED", "QUEUED"
        ]);
        expect(mocks.completeSumUpPrintIntentsForSentJob).toHaveBeenCalledTimes(2);
        expect(mocks.completeSumUpPrintIntentsForSentJob).toHaveBeenCalledWith("inactive", "inactive-sumup-stale");
    });

    test.each([
        [true, "HELD"], [false, "HELD"],
        [true, "CUSTOMER_ORDER"], [false, "CUSTOMER_ORDER"],
        [true, "EASTER_EGG_IMAGE"], [false, "EASTER_EGG_IMAGE"]
    ])("reconciles sent SumUp metadata without reprinting (active=%s, origin=%s)", async (active, origin) => {
        const fromQueue = origin === "HELD";
        const event = { _id: "event-1", active, archived: false };
        const job: Record<string, unknown> = {
            _id: "job-1", eventId: "event-1", orderId: "order-1", printerId: "printer-1",
            status: fromQueue ? "HELD" : "SENT", source: "ORDER",
            printType: fromQueue ? "KITCHEN_ORDER" : origin, queueRecoverable: fromQueue,
            ...(fromQueue ? { heldSince: new Date(0) } : { retryClaimedAt: new Date() }),
            idempotencyKey: "SUMUP_CALLBACK:order-1:print"
        };
        const order: Record<string, unknown> = {
            _id: "order-1", eventId: "event-1", status: "PAID", sumupCheckoutId: "checkout-1"
        };
        const applyUpdate = (record: Record<string, unknown>, update: { $set?: object; $unset?: object }) => {
            Object.assign(record, update.$set);
            for (const key of Object.keys(update.$unset || {})) delete record[key];
        };
        mocks.eventDistinct.mockImplementation(async (_field, query) => [event].filter(sift(query)).map(({ _id }) => _id));
        mocks.printJobDistinct.mockImplementation(async (field, query) => [job].filter(sift(query)).map((entry) => entry[field]));
        mocks.printJobFind.mockImplementation((query) => queryResult([job].filter(sift(query)).map((entry) => ({ ...entry }))));
        mocks.printJobFindOne.mockImplementation((query) => queryResult(sift(query)(job) ? job : null));
        mocks.printJobExists.mockImplementation(async (query) => sift(query)(job) ? { _id: job._id } : null);
        mocks.printerFindOneAndUpdate.mockReturnValue(queryResult({ _id: "printer-1" }));
        mocks.printJobFindOneAndUpdate.mockImplementation((query, update) => {
            if (!sift(query)(job)) return queryResult(null);
            applyUpdate(job, update);
            return queryResult({ ...job });
        });
        mocks.printJobUpdateOne.mockImplementation(async (query, update) => {
            const matched = sift(query)(job);
            if (matched) applyUpdate(job, update);
            return { matchedCount: matched ? 1 : 0 };
        });
        mocks.orderUpdateOne.mockRejectedValueOnce(new Error("completion database failure"));
        mocks.orderUpdateOne.mockImplementation(async (query, update) => {
            const matched = sift(query)(order);
            if (matched) applyUpdate(order, update);
            return { matchedCount: matched ? 1 : 0 };
        });
        const actual = await vi.importActual<typeof import("@/lib/sumup-print-routing")>("@/lib/sumup-print-routing");
        mocks.completeSumUpPrintIntentsForSentJob.mockImplementation(actual.completeSumUpPrintIntentsForSentJob);
        const dispatcher = vi.fn().mockResolvedValue({ success: true });

        await expect(drainHeldPrintQueues(dispatcher)).rejects.toThrow("completion database failure");
        expect(job.status).toBe("SENT");
        expect(fromQueue ? job.queueClaimToken : job.retryClaimedAt).toBeDefined();
        expect(order.sumupPrintCompletedAt).toBeUndefined();

        await Promise.all([drainHeldPrintQueues(dispatcher), drainHeldPrintQueues(dispatcher)]);
        expect(order.sumupPrintCompletedAt).toBeInstanceOf(Date);
        expect(job.status).toBe("SENT");
        expect(job.queueClaimToken).toBeUndefined();
        expect(job.retryClaimedAt).toBeUndefined();
        expect(job.queueClaimExpiresAt).toBeUndefined();
        expect(dispatcher).toHaveBeenCalledTimes(fromQueue ? 1 : 0);

        const completions = mocks.completeSumUpPrintIntentsForSentJob.mock.calls.length;
        await drainHeldPrintQueues(dispatcher);
        expect(mocks.completeSumUpPrintIntentsForSentJob).toHaveBeenCalledTimes(completions);
        expect(dispatcher).toHaveBeenCalledTimes(fromQueue ? 1 : 0);
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
        expect(mocks.completeSumUpPrintIntentsForSentJob).not.toHaveBeenCalled();
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
