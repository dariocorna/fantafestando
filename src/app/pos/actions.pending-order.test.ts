import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    dbConnectMock,
    orderFindOneMock,
    orderFindMock,
    productFindMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderFindMock: vi.fn(),
    productFindMock: vi.fn()
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({
    default: dbConnectMock
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

import { loadPendingOrderByCode } from "@/app/pos/actions";

const pendingOrderLookupProjection =
    "_id pickupNumber totalAmount customer cart easterEggAttachment.uploadedAt easterEggAttachment.printedAt";

describe("loadPendingOrderByCode", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        productFindMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue([
                    { _id: "prod-1", basePrice: 7 }
                ])
            })
        });
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
            pickupNumber: 15
        });
        expect(selectMock).toHaveBeenCalledWith(pendingOrderLookupProjection);
        expect(result).toEqual({
            success: true,
            order: {
                id: "order-1",
                code: "15",
                totalAmount: 7,
                customer: { name: "Mario", table: "A1" },
                easterEggAttached: true,
                items: [
                    {
                        productId: "prod-1",
                        snapshotName: "Patatine",
                        quantity: 1,
                        unitPrice: 7,
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

        expect(orderFindMock).toHaveBeenCalledWith({ eventId: "evt-1", status: "PENDING" });
        expect(sortMock).toHaveBeenCalledWith({ createdAt: -1 });
        expect(limitMock).toHaveBeenCalledWith(500);
        expect(selectMock).toHaveBeenCalledWith(pendingOrderLookupProjection);
        expect(result).toEqual({
            success: true,
            order: {
                id: "00000000000000000000ABCD",
                code: "ABCD",
                totalAmount: 5,
                customer: { name: undefined, table: undefined },
                easterEggAttached: false,
                items: [
                    {
                        productId: "prod-1",
                        snapshotName: "Patatine",
                        quantity: 1,
                        unitPrice: 7,
                        selectedOptions: [],
                        menuSelections: []
                    }
                ]
            }
        });
    });
});
