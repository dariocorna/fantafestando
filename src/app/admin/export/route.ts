import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz";
import { getAdminContextEvent } from "@/lib/events";
import Order from "@/models/Order";
import Product from "@/models/Product";
import Category from "@/models/Category";
import CashSession from "@/models/CashSession";
import type { IEvent } from "@/models/Event";
import {
    buildDashboardCsvContent,
    computeDashboardStats,
    type DashboardOrderInput,
    type DashboardProductInput
} from "@/lib/dashboard-stats";
import { aggregateOrderProductSales } from "@/lib/product-consumption";
import { buildEventWorkbook } from "@/lib/excel-report";

export const dynamic = "force-dynamic";

interface OrderProjection {
    _id: unknown
    status?: string
    createdAt?: Date | string
    totalAmount?: number
    discountApplied?: number
    discountMeta?: {
        type?: string
        label?: string
        value?: number
    }
    discountComponents?: Array<{
        scope?: string
        type?: string
        label?: string
        value?: number
        baseAmount?: number
        appliedAmount?: number
        productId?: string | { toString(): string }
    }>
    pricingMode?: string
    paymentMethod?: string
    cart?: Array<{
        productId?: string | { toString(): string }
        snapshotName?: string
        quantity?: number
        selectedOptions?: Array<{ priceVariation?: number }>
        discountApplied?: number
        discountMeta?: {
            type?: string
            label?: string
            value?: number
        }
        lineTotal?: number
    }>
}

interface ProductProjection {
    _id: unknown
    name: string
    shortName?: string
    basePrice?: number
    categoryId?: unknown
}

interface CategoryProjection {
    _id: unknown
    name?: string
    printOrder?: number
}

function sanitizeFileNameSegment(value: string): string {
    const normalized = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return normalized || "evento";
}

function getTimestampTag(value: Date): string {
    const yyyy = value.getFullYear();
    const mm = `${value.getMonth() + 1}`.padStart(2, "0");
    const dd = `${value.getDate()}`.padStart(2, "0");
    const hh = `${value.getHours()}`.padStart(2, "0");
    const min = `${value.getMinutes()}`.padStart(2, "0");
    return `${yyyy}${mm}${dd}-${hh}${min}`;
}

export async function GET(request: NextRequest) {
    try {
        const sessionCheck = await ensureAdminSession();
        if (!sessionCheck.ok) {
            return adminUnauthorizedJson(sessionCheck);
        }

        const format = request.nextUrl.searchParams.get("format")?.trim().toLowerCase() || "csv";
        if (!["csv", "xls", "xlsx"].includes(format)) {
            return NextResponse.json(
                { error: "Formato export non supportato. Usa format=csv oppure format=xlsx." },
                { status: 400 }
            );
        }

        const contextEvent = await getAdminContextEvent() as IEvent | null;
        if (!contextEvent) {
            return NextResponse.json(
                { error: "Nessuna festa attiva o selezionata" },
                { status: 400 }
            );
        }

        const eventId = String(contextEvent._id);

        await dbConnect();
        const excludedSessionIds = (await CashSession.find({ eventId, isTest: true }).select("_id").lean() as Array<{ _id: unknown }>).map((session) => session._id);
        const [orders, products, categories] = await Promise.all([
            Order.find({ eventId, status: "PAID", cashSessionId: { $nin: excludedSessionIds } })
                .sort({ createdAt: -1 })
                .select("_id status createdAt totalAmount discountApplied discountMeta discountComponents pricingMode paymentMethod cart")
                .lean() as Promise<OrderProjection[]>,
            Product.find({ eventId })
                .select("_id name shortName basePrice categoryId")
                .lean() as Promise<ProductProjection[]>,
            Category.find({ eventId })
                .select("_id name printOrder")
                .lean() as Promise<CategoryProjection[]>
        ]);

        const dashboardOrders: DashboardOrderInput[] = orders.map((order) => ({
            id: String(order._id),
            status: order.status || "PAID",
            createdAt: order.createdAt || null,
            totalAmount: order.totalAmount ?? 0,
            paymentMethod: order.paymentMethod || "OTHER",
            cart: Array.isArray(order.cart)
                ? order.cart.map((item) => ({
                    productId: item.productId ? String(item.productId) : null,
                    snapshotName: item.snapshotName || null,
                    quantity: item.quantity ?? 0
                }))
                : []
        }));

        const dashboardProducts: DashboardProductInput[] = products.map((product) => ({
            id: String(product._id),
            name: product.name
        }));

        const stats = computeDashboardStats({
            orders: dashboardOrders,
            products: dashboardProducts,
            bestSellerLimit: 100,
            underperformingLimit: 100,
            underperformingThreshold: 1
        });
        const categoryById = new Map(categories.map((category) => [String(category._id), category]));
        const catalogByProductId = new Map(products.map((product) => {
            const category = product.categoryId ? categoryById.get(String(product.categoryId)) : undefined;
            return [String(product._id), {
                name: product.name,
                shortName: product.shortName,
                basePrice: product.basePrice,
                categoryName: category?.name,
                categoryOrder: category?.printOrder
            }];
        }));
        const salesBreakdown = aggregateOrderProductSales({
            orders,
            catalogByProductId
        });

        const isExcel = format === "xls" || format === "xlsx";
        const content = isExcel
            ? await buildEventWorkbook({ eventName: contextEvent.name, stats, sales: salesBreakdown })
            : buildDashboardCsvContent(stats, { eventName: contextEvent.name, salesBreakdown });

        const extension = isExcel ? "xlsx" : "csv";
        const contentType = isExcel
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8";

        const filenamePrefix = sanitizeFileNameSegment(contextEvent.name);
        const fileTimestamp = getTimestampTag(new Date(stats.generatedAt));
        const filename = `report-${filenamePrefix}-${fileTimestamp}.${extension}`;

        return new NextResponse(typeof content === "string" ? content : new Uint8Array(content), {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-store"
            }
        });
    } catch (error) {
        console.error("Admin Dashboard Export Error:", error);
        return NextResponse.json(
            { error: "Errore interno durante la generazione del report" },
            { status: 500 }
        );
    }
}
