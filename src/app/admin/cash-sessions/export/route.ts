import { NextRequest, NextResponse } from "next/server"
import dbConnect from "@/lib/mongoose"
import { adminUnauthorizedJson, ensureAdminSession } from "@/lib/authz"
import { getAdminContextEvent } from "@/lib/events"
import type { IEvent } from "@/models/Event"
import CashSession from "@/models/CashSession"
import Order from "@/models/Order"
import PosDevice from "@/models/PosDevice"
import Product from "@/models/Product"
import Category from "@/models/Category"
import {
    buildCashSessionCsvContent,
    computeCashSessionSummary,
    type CashSessionOrderInput,
    type CashSessionReportInput
} from "@/lib/cash-session"
import { buildCashSessionsWorkbook, buildCashSessionWorkbook } from "@/lib/excel-report"
import { getOrderCodeFromOrder } from "@/lib/order-code"
import {
    aggregateOrderProductConsumptions,
    aggregateOrderProductSales,
    type ProductConsumptionCatalogEntry
} from "@/lib/product-consumption"

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
    isTest?: boolean
}

interface PosDeviceProjection {
    _id: unknown
    name?: string
}

interface OrderProjection {
    _id: unknown
    cashSessionId?: unknown
    pickupNumber?: number
    createdAt?: Date | string
    status?: string
    paymentMethod?: string
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
    cart?: Array<{
        productId?: string | { toString(): string }
        snapshotName?: string
        quantity?: number
        discountApplied?: number
        discountMeta?: {
            type?: string
            label?: string
            value?: number
        }
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
    shortName?: string
    basePrice?: number
    categoryId?: unknown
}

interface CategoryProjection {
    _id: unknown
    name?: string
    printOrder?: number
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

function buildReportInput(params: {
    eventName: string
    session: CashSessionProjection
    posDeviceName: string
    paidOrders: OrderProjection[]
    productById: Map<string, ProductConsumptionCatalogEntry>
}): CashSessionReportInput {
    const { eventName, session, posDeviceName, paidOrders, productById } = params
    const salesBreakdown = aggregateOrderProductSales({ orders: paidOrders, catalogByProductId: productById })
    const productConsumptions = aggregateOrderProductConsumptions({ orders: paidOrders, catalogByProductId: productById })
    const computedFallback = computeCashSessionSummary({
        openingFloatAmount: normalizeAmount(session.openingFloatAmount),
        closingCountedCashAmount: normalizeAmount(session.closingCountedCashAmount),
        orders: paidOrders.map((order): CashSessionOrderInput => ({
            status: order.status,
            paymentMethod: order.paymentMethod,
            totalAmount: order.totalAmount
        }))
    })

    return {
        eventName,
        posDeviceName,
        sessionId: String(session._id),
        status: "CLOSED",
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
        salesBreakdown,
        productConsumptions: productConsumptions.map((metric) => ({
            productId: metric.productId || metric.productKey,
            productName: metric.productName,
            quantityConsumed: metric.quantityConsumed,
            revenueAmount: metric.revenueAmount
        })),
        orders: paidOrders.map((order) => ({
            id: String(order._id),
            orderCode: getOrderCodeFromOrder({ pickupNumber: order.pickupNumber, _id: String(order._id) }),
            createdAt: order.createdAt || null,
            paymentMethod: order.paymentMethod || "OTHER",
            totalAmount: normalizeAmount(order.totalAmount),
            discountAmount: normalizeAmount(order.discountApplied),
            netAmount: normalizeAmount(order.totalAmount),
            customerName: order.customer?.name || "",
            customerTable: order.customer?.table || ""
        })),
        isTest: Boolean(session.isTest)
    }
}

export async function GET(request: NextRequest) {
    try {
        const sessionCheck = await ensureAdminSession()
        if (!sessionCheck.ok) {
            return adminUnauthorizedJson(sessionCheck)
        }

        const format = request.nextUrl.searchParams.get("format")?.trim().toLowerCase() || "csv"
        const requestedSessionIds = request.nextUrl.searchParams.getAll("sessionId")
            .map((value) => value.trim().toLowerCase())
        const sessionIds = Array.from(new Set(requestedSessionIds))

        if (!["csv", "xls", "xlsx"].includes(format)) {
            return NextResponse.json(
                { error: "Formato export non supportato. Usa format=csv oppure format=xlsx." },
                { status: 400 }
            )
        }

        if (requestedSessionIds.length === 0 || sessionIds.some((sessionId) => !isObjectIdLike(sessionId))) {
            return NextResponse.json(
                { error: "Sessione cassa non valida" },
                { status: 400 }
            )
        }

        const isExcel = format === "xls" || format === "xlsx"
        if (sessionIds.length > 1 && !isExcel) {
            return NextResponse.json(
                { error: "L'export aggregato di più sessioni è disponibile solo in formato XLSX" },
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
        const foundSessions = await CashSession.find({
            _id: { $in: sessionIds },
            eventId
        })
            .lean() as CashSessionProjection[]

        if (foundSessions.length !== sessionIds.length) {
            return NextResponse.json(
                { error: "Sessione cassa non trovata per la festa selezionata" },
                { status: 404 }
            )
        }

        if (foundSessions.some((session) => session.status !== "CLOSED")) {
            return NextResponse.json(
                { error: "Il report è disponibile solo per sessioni cassa chiuse" },
                { status: 400 }
            )
        }

        const sessionsById = new Map(foundSessions.map((session) => [String(session._id), session] as const))
        const sessions = sessionIds.map((sessionId) => sessionsById.get(sessionId)!)
        const posDeviceIds = Array.from(new Set(
            sessions.map((session) => session.posDeviceId ? String(session.posDeviceId) : "").filter(Boolean)
        ))

        const [posDevices, paidOrders] = await Promise.all([
            posDeviceIds.length > 0
                ? PosDevice.find({ _id: { $in: posDeviceIds }, eventId })
                    .select("_id name").lean() as Promise<PosDeviceProjection[]>
                : Promise.resolve([] as PosDeviceProjection[]),
            Order.find({
                eventId,
                cashSessionId: { $in: sessionIds },
                status: "PAID"
            })
                .sort({ createdAt: -1 })
                .select("_id cashSessionId pickupNumber createdAt status paymentMethod totalAmount discountApplied discountMeta discountComponents pricingMode customer cart")
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

        const [catalogProducts, categories] = await Promise.all([
            productIds.length > 0
                ? Product.find({ eventId, _id: { $in: productIds } })
                    .select("_id name shortName basePrice categoryId")
                    .lean() as Promise<ProductProjection[]>
                : Promise.resolve([] as ProductProjection[]),
            Category.find({ eventId })
                .select("_id name printOrder")
                .lean() as Promise<CategoryProjection[]>
        ])

        const categoryById = new Map(categories.map((category) => [String(category._id), category] as const))
        const productById = new Map<string, ProductConsumptionCatalogEntry>()
        catalogProducts.forEach((product) => {
            const category = product.categoryId ? categoryById.get(String(product.categoryId)) : undefined
            productById.set(String(product._id), {
                name: product.name?.trim() || "Prodotto senza nome",
                shortName: product.shortName?.trim(),
                basePrice: normalizeAmount(product.basePrice),
                categoryName: category?.name,
                categoryOrder: category?.printOrder
            })
        })
        const posDeviceById = new Map(posDevices.map((posDevice) => [String(posDevice._id), posDevice] as const))
        const ordersBySessionId = new Map<string, OrderProjection[]>()
        paidOrders.forEach((order) => {
            const sessionId = order.cashSessionId ? String(order.cashSessionId) : ""
            if (!ordersBySessionId.has(sessionId)) ordersBySessionId.set(sessionId, [])
            ordersBySessionId.get(sessionId)!.push(order)
        })
        const reportInputs = sessions.map((session) => buildReportInput({
            eventName: contextEvent.name || "Festa",
            session,
            posDeviceName: session.posDeviceId
                ? posDeviceById.get(String(session.posDeviceId))?.name?.trim() || "Postazione non specificata"
                : "Postazione non specificata",
            paidOrders: ordersBySessionId.get(String(session._id)) || [],
            productById
        }))

        const content = isExcel
            ? reportInputs.length > 1
                ? await buildCashSessionsWorkbook(reportInputs)
                : await buildCashSessionWorkbook(reportInputs[0])
            : buildCashSessionCsvContent(reportInputs[0], { timezone: "Europe/Rome" })

        const extension = isExcel ? "xlsx" : "csv"
        const contentType = isExcel
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8"
        const session = sessions[0]
        const firstPosDevice = session.posDeviceId ? posDeviceById.get(String(session.posDeviceId)) : undefined
        const closedAtDate = session.closedAt ? new Date(session.closedAt) : new Date()
        const fileTimestamp = getTimestampTag(closedAtDate)
        const eventSegment = sanitizeFileNameSegment(contextEvent.name || "evento")
        const posSegment = sanitizeFileNameSegment(firstPosDevice?.name || "cassa")
        const filename = reportInputs.length > 1
            ? `cash-sessions-${eventSegment}-${getTimestampTag(new Date())}.xlsx`
            : `cash-session-${eventSegment}-${posSegment}-${fileTimestamp}.${extension}`

        return new NextResponse(typeof content === "string" ? content : new Uint8Array(content), {
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
