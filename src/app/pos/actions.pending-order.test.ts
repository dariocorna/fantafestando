import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    dbConnectMock,
    orderFindOneMock,
    orderFindMock,
    productFindMock,
    ensureAuthenticatedSessionMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderFindMock: vi.fn(),
    productFindMock: vi.fn(),
    ensureAuthenticatedSessionMock: vi.fn()
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
}));

vi.mock("@/lib/pos-access", () => ({
    ensurePosAccess: ensureAuthenticatedSessionMock
}));

vi.mock("@/models/Order", () => ({
    default: {
        findOne: orderFindOneMock,
        find: orderFindMock
    }
}));

vi.mock("@/models/Product", () => ({
    default: {
        find: productFindMock
    }
}));

vi.mock("@/models/PosDevice", () => ({ default: {} }));
vi.mock("@/models/CashSession", () => ({ default: {} }));
vi.mock("@/models/PrintJob", () => ({ default: {} }));
vi.mock("@/lib/printer", () => ({ PrinterService: {} }));
vi.mock("@/lib/sumup", () => ({ createSumUpCheckout: vi.fn() }));
vi.mock("@/lib/secrets", () => ({ decryptSecret: vi.fn() }));

import { listRecentPendingOrders, loadPendingOrderByCode } from "@/app/pos/actions";
import { shouldReusePendingIngredientPlan } from "@/lib/pending-ingredient-plan";

const pendingOrderLookupProjection =
    "_id pickupNumber totalAmount customer pricingMode cart easterEggAttachment.uploadedAt easterEggAttachment.printedAt";

describe("loadPendingOrderByCode", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ensureAuthenticatedSessionMock.mockResolvedValue({
            ok: true,
            user: { id: "user-1", username: "cashier", role: "CASHIER" }
        });
        productFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { _id: "prod-1", basePrice: 7 }
                ])
            })
        });
    });

    test("rejects unauthenticated lookup before reading pending orders", async () => {
        ensureAuthenticatedSessionMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            error: "Autenticazione richiesta"
        });

        const result = await loadPendingOrderByCode({ eventId: "evt-1", code: "15" });

        expect(result).toEqual({ success: false, error: "Autenticazione richiesta" });
        expect(dbConnectMock).not.toHaveBeenCalled();
        expect(orderFindOneMock).not.toHaveBeenCalled();
    });

    test("uses a lightweight projection for numeric pickup code lookup", async () => {
        const leanMock = vi.fn().mockResolvedValue({
            _id: "order-1",
            pickupNumber: 15,
            totalAmount: 7,
            customer: { name: "Mario", table: "A1" },
            easterEggAttachment: {
                uploadedAt: new Date("2026-03-15T10:00:00.000Z")
            },
            cart: [
                { productId: "prod-1", snapshotName: "Patatine", quantity: 1 }
            ]
        });
        const selectMock = vi.fn().mockReturnValue({ lean: leanMock });
        orderFindOneMock.mockReturnValue({ select: selectMock });

        const result = await loadPendingOrderByCode({ eventId: "evt-1", code: "15" });

        expect(dbConnectMock).toHaveBeenCalledTimes(1);
        expect(orderFindOneMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            status: "PENDING",
            $nor: [
                { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
            ],
            pickupNumber: 15
        });
        expect(selectMock).toHaveBeenCalledWith(pendingOrderLookupProjection);
        expect(result).toEqual({
            success: true,
            order: {
                id: "order-1",
                code: "15",
                totalAmount: 7,
                pricingMode: "STANDARD",
                customer: { name: "Mario", table: "A1" },
                easterEggAttached: true,
                items: [
                    {
                        productId: "prod-1",
                        snapshotName: "Patatine",
                        customKitchenNotes: undefined,
                        splitPrintPerUnit: false,
                        quantity: 1,
                        unitPrice: 7,
                        volunteerPrice: undefined,
                        selectedOptions: [],
                        menuSelections: []
                    }
                ]
            }
        });
    });

    test("legacy fallback excludes raster blobs and infers attachment from timestamps", async () => {
        orderFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        });

        const leanMock = vi.fn().mockResolvedValue([
            {
                _id: { toString: () => "00000000000000000000ABCD" },
                totalAmount: 5,
                easterEggAttachment: {
                    uploadedAt: new Date("2026-03-15T10:00:00.000Z"),
                    printedAt: new Date("2026-03-15T10:05:00.000Z")
                },
                cart: [
                    { productId: "prod-1", snapshotName: "Patatine", quantity: 1 }
                ]
            }
        ]);
        const selectMock = vi.fn().mockReturnValue({ lean: leanMock });
        const limitMock = vi.fn().mockReturnValue({ select: selectMock });
        const sortMock = vi.fn().mockReturnValue({ limit: limitMock });
        orderFindMock.mockReturnValue({ sort: sortMock });

        const result = await loadPendingOrderByCode({ eventId: "evt-1", code: "ABCD" });

        expect(orderFindMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            status: "PENDING",
            $nor: [
                { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
            ]
        });
        expect(sortMock).toHaveBeenCalledWith({ createdAt: -1 });
        expect(limitMock).toHaveBeenCalledWith(500);
        expect(selectMock).toHaveBeenCalledWith(pendingOrderLookupProjection);
        expect(result).toEqual({
            success: true,
            order: {
                id: "00000000000000000000ABCD",
                code: "ABCD",
                totalAmount: 5,
                pricingMode: "STANDARD",
                customer: { name: undefined, table: undefined },
                easterEggAttached: false,
                items: [
                    {
                        productId: "prod-1",
                        snapshotName: "Patatine",
                        customKitchenNotes: undefined,
                        splitPrintPerUnit: false,
                        quantity: 1,
                        unitPrice: 7,
                        volunteerPrice: undefined,
                        selectedOptions: [],
                        menuSelections: []
                    }
                ]
            }
        });
    });

    test("returns volunteer mode and persisted volunteer unit price for pending POS orders", async () => {
        const leanMock = vi.fn().mockResolvedValue({
            _id: "order-1",
            pickupNumber: 16,
            totalAmount: 14,
            pricingMode: "VOLUNTEER",
            cart: [
                {
                    productId: "prod-1",
                    snapshotName: "Patatine",
                    quantity: 2,
                    unitBasePrice: 10,
                    lineTotal: 14
                }
            ]
        });
        const selectMock = vi.fn().mockReturnValue({ lean: leanMock });
        orderFindOneMock.mockReturnValue({ select: selectMock });

        const result = await loadPendingOrderByCode({ eventId: "evt-1", code: "16" });

        expect(result).toEqual({
            success: true,
            order: {
                id: "order-1",
                code: "16",
                totalAmount: 14,
                pricingMode: "VOLUNTEER",
                customer: { name: undefined, table: undefined },
                easterEggAttached: false,
                items: [
                    {
                        productId: "prod-1",
                        snapshotName: "Patatine",
                        customKitchenNotes: undefined,
                        splitPrintPerUnit: false,
                        quantity: 2,
                        unitPrice: 10,
                        volunteerPrice: 7,
                        selectedOptions: [],
                        menuSelections: []
                    }
                ]
            }
        });
    });

    test("excludes SumUp checkouts from the recent manual-payment list", async () => {
        const leanMock = vi.fn().mockResolvedValue([]);
        const selectMock = vi.fn().mockReturnValue({ lean: leanMock });
        const limitMock = vi.fn().mockReturnValue({ select: selectMock });
        const sortMock = vi.fn().mockReturnValue({ limit: limitMock });
        orderFindMock.mockReturnValue({ sort: sortMock });

        const result = await listRecentPendingOrders({ eventId: "evt-1" });

        expect(result).toEqual({ success: true, orders: [] });
        expect(orderFindMock).toHaveBeenCalledWith({
            eventId: "evt-1",
            status: "PENDING",
            $nor: [
                { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
            ]
        });
    });
});

describe("shouldReusePendingIngredientPlan", () => {
    test("reuses the persisted plan when only selected option pricing differs", () => {
        expect(shouldReusePendingIngredientPlan(
            [{
                productId: "prod-1",
                snapshotName: "Burger",
                quantity: 1,
                menuSelections: []
            }],
            [{
                productId: "prod-1",
                snapshotName: "Burger",
                quantity: 1,
                menuSelections: []
            }]
        )).toBe(true);
    });

    test("does not reuse the persisted plan when menu selections changed", () => {
        expect(shouldReusePendingIngredientPlan(
            [{
                productId: "menu-1",
                snapshotName: "Menu",
                quantity: 1,
                menuSelections: [{ groupId: "side", productId: "prod-fries" }]
            }],
            [{
                productId: "menu-1",
                snapshotName: "Menu",
                quantity: 1,
                menuSelections: [{ groupId: "side", productId: "prod-salad" }]
            }]
        )).toBe(false);
    });
});
