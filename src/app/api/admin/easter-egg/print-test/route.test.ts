import { beforeEach, describe, expect, test, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
    ensureAdminSessionMock,
    getAdminContextEventIdMock,
    dbConnectMock,
    eventFindByIdMock,
    printerFindMock,
    parseThermalRasterFormDataMock,
    printRasterImageMock
} = vi.hoisted(() => ({
    ensureAdminSessionMock: vi.fn(),
    getAdminContextEventIdMock: vi.fn(),
    dbConnectMock: vi.fn(),
    eventFindByIdMock: vi.fn(),
    printerFindMock: vi.fn(),
    parseThermalRasterFormDataMock: vi.fn(),
    printRasterImageMock: vi.fn()
}));

vi.mock("@/lib/authz", () => ({
    ensureAdminSession: ensureAdminSessionMock,
    adminUnauthorizedJson: vi.fn()
}));
vi.mock("@/lib/events", () => ({ getAdminContextEventId: getAdminContextEventIdMock }));
vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }));
vi.mock("@/models/Event", () => ({ default: { findById: eventFindByIdMock } }));
vi.mock("@/models/Printer", () => ({ default: { find: printerFindMock } }));
vi.mock("@/lib/easter-egg-raster-upload", () => ({
    parseThermalRasterFormData: parseThermalRasterFormDataMock
}));
vi.mock("@/lib/printer", () => ({
    PrinterService: { printRasterImage: printRasterImageMock }
}));

import { POST } from "./route";

const EVENT_ID = "507f1f77bcf86cd799439010";
const CASHIER_PRINTER_ID = "507f1f77bcf86cd799439011";
const SELECTED_PRINTER_ID = "507f1f77bcf86cd799439012";

function createRequest(printerId: string) {
    const formData = new FormData();
    formData.set("printerId", printerId);
    return { formData: vi.fn().mockResolvedValue(formData) } as unknown as NextRequest;
}

describe("POST /api/admin/easter-egg/print-test", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAdminSessionMock.mockResolvedValue({ ok: true });
        getAdminContextEventIdMock.mockResolvedValue(EVENT_ID);
        eventFindByIdMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ name: "Festa Test", settings: {} })
            })
        });
        printerFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue([
                        { _id: CASHIER_PRINTER_ID, ip: "10.0.0.10", port: 9100, type: "CASHIER" },
                        {
                            _id: SELECTED_PRINTER_ID,
                            ip: "10.0.0.20",
                            port: 9200,
                            isVirtual: true,
                            emulatorSlot: 2,
                            type: "KITCHEN"
                        }
                    ])
                })
            })
        });
        parseThermalRasterFormDataMock.mockResolvedValue({
            success: true,
            raster: { width: 384, height: 1, data: new Uint8Array([0]) }
        });
        printRasterImageMock.mockResolvedValue(true);
    });

    test("prints on the explicitly selected printer for the current event", async () => {
        const response = await POST(createRequest(SELECTED_PRINTER_ID));

        expect(response.status).toBe(200);
        expect(printerFindMock).toHaveBeenCalledWith({ eventId: EVENT_ID });
        expect(printRasterImageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                ip: "10.0.0.20",
                port: 9200,
                printerId: SELECTED_PRINTER_ID,
                eventId: EVENT_ID,
                isVirtual: true,
                emulatorSlot: 2,
                source: "MANUAL_TEST",
                printType: "EASTER_EGG_IMAGE"
            }),
            {
                width: 384,
                height: 1,
                data: Buffer.from([0])
            }
        );
    });

    test("rejects a printer outside the current event without printing", async () => {
        const response = await POST(createRequest("507f1f77bcf86cd799439013"));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: expect.stringMatching(/stampante selezionata non trovata/i)
        });
        expect(printRasterImageMock).not.toHaveBeenCalled();
    });
});
