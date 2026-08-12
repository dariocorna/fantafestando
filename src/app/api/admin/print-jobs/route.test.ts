import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { ensureAdminSessionMock, adminUnauthorizedJsonMock, getAdminContextEventIdMock, printJobFindMock } = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    adminUnauthorizedJsonMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    printJobFindMock: vi.fn()
}));

vi.mock("@/lib/authz", () => ({
    ensureAdminSession: ensureAdminSessionMock,
    adminUnauthorizedJson: adminUnauthorizedJsonMock
}));
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }));
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }));
vi.mock("@/models/PrintJob", () => ({ default: { find: printJobFindMock } }));
vi.mock("@/models/Printer", () => ({}));

import { GET } from "./route";

describe("GET /api/admin/print-jobs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        adminUnauthorizedJsonMock.mockImplementation((sessionCheck) =>
            Response.json({ error: sessionCheck.error }, { status: sessionCheck.status })
        );
    });

    test("rejects unauthenticated requests before reading print jobs", async () => {
        ensureAdminSessionMock.mockResolvedValue({
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        });

        const response = await GET(new NextRequest("http://localhost/api/admin/print-jobs"));

        expect(response.status).toBe(401);
        expect(getAdminContextEventIdMock).not.toHaveBeenCalled();
        expect(printJobFindMock).not.toHaveBeenCalled();
    });

    test("aggregates the complete HELD queue independently from status and limit while respecting printer filter", async () => {
        ensureAdminSessionMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
        getAdminContextEventIdMock.mockResolvedValue("event-1");

        const recentRows = [{
            _id: "job-recent",
            source: "ORDER",
            printType: "KITCHEN_ORDER",
            status: "SENT",
            destinationHost: "10.0.0.10",
            destinationPort: 9100,
            isVirtual: false,
            copies: 1,
            document: {},
            createdAt: new Date("2026-08-12T08:00:00.000Z"),
            printerId: { _id: "printer-1", name: "Cucina", ip: "10.0.0.10", port: 9100, type: "KITCHEN" }
        }];
        const heldRows = [
            {
                printerId: { _id: "printer-1", name: "Cucina", ip: "10.0.0.10", port: 9100, type: "KITCHEN" },
                destinationHost: "10.0.0.10",
                destinationPort: 9100,
                heldSince: new Date("2026-08-12T07:05:00.000Z"),
                createdAt: new Date("2026-08-12T07:04:00.000Z")
            },
            {
                printerId: { _id: "printer-1", name: "Cucina", ip: "10.0.0.10", port: 9100, type: "KITCHEN" },
                destinationHost: "10.0.0.10",
                destinationPort: 9100,
                heldSince: new Date("2026-08-12T07:00:00.000Z"),
                createdAt: new Date("2026-08-12T06:59:00.000Z")
            }
        ];
        printJobFindMock
            .mockReturnValueOnce({
                sort: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(recentRows) })
                    })
                })
            })
            .mockReturnValueOnce({
                populate: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(heldRows) })
                })
            });

        const response = await GET(new NextRequest("http://localhost/api/admin/print-jobs?status=SENT&printerId=printer-1&limit=1"));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(printJobFindMock).toHaveBeenNthCalledWith(1, {
            eventId: "event-1",
            status: "SENT",
            printerId: "printer-1"
        });
        expect(printJobFindMock).toHaveBeenNthCalledWith(2, {
            eventId: "event-1",
            status: "HELD",
            printerId: "printer-1"
        });
        expect(payload.jobs).toEqual([expect.objectContaining({ id: "job-recent", status: "SENT" })]);
        expect(payload.heldQueues).toEqual([
            {
                key: "printer-1",
                printerId: "printer-1",
                name: "Cucina",
                destinationHost: "10.0.0.10",
                destinationPort: 9100,
                count: 2,
                oldestHeldAt: "2026-08-12T07:00:00.000Z"
            }
        ]);
    });

    test("orders aggregated queues deterministically after the unsorted HELD lookup", async () => {
        ensureAdminSessionMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
        getAdminContextEventIdMock.mockResolvedValue("event-1");
        const heldRows = [
            {
                printerId: { _id: "printer-2", name: "Bar" },
                destinationHost: "10.0.0.11",
                destinationPort: 9100,
                heldSince: new Date("2026-08-12T08:00:00.000Z")
            },
            {
                printerId: { _id: "printer-1", name: "Cucina" },
                destinationHost: "10.0.0.10",
                destinationPort: 9100,
                heldSince: new Date("2026-08-12T07:00:00.000Z")
            }
        ];
        printJobFindMock
            .mockReturnValueOnce({
                sort: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                        populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) })
                    })
                })
            })
            .mockReturnValueOnce({
                populate: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(heldRows) })
                })
            });

        const response = await GET(new NextRequest("http://localhost/api/admin/print-jobs"));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.heldQueues.map((queue: { key: string }) => queue.key)).toEqual([
            "printer-1",
            "printer-2"
        ]);
    });
});
