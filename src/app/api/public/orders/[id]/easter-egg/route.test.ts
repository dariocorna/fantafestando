import { beforeEach, describe, expect, test, vi } from "vitest";
const {
    dbConnectMock,
    orderFindByIdMock,
    orderUpdateOneMock
} = vi.hoisted(() => ({
    dbConnectMock: vi.fn(),
    orderFindByIdMock: vi.fn(),
    orderUpdateOneMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({ default: dbConnectMock }));
vi.mock("@/models/Order", () => ({
    default: {
        findById: orderFindByIdMock,
        updateOne: orderUpdateOneMock
    }
}));

import { POST } from "@/app/api/public/orders/[id]/easter-egg/route";
import { getThermalContentWidth } from "@/lib/easter-egg-config";
import { hashEasterEggUploadToken } from "@/lib/easter-egg-order";
import type { NextRequest } from "next/server";

function createRasterRequest(token: string) {
    const rasterWidth = getThermalContentWidth();
    const formData = new FormData();
    formData.set("token", token);
    formData.set("rasterWidth", String(rasterWidth));
    formData.set("rasterHeight", "10");
    formData.set(
        "rasterBits",
        new File([new Uint8Array((rasterWidth / 8) * 10)], "raster.bin", { type: "application/octet-stream" })
    );

    return {
        formData: vi.fn().mockResolvedValue(formData)
    } as unknown as NextRequest;
}

describe("POST /api/public/orders/[id]/easter-egg", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("rejects invalid upload tokens", async () => {
        orderFindByIdMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    status: "PENDING",
                    easterEggAttachment: {
                        uploadTokenHash: hashEasterEggUploadToken("correct-token")
                    }
                })
            })
        });

        const response = await POST(createRasterRequest("wrong-token") as never, {
            params: Promise.resolve({ id: "order-1" })
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            error: expect.stringMatching(/Token upload non valido/i)
        });
        expect(orderUpdateOneMock).not.toHaveBeenCalled();
    });

    test("stores the packed raster on pending orders", async () => {
        orderFindByIdMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({
                    status: "PENDING",
                    easterEggAttachment: {
                        uploadTokenHash: hashEasterEggUploadToken("good-token")
                    }
                })
            })
        });
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true });

        const response = await POST(createRasterRequest("good-token") as never, {
            params: Promise.resolve({ id: "order-1" })
        });

        expect(response.status).toBe(200);
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: "order-1", status: "PENDING" },
            {
                $set: expect.objectContaining({
                    "easterEggAttachment.rasterWidth": getThermalContentWidth(),
                    "easterEggAttachment.rasterHeight": 10,
                    "easterEggAttachment.rasterData": expect.any(Buffer),
                    "easterEggAttachment.uploadedAt": expect.any(Date)
                })
            }
        );
    });
});
