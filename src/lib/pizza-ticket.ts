import dbConnect from "@/lib/mongoose";
import Category from "@/models/Category";
import Product from "@/models/Product";
import { getNextPizzaOrderNumbers } from "@/lib/order-code";
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

export interface DishTicketSnapshot {
    productId: string;
    snapshotName: string;
    pizzaNumber: number;
    state: "QUEUED" | "READY" | "REMOVED";
    readyAt?: Date;
}

interface PersistedDishTicketSource {
    productId?: string | { toString(): string } | null;
    snapshotName?: string | null;
    pizzaNumber?: number | null;
    state?: string | null;
    readyAt?: Date | string | null;
}

export function normalizeDishTicket(
    value?: PersistedDishTicketSource | null
): DishTicketSnapshot | undefined {
    const productId = value?.productId?.toString().trim() || "";
    const pizzaNumber = Number(value?.pizzaNumber);
    if (!productId || !Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return undefined;

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
        productId,
        snapshotName: value?.snapshotName?.trim() || "Piatto",
        pizzaNumber,
        state,
        readyAt
    };
}

export function extractProductionProducts(cartItems: PizzaCartItemInput[]): Array<{
    productId: string;
    snapshotName: string;
}> {
    const products = new Map<string, string>();
    cartItems.forEach((item) => {
        const entries = Array.isArray(item.includedComponents) && item.includedComponents.length > 0
            ? item.includedComponents
            : [item];
        entries.forEach((entry) => {
            const productId = entry.productId?.trim();
            if (productId && !products.has(productId)) {
                products.set(productId, entry.snapshotName?.trim() || "Piatto");
            }
        });
    });
    return Array.from(products, ([productId, snapshotName]) => ({ productId, snapshotName }));
}

export function extractProductionProductIds(cartItems: PizzaCartItemInput[]): string[] {
    return extractProductionProducts(cartItems).map((product) => product.productId);
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

    if (products.length === 0) return new Set<string>();

    const numberedCategoryIds = new Set(
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
                return Boolean(categoryId && numberedCategoryIds.has(categoryId));
            })
            .map((product) => product._id.toString())
    );
}

export async function resolveDishTicketsForCart(
    eventId: string,
    cartItems: PizzaCartItemInput[],
    existingTickets: PersistedDishTicketSource[] = []
): Promise<DishTicketSnapshot[]> {
    const productionProducts = extractProductionProducts(cartItems);
    const eligibleProductIds = await resolvePizzaEligibleProductIds(eventId, cartItems);
    const desiredProducts = productionProducts.filter((product) => eligibleProductIds.has(product.productId));
    if (desiredProducts.length === 0) return [];

    const existingByProductId = new Map(
        existingTickets
            .map(normalizeDishTicket)
            .filter((ticket): ticket is DishTicketSnapshot => Boolean(ticket))
            .map((ticket) => [ticket.productId, ticket])
    );
    const missingProducts = desiredProducts.filter((product) => !existingByProductId.has(product.productId));
    const allocatedNumbers = await getNextPizzaOrderNumbers(eventId, missingProducts.length);
    const allocatedByProductId = new Map(
        missingProducts.map((product, index) => [product.productId, allocatedNumbers[index]])
    );

    return desiredProducts.map((product) => {
        const existing = existingByProductId.get(product.productId);
        if (existing) return existing;
        return {
            ...product,
            pizzaNumber: allocatedByProductId.get(product.productId)!,
            state: "QUEUED"
        };
    });
}
