import Order from "@/models/Order";

export async function hasPendingSumUpPrintRouting(eventId: string, productIds: string[]) {
    const normalizedProductIds = productIds.map((id) => id.trim()).filter(Boolean);
    if (!eventId || normalizedProductIds.length === 0) return false;

    return Boolean(await Order.exists({
        eventId,
        $and: [{
            $or: [
                {
                    status: "PENDING",
                    sumupCheckoutId: { $exists: true, $nin: [null, ""] }
                },
                {
                    status: "PAID",
                    sumupPrintCompletedAt: { $exists: false },
                    $or: [
                        { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                        { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
                    ]
                }
            ]
        }],
        $or: [
            { "cart.productId": { $in: normalizedProductIds } },
            { "cart.includedComponents.productId": { $in: normalizedProductIds } }
        ]
    }));
}
