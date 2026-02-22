import OrderCounter from "@/models/OrderCounter";

type OrderCodeSource = {
    pickupNumber?: number | null;
    _id?: string | { toString(): string } | null;
};

export function parseOrderNumberInput(rawCode: string): number | null {
    const normalized = rawCode.trim();
    if (!/^\d+$/.test(normalized)) return null;

    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;

    return parsed;
}

export function getOrderCodeFromOrder(order: OrderCodeSource): string {
    if (typeof order.pickupNumber === "number" && Number.isInteger(order.pickupNumber) && order.pickupNumber > 0) {
        return String(order.pickupNumber);
    }

    if (!order._id) return "";
    return order._id.toString().slice(-4).toUpperCase();
}

export async function getNextPublicOrderNumber(eventId: string): Promise<number> {
    const counter = await OrderCounter.findOneAndUpdate(
        { eventId, scope: "PUBLIC_ORDER" },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select("seq").lean();

    return counter?.seq ?? 1;
}
