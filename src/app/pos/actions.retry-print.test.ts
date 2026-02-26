import { beforeEach, describe, expect, test, vi } from "vitest";

const { dbConnectMock, printJobFindMock, retryPrintJobByIdMock } = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    printJobFindMock: vi.fn(),
    retryPrintJobByIdMock: vi.fn()
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/models/PrintJob", () => ({
    default: {
        find: printJobFindMock
    }
}));

vi.mock("@/lib/printer", () => ({
    PrinterService: {
        retryPrintJobById: retryPrintJobByIdMock
    }
}));

vi.mock("@/models/Order", () => ({ default: {} }));
vi.mock("@/models/PosDevice", () => ({ default: {} }));
vi.mock("@/models/Product", () => ({ default: {} }));
vi.mock("@/models/CashSession", () => ({ default: {} }));

import { retryFailedOrderPrintJobs } from "@/app/pos/actions";

function mockFindFailedJobs(rows: Array<{ _id: string }>) {
    printJobFindMock.mockReturnValue({
        sort: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(rows)
            })
        })
    });
}

describe("retryFailedOrderPrintJobs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("returns error when event/order ids are missing", async () => {
        const result = await retryFailedOrderPrintJobs({ eventId: "", orderId: "" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toMatch(/Dati mancanti/i);
        }
    });

    test("returns success with zero attempts when there are no failed jobs", async () => {
        mockFindFailedJobs([]);

        const result = await retryFailedOrderPrintJobs({ eventId: "evt-1", orderId: "ord-1" });
        expect(dbConnectMock).toHaveBeenCalledTimes(1);
        expect(printJobFindMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            orderId: "ord-1",
            status: "FAILED"
        });
        expect(result).toEqual({
            success: true,
            attempted: 0,
            retried: 0,
            failed: 0
        });
    });

    test("counts partial retry results", async () => {
        mockFindFailedJobs([{ _id: "job-1" }, { _id: "job-2" }, { _id: "job-3" }]);
        retryPrintJobByIdMock
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: "boom" })
            .mockResolvedValueOnce({ success: true });

        const result = await retryFailedOrderPrintJobs({ eventId: "evt-1", orderId: "ord-1" });
        expect(retryPrintJobByIdMock).toHaveBeenCalledTimes(3);
        expect(retryPrintJobByIdMock).toHaveBeenNthCalledWith(1, "evt-1", "job-1");
        expect(retryPrintJobByIdMock).toHaveBeenNthCalledWith(2, "evt-1", "job-2");
        expect(retryPrintJobByIdMock).toHaveBeenNthCalledWith(3, "evt-1", "job-3");
        expect(result).toEqual({
            success: true,
            attempted: 3,
            retried: 2,
            failed: 1
        });
    });

    test("returns error when lookup throws", async () => {
        printJobFindMock.mockImplementation(() => {
            throw new Error("db unavailable");
        });

        const result = await retryFailedOrderPrintJobs({ eventId: "evt-1", orderId: "ord-1" });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toMatch(/Errore durante il reinvio/i);
        }
    });
});
