import OrderCounter from "@/models/OrderCounter";

export type OrderCounterScope = "PUBLIC_ORDER" | "PIZZA_ORDER";

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

async function getNextScopedOrderNumber(eventId: string, scope: OrderCounterScope): Promise<number> {
    const counter = await OrderCounter.findOneAndUpdate(
        { eventId, scope },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    ).select("seq").lean();

    return counter?.seq ?? 1;
}

export async function getNextPublicOrderNumber(eventId: string): Promise<number> {
    return getNextScopedOrderNumber(eventId, "PUBLIC_ORDER");
}

export async function getNextPizzaOrderNumber(eventId: string): Promise<number> {
    return getNextScopedOrderNumber(eventId, "PIZZA_ORDER");
}
