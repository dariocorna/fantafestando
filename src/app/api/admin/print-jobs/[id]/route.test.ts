import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    ensureAdminSession: vi.fn(),
    adminUnauthorizedJson: vi.fn(),
    getAdminContextEventId: vi.fn(),
    dbConnect: vi.fn(),
    printJobFindOne: vi.fn(),
    retryPrintJobById: vi.fn()
}));

vi.mock("@/lib/authz", () => ({
    ensureAdminSession: mocks.ensureAdminSession,
    adminUnauthorizedJson: mocks.adminUnauthorizedJson
}));
vi.mock("@/lib/events", () => ({ getAdminContextEventId: mocks.getAdminContextEventId }));
vi.mock("@/lib/mongoose", () => ({ default: mocks.dbConnect }));
vi.mock("@/models/PrintJob", () => ({ default: { findOne: mocks.printJobFindOne } }));
vi.mock("@/models/Printer", () => ({}));
vi.mock("@/lib/printer", () => ({
    PrinterService: { retryPrintJobById: mocks.retryPrintJobById }
}));

import { GET } from "./route";

describe("GET /api/admin/print-jobs/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ensureAdminSession.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
        mocks.getAdminContextEventId.mockResolvedValue("event-1");
        mocks.dbConnect.mockResolvedValue(undefined);
    });

    test("returns HELD as a valid detail status", async () => {
        mocks.printJobFindOne.mockReturnValue({
            populate: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    _id: "job-1",
                    source: "ORDER",
                    printType: "KITCHEN_ORDER",
                    status: "HELD",
                    destinationHost: "10.0.0.10",
                    destinationPort: 9100,
                    isVirtual: false,
                    copies: 1,
                    document: {},
                    heldSince: new Date("2026-08-12T07:00:00.000Z"),
                    createdAt: new Date("2026-08-12T06:59:00.000Z")
                })
            })
        });

        const response = await GET(
            new NextRequest("http://localhost/api/admin/print-jobs/job-1"),
            { params: Promise.resolve({ id: "job-1" }) }
        );
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.job).toEqual(expect.objectContaining({
            id: "job-1",
            status: "HELD",
            printType: "KITCHEN_ORDER"
        }));
    });
});
