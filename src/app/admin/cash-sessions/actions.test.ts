import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    ensureAdminSessionMock,
    cashSessionFindOneMock,
    cashSessionFindByIdMock,
    orderFindMock,
    posDeviceFindByIdMock,
    printCashSessionSummaryMock
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    cashSessionFindOneMock: vi.fn(),
    cashSessionFindByIdMock: vi.fn(),
    orderFindMock: vi.fn(),
    posDeviceFindByIdMock: vi.fn(),
    printCashSessionSummaryMock: vi.fn()
}));

vi.mock("@/lib/authz", () => ({ ensureAdminSession: ensureAdminSessionMock }));
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/models/CashSession", () => ({ default: { findOne: cashSessionFindOneMock, findById: cashSessionFindByIdMock } }));
vi.mock("@/models/Order", () => ({ default: { find: orderFindMock } }));
vi.mock("@/models/Product", () => ({ default: { find: vi.fn() } }));
vi.mock("@/models/PrintJob", () => ({ default: {} }));
vi.mock("@/models/PosDevice", () => ({ default: { findById: posDeviceFindByIdMock } }));
vi.mock("@/lib/printer", () => ({ PrinterService: { printCashSessionSummary: printCashSessionSummaryMock } }));
vi.mock("@/lib/print-report", () => ({ buildCashSessionPrintDocumentV2: vi.fn(() => ({ title: "CHIUSURA CASSA" })) }));
vi.mock("@/lib/product-consumption", () => ({
    aggregateOrderProductSales: vi.fn(() => ({ rows: [], discountSummaries: [], totals: {} })),
    buildProductSalesPrintRows: vi.fn(() => [])
}));

import { reprintClosedCashSessionAction } from "@/app/admin/cash-sessions/actions";

function closedSession() {
    return {
        select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue({ eventId: "event-1", posDeviceId: "pos-1" })
        })
    };
}

describe("reprintClosedCashSessionAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAdminSessionMock.mockResolvedValue({ ok: true });
        printCashSessionSummaryMock.mockResolvedValue(true);
        cashSessionFindByIdMock.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: "session-1",
                    status: "CLOSED",
                    eventId: { _id: "event-1", name: "Festa" },
                    posDeviceId: "pos-1",
                    openedAt: new Date("2026-08-07T08:00:00Z"),
                    closedAt: new Date("2026-08-07T20:00:00Z")
                })
            })
        });
        orderFindMock.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
        posDeviceFindByIdMock.mockReturnValue({
            select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ name: "Cassa 1" }) })
        });
    });

    it("refuses an unauthenticated admin without touching the printer", async () => {
        ensureAdminSessionMock.mockResolvedValue({ ok: false, error: "Non autorizzato" });

        const result = await reprintClosedCashSessionAction("session-1");

        expect(result).toEqual({ success: false, error: "Non autorizzato" });
        expect(cashSessionFindOneMock).not.toHaveBeenCalled();
        expect(printCashSessionSummaryMock).not.toHaveBeenCalled();
    });

    it("refuses a session that is not closed", async () => {
        cashSessionFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) })
        });

        const result = await reprintClosedCashSessionAction("session-1");

        expect(result).toMatchObject({ success: false });
        expect(cashSessionFindOneMock).toHaveBeenCalledWith({ _id: "session-1", status: "CLOSED" });
        expect(printCashSessionSummaryMock).not.toHaveBeenCalled();
    });

    it("reports a printer failure instead of claiming success", async () => {
        cashSessionFindOneMock.mockReturnValue(closedSession());
        printCashSessionSummaryMock.mockResolvedValue(false);

        const result = await reprintClosedCashSessionAction("session-1");

        expect(result).toMatchObject({ success: false, error: expect.stringContaining("Ristampa") });
    });

    it("dispatches the summary to the original printer of the session", async () => {
        cashSessionFindOneMock.mockReturnValue(closedSession());

        const result = await reprintClosedCashSessionAction("session-1");

        expect(result).toEqual({ success: true });
        expect(printCashSessionSummaryMock).toHaveBeenCalledWith(
            "event-1",
            "pos-1",
            expect.objectContaining({ sessionId: "session-1" }),
            expect.anything()
        );
    });
});
