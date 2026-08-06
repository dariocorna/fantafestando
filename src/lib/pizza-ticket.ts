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
    splitPrintPerUnit?: boolean;
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

async function resolvePizzaEligibleProducts(
    eventId: string,
    cartItems: PizzaCartItemInput[]
): Promise<Map<string, { splitKitchenPrintPerUnit: boolean }>> {
    const productionProductIds = extractProductionProductIds(cartItems);
    if (!MONGO_OBJECT_ID_PATTERN.test(eventId) || productionProductIds.length === 0) {
        return new Map();
    }

    await dbConnect();
    const products = await Product.find({
        eventId,
        _id: { $in: productionProductIds }
    }).select("_id categoryId splitKitchenPrintPerUnit").lean() as Array<{
        _id: string | { toString(): string };
        categoryId?: string | { toString(): string };
        splitKitchenPrintPerUnit?: boolean;
    }>;

    if (products.length === 0) return new Map();

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

    return new Map(
        products
            .filter((product) => {
                const categoryId = product.categoryId?.toString();
                return Boolean(categoryId && numberedCategoryIds.has(categoryId));
            })
            .map((product) => [
                product._id.toString(),
                { splitKitchenPrintPerUnit: Boolean(product.splitKitchenPrintPerUnit) }
            ])
    );
}

export async function resolvePizzaEligibleProductIds(
    eventId: string,
    cartItems: PizzaCartItemInput[]
): Promise<Set<string>> {
    return new Set((await resolvePizzaEligibleProducts(eventId, cartItems)).keys());
}

export async function resolveDishTicketsForCart(
    eventId: string,
    cartItems: PizzaCartItemInput[],
    existingTickets: PersistedDishTicketSource[] = []
): Promise<DishTicketSnapshot[]> {
    const eligibleProducts = await resolvePizzaEligibleProducts(eventId, cartItems);
    const desiredByProductId = new Map<string, {
        productId: string;
        snapshotName: string;
        count: number;
        hasGroupedTicket: boolean;
    }>();

    cartItems.forEach((item) => {
        const parentQuantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
        const entries = Array.isArray(item.includedComponents) && item.includedComponents.length > 0
            ? item.includedComponents.map((component) => ({
                ...component,
                quantity: parentQuantity * Math.max(1, Math.floor(Number(component.quantity) || 1))
            }))
            : [{
                productId: item.productId,
                snapshotName: item.snapshotName,
                quantity: parentQuantity
            }];

        entries.forEach((entry) => {
            const productId = entry.productId?.trim();
            const product = productId ? eligibleProducts.get(productId) : undefined;
            if (!productId || !product) return;

            let desired = desiredByProductId.get(productId);
            if (!desired) {
                desired = {
                    productId,
                    snapshotName: entry.snapshotName?.trim() || "Piatto",
                    count: 0,
                    hasGroupedTicket: false
                };
                desiredByProductId.set(productId, desired);
            }

            const splitPerUnit = product.splitKitchenPrintPerUnit || Boolean(item.splitPrintPerUnit);
            if (splitPerUnit) {
                desired.count += Math.max(1, Math.floor(Number(entry.quantity) || 1));
            } else if (!desired.hasGroupedTicket) {
                desired.count += 1;
                desired.hasGroupedTicket = true;
            }
        });
    });

    const desiredProducts = Array.from(desiredByProductId.values());
    if (desiredProducts.length === 0) return [];

    const existingByProductId = new Map<string, DishTicketSnapshot[]>();
    existingTickets.forEach((source) => {
        const ticket = normalizeDishTicket(source);
        if (!ticket) return;
        const entries = existingByProductId.get(ticket.productId) || [];
        entries.push(ticket);
        existingByProductId.set(ticket.productId, entries);
    });

    const missingCount = desiredProducts.reduce((count, product) => (
        count + Math.max(0, product.count - (existingByProductId.get(product.productId)?.length || 0))
    ), 0);
    const allocatedNumbers = await getNextPizzaOrderNumbers(eventId, missingCount);
    let allocatedIndex = 0;

    return desiredProducts.flatMap((product) => {
        const retained = (existingByProductId.get(product.productId) || []).slice(0, product.count);
        const created = Array.from({ length: product.count - retained.length }, () => ({
            productId: product.productId,
            snapshotName: product.snapshotName,
            pizzaNumber: allocatedNumbers[allocatedIndex++]!,
            state: "QUEUED" as const
        }));
        return [...retained, ...created];
    });
}
