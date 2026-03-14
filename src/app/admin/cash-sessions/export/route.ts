import { NextRequest, NextResponse } from "next/server"
import dbConnect from "@/lib/mongoose"
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz"
import { getAdminContextEvent } from "@/lib/events"
import type { IEvent } from "@/models/Event"
import CashSession from "@/models/CashSession"
import Order from "@/models/Order"
import PosDevice from "@/models/PosDevice"
import Product from "@/models/Product"
import {
    buildCashSessionCsvContent,
    buildCashSessionXlsCompatibleContent,
    computeCashSessionSummary,
    type CashSessionOrderInput
} from "@/lib/cash-session"
import { getOrderCodeFromOrder } from "@/lib/order-code"
import { aggregateOrderProductConsumptions } from "@/lib/product-consumption"

export const dynamic = "force-dynamic"

interface CashSessionProjection {
    _id: unknown
    eventId: unknown
    posDeviceId?: unknown
    status?: "OPEN" | "CLOSED"
    openedAt?: Date | string
    closedAt?: Date | string
    openingFloatAmount?: number
    openingNotes?: string
    closingCountedCashAmount?: number
    closingNotes?: string
    paidOrdersCount?: number
    cashSalesAmount?: number
    cardSalesAmount?: number
    otherSalesAmount?: number
    expectedCashAmount?: number
    varianceAmount?: number
}

interface PosDeviceProjection {
    _id: unknown
    name?: string
}

interface OrderProjection {
    _id: unknown
    pickupNumber?: number
    createdAt?: Date | string
    status?: string
    paymentMethod?: string
    totalAmount?: number
    discountApplied?: number
    cart?: Array<{
        productId?: string | { toString(): string }
        snapshotName?: string
        quantity?: number
        discountApplied?: number
        lineTotal?: number
        selectedOptions?: Array<{ name?: string, priceVariation?: number }>
    }>
    customer?: {
        name?: string
        table?: string
    }
}

interface ProductProjection {
    _id: unknown
    name?: string
    basePrice?: number
}

function isObjectIdLike(value: string): boolean {
    return /^[a-fA-F0-9]{24}$/.test(value)
}

function sanitizeFileNameSegment(value: string): string {
    const normalized = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")

    return normalized || "dato"
}

function getTimestampTag(value: Date): string {
    const yyyy = value.getFullYear()
    const mm = `${value.getMonth() + 1}`.padStart(2, "0")
    const dd = `${value.getDate()}`.padStart(2, "0")
    const hh = `${value.getHours()}`.padStart(2, "0")
    const min = `${value.getMinutes()}`.padStart(2, "0")
    return `${yyyy}${mm}${dd}-${hh}${min}`
}

function normalizeAmount(value: number | null | undefined): number {
    if (!Number.isFinite(value)) return 0
    return Number(Math.max(0, Number(value)).toFixed(2))
}

export async function GET(request: NextRequest) {
    try {
        const sessionCheck = await ensureAdminSession()
        if (!sessionCheck.ok) {
            return adminUnauthorizedJson(sessionCheck)
        }

        const format = request.nextUrl.searchParams.get("format")?.trim().toLowerCase() || "csv"
        const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || ""

        if (format !== "csv" && format !== "xls") {
            return NextResponse.json(
                { error: "Formato export non supportato. Usa format=csv oppure format=xls." },
                { status: 400 }
            )
        }

        if (!isObjectIdLike(sessionId)) {
            return NextResponse.json(
                { error: "Sessione cassa non valida" },
                { status: 400 }
            )
        }

        const contextEvent = await getAdminContextEvent() as IEvent | null
        if (!contextEvent) {
            return NextResponse.json(
                { error: "Nessuna festa attiva o selezionata" },
                { status: 400 }
            )
        }

        const eventId = String(contextEvent._id)

        await dbConnect()
        const session = await CashSession.findOne({
            _id: sessionId,
            eventId
        })
            .lean() as CashSessionProjection | null

        if (!session) {
            return NextResponse.json(
                { error: "Sessione cassa non trovata per la festa selezionata" },
                { status: 404 }
            )
        }

        if (session.status !== "CLOSED") {
            return NextResponse.json(
                { error: "Il report è disponibile solo per sessioni cassa chiuse" },
                { status: 400 }
            )
        }

        const [posDevice, paidOrders] = await Promise.all([
            session.posDeviceId
                ? PosDevice.findOne({
                    _id: session.posDeviceId,
                    eventId
                }).select("_id name").lean() as Promise<PosDeviceProjection | null>
                : Promise.resolve(null),
            Order.find({
                eventId,
                cashSessionId: session._id,
                status: "PAID"
            })
                .sort({ createdAt: -1 })
                .select("_id pickupNumber createdAt status paymentMethod totalAmount discountApplied customer cart")
                .lean() as Promise<OrderProjection[]>
        ])

        const productIds = Array.from(
            new Set(
                paidOrders.flatMap((order) =>
                    (order.cart || [])
                        .map((item) => item.productId ? String(item.productId) : null)
                        .filter((id): id is string => Boolean(id))
                )
            )
        )

        const catalogProducts = productIds.length > 0
            ? await Product.find({ eventId, _id: { $in: productIds } })
                .select("_id name basePrice")
                .lean() as ProductProjection[]
            : []

        const productById = new Map<string, { name: string, basePrice: number }>()
        catalogProducts.forEach((product) => {
            productById.set(String(product._id), {
                name: product.name?.trim() || "Prodotto senza nome",
                basePrice: normalizeAmount(product.basePrice)
            })
        })
        const productConsumptions = aggregateOrderProductConsumptions({
            orders: paidOrders,
            catalogByProductId: productById
        })

        const computedFallback = computeCashSessionSummary({
            openingFloatAmount: normalizeAmount(session.openingFloatAmount),
            closingCountedCashAmount: normalizeAmount(session.closingCountedCashAmount),
            orders: paidOrders.map((order): CashSessionOrderInput => ({
                status: order.status,
                paymentMethod: order.paymentMethod,
                totalAmount: order.totalAmount
            }))
        })

        const reportInput = {
            eventName: contextEvent.name || "Festa",
            posDeviceName: posDevice?.name?.trim() || "Postazione non specificata",
            sessionId: String(session._id),
            status: "CLOSED" as const,
            openedAt: session.openedAt || null,
            closedAt: session.closedAt || null,
            openingFloatAmount: normalizeAmount(session.openingFloatAmount),
            closingCountedCashAmount: normalizeAmount(session.closingCountedCashAmount),
            paidOrdersCount: session.paidOrdersCount ?? computedFallback.paidOrdersCount,
            cashSalesAmount: session.cashSalesAmount ?? computedFallback.cashSalesAmount,
            cardSalesAmount: session.cardSalesAmount ?? computedFallback.cardSalesAmount,
            otherSalesAmount: session.otherSalesAmount ?? computedFallback.otherSalesAmount,
            expectedCashAmount: session.expectedCashAmount ?? computedFallback.expectedCashAmount,
            varianceAmount: session.varianceAmount ?? computedFallback.varianceAmount,
            openingNotes: session.openingNotes || "",
            closingNotes: session.closingNotes || "",
            productConsumptions: productConsumptions.map((metric) => ({
                productId: metric.productId || metric.productKey,
                productName: metric.productName,
                quantityConsumed: metric.quantityConsumed,
                revenueAmount: metric.revenueAmount
            })),
            orders: paidOrders.map((order) => ({
                id: String(order._id),
                orderCode: getOrderCodeFromOrder({
                    pickupNumber: order.pickupNumber,
                    _id: String(order._id)
                }),
                createdAt: order.createdAt || null,
                paymentMethod: order.paymentMethod || "OTHER",
                totalAmount: normalizeAmount(order.totalAmount),
                discountAmount: normalizeAmount(order.discountApplied),
                netAmount: normalizeAmount(order.totalAmount),
                customerName: order.customer?.name || "",
                customerTable: order.customer?.table || ""
            }))
        }

        const content =
            format === "xls"
                ? buildCashSessionXlsCompatibleContent(reportInput, { timezone: "Europe/Rome" })
                : buildCashSessionCsvContent(reportInput, { timezone: "Europe/Rome" })

        const extension = format === "xls" ? "xls" : "csv"
        const contentType =
            format === "xls"
                ? "application/vnd.ms-excel; charset=utf-8"
                : "text/csv; charset=utf-8"
        const closedAtDate = session.closedAt ? new Date(session.closedAt) : new Date()
        const fileTimestamp = getTimestampTag(closedAtDate)
        const eventSegment = sanitizeFileNameSegment(contextEvent.name || "evento")
        const posSegment = sanitizeFileNameSegment(posDevice?.name || "cassa")
        const filename = `cash-session-${eventSegment}-${posSegment}-${fileTimestamp}.${extension}`

        return new NextResponse(content, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-store"
            }
        })
    } catch (error) {
        console.error("Cash Session Export Error:", error)
        return NextResponse.json(
            { error: "Errore interno durante la generazione del report sessione cassa" },
            { status: 500 }
        )
    }
}
