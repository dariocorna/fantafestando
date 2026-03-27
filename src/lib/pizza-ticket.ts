import dbConnect from "@/lib/mongoose";
import Category from "@/models/Category";
import Product from "@/models/Product";
import { getNextPizzaOrderNumber } from "@/lib/order-code";
export {
    getPizzaBarcodeValue,
    parsePizzaBarcodeValue,
    parsePizzaOrderIdValue,
    type ParsedPizzaBarcode
} from "./pizza-barcode";

const MONGO_OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

export interface PizzaCartComponentInput {
    productId: string;
    snapshotName?: string;
    quantity?: number;
}

export interface PizzaCartItemInput {
    productId: string;
    snapshotName?: string;
    quantity?: number;
    includedComponents?: PizzaCartComponentInput[];
}

export interface PizzaTicketSnapshot {
    pizzaNumber: number;
    state: "QUEUED" | "READY" | "REMOVED";
    readyAt?: Date;
}

interface PersistedPizzaTicketSource {
    pizzaNumber?: number | null;
    state?: string | null;
    readyAt?: Date | string | null;
}

export function normalizePizzaTicket(
    value?: PersistedPizzaTicketSource | null
): PizzaTicketSnapshot | undefined {
    const pizzaNumber = Number(value?.pizzaNumber);
    if (!Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return undefined;

    const state = value?.state === "READY"
        ? "READY"
        : value?.state === "REMOVED"
            ? "REMOVED"
            : "QUEUED";
    const parsedReadyAt = value?.readyAt ? new Date(value.readyAt) : null;
    const readyAt = state === "READY" && parsedReadyAt && !Number.isNaN(parsedReadyAt.getTime())
        ? parsedReadyAt
        : undefined;

    return {
        pizzaNumber,
        state,
        readyAt
    };
}

export function extractProductionProductIds(cartItems: PizzaCartItemInput[]): string[] {
    return [...new Set(
        cartItems.flatMap((item) => {
            if (Array.isArray(item.includedComponents) && item.includedComponents.length > 0) {
                return item.includedComponents
                    .map((component) => component.productId?.trim())
                    .filter((productId): productId is string => Boolean(productId));
            }

            const productId = item.productId?.trim();
            return productId ? [productId] : [];
        })
    )];
}

export async function resolvePizzaEligibleProductIds(
    eventId: string,
    cartItems: PizzaCartItemInput[]
): Promise<Set<string>> {
    const productionProductIds = extractProductionProductIds(cartItems);
    if (!MONGO_OBJECT_ID_PATTERN.test(eventId) || productionProductIds.length === 0) {
        return new Set<string>();
    }

    await dbConnect();
    const products = await Product.find({
        eventId,
        _id: { $in: productionProductIds }
    }).select("_id categoryId").lean() as Array<{
        _id: string | { toString(): string };
        categoryId?: string | { toString(): string };
    }>;

    if (products.length === 0) {
        return new Set<string>();
    }

    const pizzaCategoryIds = new Set(
        (
            await Category.find({
                eventId,
                _id: {
                    $in: [...new Set(
                        products
                            .map((product) => product.categoryId?.toString())
                            .filter((categoryId): categoryId is string => Boolean(categoryId))
                    )]
                },
                pizzaFlowEnabled: true
            }).select("_id").lean() as Array<{ _id: string | { toString(): string } }>
        ).map((category) => category._id.toString())
    );

    return new Set(
        products
            .filter((product) => {
                const categoryId = product.categoryId?.toString();
                if (!categoryId) return false;
                return pizzaCategoryIds.has(categoryId);
            })
            .map((product) => product._id.toString())
    );
}

export async function resolvePizzaTicketForCart(
    eventId: string,
    cartItems: PizzaCartItemInput[],
    existingTicket?: PersistedPizzaTicketSource | null
): Promise<PizzaTicketSnapshot | undefined> {
    const pizzaEligibleProductIds = await resolvePizzaEligibleProductIds(eventId, cartItems);
    if (pizzaEligibleProductIds.size === 0) {
        return undefined;
    }

    const normalizedExistingTicket = normalizePizzaTicket(existingTicket);
    if (normalizedExistingTicket) {
        return normalizedExistingTicket;
    }

    return {
        pizzaNumber: await getNextPizzaOrderNumber(eventId),
        state: "QUEUED"
    };
}
