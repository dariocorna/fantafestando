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
});
