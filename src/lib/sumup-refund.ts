import { SumUp, type TransactionFull } from "@sumup/sdk"

type SumUpRefundStateInput = {
    transactionId: string
    merchantCode: string
    apiKey: string
}

type RefundEvent = {
    id?: string
    type?: string
    event_type?: string
    status?: string
    amount?: number
    timestamp?: string
    date?: string
}

function refundEventCoverage(transaction: TransactionFull) {
    const transactionAmount = Number(transaction.amount)
    const events = [
        ...(transaction.events || []),
        ...(transaction.transaction_events || [])
    ] as RefundEvent[]
    const uniqueEvents = new Map<string, RefundEvent>()
    for (const event of events) {
        const key = event.id || [
            event.type || event.event_type,
            event.status,
            event.amount,
            event.timestamp || event.date
        ].join(":")
        uniqueEvents.set(key, event)
    }

    const refundEvents = [...uniqueEvents.values()]
        .filter((event) => (event.type || event.event_type) === "REFUND")
        .filter((event) => event.status === "REFUNDED" || event.status === "SUCCESSFUL")
    const refundedAmount = refundEvents
        .reduce((total, event) => total + Math.max(0, Number(event.amount) || 0), 0)

    return {
        hasRefundEvents: refundEvents.length > 0,
        fullyRefunded: Number.isFinite(transactionAmount)
            && transactionAmount > 0
            && refundedAmount + 1e-9 >= transactionAmount
    }
}

export async function getSumUpRefundState(data: SumUpRefundStateInput): Promise<
    { success: true; fullyRefunded: boolean }
    | { success: false; error: string }
> {
    const transactionId = data.transactionId?.trim()
    const merchantCode = data.merchantCode?.trim()
    const apiKey = data.apiKey?.trim()
    if (!transactionId || !merchantCode || !apiKey) {
        return { success: false, error: "Configurazione verifica rimborso SumUp incompleta" }
    }

    try {
        const client = new SumUp({ apiKey })
        const transaction = await client.transactions.get(merchantCode, { id: transactionId })
        if (transaction.id?.trim() !== transactionId) {
            return { success: false, error: "Transazione SumUp non corrispondente" }
        }

        const eventCoverage = refundEventCoverage(transaction)
        return {
            success: true,
            fullyRefunded: eventCoverage.hasRefundEvents
                ? eventCoverage.fullyRefunded
                : transaction.simple_status === "REFUNDED"
        }
    } catch (error) {
        console.error("SumUp Refund Reconciliation Error:", error)
        return { success: false, error: "Impossibile verificare il rimborso con SumUp" }
    }
}
