import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const {
    orderFindOneAndUpdateMock,
    orderFindOneMock,
    orderUpdateOneMock,
    applyStockForPaidOrderMock,
    rollbackStockAdjustmentsMock,
    routeOrderToPrintersMock,
    claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaimMock
} = vi.hoisted(() => ({
    orderFindOneAndUpdateMock: vi.fn(),
    orderFindOneMock: vi.fn(),
    orderUpdateOneMock: vi.fn(),
    applyStockForPaidOrderMock: vi.fn(),
    rollbackStockAdjustmentsMock: vi.fn(),
    routeOrderToPrintersMock: vi.fn(),
    claimCashSessionPaymentMock: vi.fn(),
    refreshCashSessionPaymentClaimMock: vi.fn(),
    releaseCashSessionPaymentClaimMock: vi.fn()
}));

vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }));
vi.mock("@/models/Order", () => ({
    default: {
        findOneAndUpdate: orderFindOneAndUpdateMock,
        findOne: orderFindOneMock,
        updateOne: orderUpdateOneMock
    }
}));
vi.mock("@/lib/stock-operations", () => ({
    applyStockForPaidOrder: applyStockForPaidOrderMock,
    rollbackStockAdjustments: rollbackStockAdjustmentsMock
}));
vi.mock("@/lib/printer", () => ({
    PrinterService: { routeOrderToPrinters: routeOrderToPrintersMock }
}));
vi.mock("@/lib/cash-session-payment-claim", () => ({
    claimCashSessionPayment: claimCashSessionPaymentMock,
    refreshCashSessionPaymentClaim: refreshCashSessionPaymentClaimMock,
    releaseCashSessionPaymentClaim: releaseCashSessionPaymentClaimMock
}));

import { POST } from "./route";

function webhookRequest() {
    return new NextRequest("http://localhost/api/sumup/webhook", {
        method: "POST",
        body: JSON.stringify({ event_type: "checkout.succeeded", id: "checkout-1" })
    });
}

describe("POST /api/sumup/webhook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.SUMUP_WEBHOOK_SECRET;
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "session-claim", isTest: false });
        refreshCashSessionPaymentClaimMock.mockResolvedValue(true);
    });

    test("does not process stock when another delivery owns the payment claim", async () => {
        orderFindOneAndUpdateMock.mockResolvedValue(null);
        orderFindOneMock.mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ status: "PENDING" })
            })
        });

        const response = await POST(webhookRequest());

        await expect(response.json()).resolves.toMatchObject({ message: "Payment processing" });
        expect(applyStockForPaidOrderMock).not.toHaveBeenCalled();
    });

    test("completes a claimed payment with one atomic status update", async () => {
        orderFindOneAndUpdateMock.mockResolvedValue({
            _id: "order-1",
            eventId: { toString: () => "event-1" },
            cashSessionId: { toString: () => "session-1" },
            status: "PENDING",
            cart: [],
            ingredientPlan: []
        });
        applyStockForPaidOrderMock.mockResolvedValue({ success: true, appliedAdjustments: [] });
        orderUpdateOneMock.mockResolvedValue({ acknowledged: true, matchedCount: 1 });

        const response = await POST(webhookRequest());

        expect(response.status).toBe(200);
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: "order-1",
                status: "PENDING",
                sumupWebhookClaimToken: expect.any(String)
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: "PAID",
                    paidAt: expect.any(Date),
                    stockAdjustments: [],
                    stockEffectStatus: "APPLIED"
                })
            })
        );
        expect(routeOrderToPrintersMock).toHaveBeenCalledOnce();
    });

    test("does not complete a webhook payment after its cash session closes", async () => {
        orderFindOneAndUpdateMock.mockResolvedValue({
            _id: "order-1",
            eventId: { toString: () => "event-1" },
            cashSessionId: { toString: () => "session-1" },
            status: "PENDING",
            cart: [],
            ingredientPlan: []
        });
        claimCashSessionPaymentMock.mockResolvedValue({ success: false });

        const response = await POST(webhookRequest());

        expect(response.status).toBe(409);
        expect(applyStockForPaidOrderMock).not.toHaveBeenCalled();
        expect(orderUpdateOneMock).toHaveBeenCalledWith(
            { _id: "order-1", sumupWebhookClaimToken: expect.any(String) },
            { $unset: { sumupWebhookClaimToken: 1, sumupWebhookClaimedAt: 1 } }
        );
    });

    test("releases the session claim when a delayed callback reaches a TEST session", async () => {
        orderFindOneAndUpdateMock.mockResolvedValue({
            _id: "order-1",
            eventId: { toString: () => "event-1" },
            cashSessionId: { toString: () => "session-1" },
            status: "PENDING",
            cart: [],
            ingredientPlan: []
        });
        claimCashSessionPaymentMock.mockResolvedValue({ success: true, token: "test-session-claim", isTest: true });

        const response = await POST(webhookRequest());

        expect(response.status).toBe(409);
        expect(releaseCashSessionPaymentClaimMock).toHaveBeenCalledWith("session-1", "test-session-claim");
        expect(applyStockForPaidOrderMock).not.toHaveBeenCalled();
    });
});
