import { describe, expect, it } from "vitest";
import sift from "sift";
import {
    incompleteSumUpPrintFilter,
    legacySumUpRefundDependencyFilter,
    unresolvedSumUpPaymentFilter
} from "./sumup-order-filters";

const recovered = { status: "CANCELLED", sumupRecoveryCancelledAt: new Date() };
const paid = { status: "PAID", sumupCheckoutId: "checkout-1" };

// Expected matches are independent of the query construction: payment, print, legacy refund.
const cases: Array<[string, Record<string, unknown>, boolean[]]> = [
    ["pending manual payment", { status: "PENDING" }, [false, false, false]],
    ["pending checkout", { status: "PENDING", sumupCheckoutId: "checkout-1" }, [true, true, false]],
    ["pending payment id alone", { status: "PENDING", sumupPaymentId: "payment-1" }, [false, false, false]],
    ["paid manual card", { status: "PAID", paymentMethod: "CARD" }, [false, false, false]],
    ["paid checkout", paid, [true, true, true]],
    ["paid transaction only", { status: "PAID", sumupPaymentId: "payment-1" }, [true, true, true]],
    ["paid null ids", { status: "PAID", sumupCheckoutId: null, sumupPaymentId: null }, [false, false, false]],
    ["paid empty ids", { status: "PAID", sumupCheckoutId: "", sumupPaymentId: "" }, [false, false, false]],
    ["pending null checkout", { status: "PENDING", sumupCheckoutId: null }, [false, false, false]],
    ["pending empty checkout", { status: "PENDING", sumupCheckoutId: "" }, [false, false, false]],
    ["completed print", { ...paid, sumupPrintCompletedAt: new Date() }, [true, false, true]],
    ["null print marker is present", { ...paid, sumupPrintCompletedAt: null }, [true, false, true]],
    ["credential snapshot", { ...paid, sumupRefundCredentials: { apiKey: "encrypted:key" } }, [true, true, false]],
    ["empty credential snapshot", { ...paid, sumupRefundCredentials: { apiKey: "" } }, [true, true, true]],
    ["null credential snapshot", { ...paid, sumupRefundCredentials: { apiKey: null } }, [true, true, true]],
    ["paid remains protected after refund", { ...paid, stornoMeta: { refundStatus: "DONE" } }, [true, true, false]],
    ["ordinary cancellation", { status: "CANCELLED", sumupCheckoutId: "checkout-1" }, [false, false, false]],
    ["unresolved recovery", recovered, [true, false, false]],
    ["null recovery marker", { ...recovered, sumupRecoveryCancelledAt: null }, [false, false, false]],
    ["resolved recovery", { ...recovered, sumupRecoveryResolvedAt: new Date() }, [false, false, false]],
    ["recovery refunded", { ...recovered, stornoMeta: { refundStatus: "DONE" } }, [false, false, false]],
    ["recovery refund still pending", { ...recovered, stornoMeta: { refundStatus: "PENDING" } }, [true, false, false]],
    ["late success without transaction id", { ...recovered, sumupLateSuccessDetectedAt: new Date() }, [true, false, true]],
    ["null late success marker", { ...recovered, sumupLateSuccessDetectedAt: null }, [true, false, false]],
    ["late success refunded", { ...recovered, sumupLateSuccessDetectedAt: new Date(), stornoMeta: { refundStatus: "DONE" } }, [false, false, false]],
    ["late success with snapshot", { ...recovered, sumupLateSuccessDetectedAt: new Date(), sumupRefundCredentials: { apiKey: "encrypted:key" } }, [true, false, false]],
    ["refunded order", { ...paid, status: "CANCELLED", stornoMeta: { refundStatus: "DONE" } }, [false, false, false]]
];

describe("SumUp order filters", () => {
    it.each(cases)("classifies %s", (_name, order, expected) => {
        const matches = [unresolvedSumUpPaymentFilter(), incompleteSumUpPrintFilter(), legacySumUpRefundDependencyFilter()]
            .map((filter) => sift(filter)(order));
        expect(matches).toEqual(expected);
    });

    it("composes event and product scope without losing either OR condition", () => {
        const matches = sift({
            eventId: "event-1",
            $and: [incompleteSumUpPrintFilter()],
            $or: [{ "cart.productId": "product-1" }, { "cart.includedComponents.productId": "product-1" }]
        });
        const order = { ...paid, eventId: "event-1", cart: [{ includedComponents: [{ productId: "product-1" }] }] };
        expect(matches(order)).toBe(true);
        expect(matches({ ...order, eventId: "event-2" })).toBe(false);
        expect(matches({ ...order, cart: [{ productId: "product-2" }] })).toBe(false);
        expect(matches({ ...order, sumupPrintCompletedAt: new Date() })).toBe(false);
    });
});
