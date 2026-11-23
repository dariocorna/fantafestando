const pendingSumUpCheckout = {
    status: "PENDING",
    sumupCheckoutId: { $exists: true, $nin: [null, ""] }
};

const paidSumUpOrder = {
    status: "PAID",
    $or: [
        { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
        { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
    ]
};

export function unresolvedSumUpPaymentFilter() {
    return {
        $or: [
            pendingSumUpCheckout,
            paidSumUpOrder,
            {
                status: "CANCELLED",
                sumupRecoveryCancelledAt: { $exists: true, $ne: null },
                sumupRecoveryResolvedAt: { $exists: false },
                "stornoMeta.refundStatus": { $ne: "DONE" }
            }
        ]
    };
}

export function incompleteSumUpPrintFilter() {
    return {
        $or: [
            pendingSumUpCheckout,
            { ...paidSumUpOrder, sumupPrintCompletedAt: { $exists: false } }
        ]
    };
}

export function legacySumUpRefundDependencyFilter() {
    return {
        "sumupRefundCredentials.apiKey": { $in: [null, ""] },
        "stornoMeta.refundStatus": { $ne: "DONE" },
        $or: [
            paidSumUpOrder,
            {
                status: "CANCELLED",
                sumupLateSuccessDetectedAt: { $exists: true, $ne: null }
            }
        ]
    };
}
