import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz";
import { getAdminContextEvent } from "@/lib/events";
import Order from "@/models/Order";
import Product from "@/models/Product";
import type { IEvent } from "@/models/Event";
import {
    buildDashboardCsvContent,
    buildDashboardXlsCompatibleContent,
    computeDashboardStats,
    type DashboardOrderInput,
    type DashboardProductInput
} from "@/lib/dashboard-stats";

export const dynamic = "force-dynamic";

interface OrderProjection {
    _id: unknown
    status?: string
    createdAt?: Date | string
    totalAmount?: number
    paymentMethod?: string
    cart?: Array<{
        productId?: unknown
        snapshotName?: string
        quantity?: number
    }>
}

interface ProductProjection {
    _id: unknown
    name: string
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
        if (format !== "csv" && format !== "xls") {
            return NextResponse.json(
                { error: "Formato export non supportato. Usa format=csv oppure format=xls." },
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
        const [orders, products] = await Promise.all([
            Order.find({ eventId, status: "PAID" })
                .sort({ createdAt: -1 })
                .select("_id status createdAt totalAmount paymentMethod cart")
                .lean() as Promise<OrderProjection[]>,
            Product.find({ eventId }).select("_id name").lean() as Promise<ProductProjection[]>
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

        const content =
            format === "xls"
                ? buildDashboardXlsCompatibleContent(stats, { eventName: contextEvent.name })
                : buildDashboardCsvContent(stats, { eventName: contextEvent.name });

        const extension = format === "xls" ? "xls" : "csv";
        const contentType =
            format === "xls"
                ? "application/vnd.ms-excel; charset=utf-8"
                : "text/csv; charset=utf-8";

        const filenamePrefix = sanitizeFileNameSegment(contextEvent.name);
        const fileTimestamp = getTimestampTag(new Date(stats.generatedAt));
        const filename = `report-${filenamePrefix}-${fileTimestamp}.${extension}`;

        return new NextResponse(content, {
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
