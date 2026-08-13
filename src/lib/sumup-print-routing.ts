import Order from "@/models/Order";
import PrintJob from "@/models/PrintJob";

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

export async function completeSumUpPrintIntentsIfSent(eventId: string, orderId: string) {
    if (!eventId || !orderId) return false;

    const scopedIntent = {
        eventId,
        orderId,
        source: "ORDER",
        idempotencyKey: /^SUMUP_CALLBACK:/
    };
    if (!await PrintJob.exists({ ...scopedIntent, status: "SENT" })) return false;

    const incompleteIntent = await PrintJob.exists({
        ...scopedIntent,
        status: { $ne: "SENT" }
    });
    if (incompleteIntent) return false;

    const completed = await Order.updateOne(
        {
            _id: orderId,
            eventId,
            status: "PAID",
            sumupPrintCompletedAt: { $exists: false },
            $or: [
                { sumupCheckoutId: { $exists: true, $nin: [null, ""] } },
                { sumupPaymentId: { $exists: true, $nin: [null, ""] } }
            ]
        },
        { $set: { sumupPrintCompletedAt: new Date() } }
    );
    return (completed.matchedCount ?? completed.modifiedCount) === 1;
}

export async function completeSumUpPrintIntentsForSentJob(eventId: string, jobId: string) {
    if (!eventId || !jobId) return false;

    const job = await PrintJob.findOne({
        _id: jobId,
        eventId,
        status: "SENT",
        source: "ORDER",
        idempotencyKey: /^SUMUP_CALLBACK:/
    }).select("orderId").lean() as { orderId?: unknown } | null;

    return job?.orderId
        ? completeSumUpPrintIntentsIfSent(eventId, String(job.orderId))
        : false;
}
