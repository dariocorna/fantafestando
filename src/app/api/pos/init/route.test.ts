import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const {
    dbConnectMock,
    ensureAuthenticatedSessionMock,
    eventFindOneMock,
    categoryFindMock,
    productFindMock,
    posDeviceFindMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    ensureAuthenticatedSessionMock: vi.fn(),
    eventFindOneMock: vi.fn(),
    categoryFindMock: vi.fn(),
    productFindMock: vi.fn(),
    posDeviceFindMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/lib/authz", () => ({
    ensureAuthenticatedSession: ensureAuthenticatedSessionMock
}));

vi.mock("@/models/Event", () => ({ default: { findOne: eventFindOneMock } }));
vi.mock("@/models/Category", () => ({ default: { find: categoryFindMock } }));
vi.mock("@/models/Product", () => ({ default: { find: productFindMock } }));
vi.mock("@/models/PosDevice", () => ({ default: { find: posDeviceFindMock } }));
vi.mock("@/models/Printer", () => ({}));
vi.mock("@/models/Peripheral", () => ({}));

import { GET } from "./route";

describe("GET /api/pos/init", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("requires an authenticated session for POS channel data", async () => {
        ensureAuthenticatedSessionMock.mockResolvedValue({
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        });

        const response = await GET(new NextRequest("http://localhost/api/pos/init?channel=pos"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "Autenticazione richiesta" });
        expect(dbConnectMock).not.toHaveBeenCalled();
    });

    test("keeps menu channel public without leaking POS devices or discounts", async () => {
        eventFindOneMock.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValue({
                _id: "evt-1",
                settings: {
                    askName: true,
                    askTable: false,
                    quickDiscountPresets: [{ label: "Staff", type: "PERCENT", value: 50 }],
                    quickStaffDiscountEnabled: true,
                    quickStaffDiscountLabel: "Staff",
                    quickStaffDiscountType: "PERCENT",
                    quickStaffDiscountValue: 50
                },
                predefinedTables: []
            })
        });
        categoryFindMock.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([{ _id: "cat-1", name: "Banco" }])
            })
        });
        productFindMock.mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([{
                    _id: "prod-1",
                    name: "Pasta",
                    categoryId: "cat-1",
                    basePrice: 10,
                    volunteerPrice: 7,
                    salesChannels: ["MENU"],
                    availableDays: [],
                    stockQuantity: null,
                    isSoldOut: false
                }])
            })
        });

        const response = await GET(new NextRequest("http://localhost/api/pos/init?channel=menu"));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(ensureAuthenticatedSessionMock).not.toHaveBeenCalled();
        expect(posDeviceFindMock).not.toHaveBeenCalled();
        expect(payload.posDevices).toEqual([]);
        expect(payload.products[0]).not.toHaveProperty("volunteerPrice");
        expect(payload.event.settings).not.toHaveProperty("quickDiscountPresets");
        expect(payload.event.settings).not.toHaveProperty("quickStaffDiscountValue");
    });
});
