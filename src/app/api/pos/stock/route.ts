import { NextRequest, NextResponse } from "next/server"
import { authorizePosStockRequest, getPosStockSnapshot } from "@/lib/pos-stock"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest) {
    const authorization = await authorizePosStockRequest(
        request.nextUrl.searchParams.get("eventId"),
        request.headers
    )
    if (!authorization.ok) {
        return NextResponse.json(
            { error: authorization.error },
            { status: authorization.status, headers: { "Cache-Control": "no-store" } }
        )
    }

    return NextResponse.json(await getPosStockSnapshot(authorization.eventId), {
        headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
        }
    })
}
