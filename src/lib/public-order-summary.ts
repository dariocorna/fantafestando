export interface PublicOrderSummaryItem {
    name: string;
    quantity: number;
    selectedOptions: Array<{
        name: string;
        priceVariation: number;
    }>;
}

export interface PublicOrderSummary {
    orderId: string;
    shortCode: string;
    totalAmount: number;
    customer: {
        name?: string;
        table?: string;
    };
    items: PublicOrderSummaryItem[];
}

interface PublicOrderSummarySource {
    _id?: string | { toString(): string } | null;
    pickupNumber?: number | null;
    totalAmount: number;
    customer?: {
        name?: string;
        table?: string;
    };
    cart: Array<{
        snapshotName: string;
        quantity: number;
        selectedOptions?: Array<{
            name: string;
            priceVariation: number;
        }>;
    }>;
}

export function buildPublicOrderSummary(order: PublicOrderSummarySource): PublicOrderSummary {
    const orderId = order._id ? order._id.toString() : "";
    const shortCode = typeof order.pickupNumber === "number" && order.pickupNumber > 0
        ? String(order.pickupNumber)
        : orderId.slice(-4).toUpperCase();

    return {
        orderId,
        shortCode,
        totalAmount: order.totalAmount,
        customer: {
            name: order.customer?.name?.trim() || undefined,
            table: order.customer?.table?.trim() || undefined
        },
        items: order.cart.map((item) => ({
            name: item.snapshotName,
            quantity: item.quantity,
            selectedOptions: Array.isArray(item.selectedOptions)
                ? item.selectedOptions.map((option) => ({
                    name: option.name,
                    priceVariation: option.priceVariation
                }))
                : []
        }))
    };
}
