import { NextRequest } from "next/server"
import { authorizePosStockRequest } from "@/lib/pos-stock"
import { subscribeStockInvalidation } from "@/lib/pos-stock-realtime"

export const dynamic = "force-dynamic"
export const revalidate = 0

const HEARTBEAT_INTERVAL_MS = 15_000

function encodeStockEvent(encoder: TextEncoder, eventId: string) {
    return encoder.encode(`event: stock\ndata: ${JSON.stringify({ eventId })}\n\n`)
}

export async function GET(request: NextRequest) {
    const authorization = await authorizePosStockRequest(
        request.nextUrl.searchParams.get("eventId"),
        request.headers
    )
    if (!authorization.ok) {
        return Response.json(
            { error: authorization.error },
            { status: authorization.status, headers: { "Cache-Control": "no-store" } }
        )
    }

    const { eventId } = authorization
    const encoder = new TextEncoder()
    let dispose: () => void = () => undefined
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            let closed = false
            const sendStock = () => {
                if (closed) return
                try {
                    controller.enqueue(encodeStockEvent(encoder, eventId))
                } catch {
                    dispose()
                }
            }
            const unsubscribe = subscribeStockInvalidation(eventId, sendStock)
            const heartbeat = setInterval(() => {
                if (closed) return
                try {
                    controller.enqueue(encoder.encode(": heartbeat\n\n"))
                } catch {
                    dispose()
                }
            }, HEARTBEAT_INTERVAL_MS)
            const cleanup = (closeController: boolean) => {
                if (closed) return
                closed = true
                clearInterval(heartbeat)
                unsubscribe()
                request.signal.removeEventListener("abort", abort)
                if (closeController) controller.close()
            }
            const abort = () => cleanup(true)
            dispose = () => cleanup(false)
            request.signal.addEventListener("abort", abort, { once: true })
            sendStock()
            if (request.signal.aborted) abort()
        },
        cancel() {
            dispose()
        }
    })

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff"
        }
    })
}
