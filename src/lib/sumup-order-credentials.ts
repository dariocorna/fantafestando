import PosDevice from "@/models/PosDevice"
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/lib/secrets"

export type SumUpRefundCredentialsSnapshot = {
    merchantCode?: string
    readerId?: string
    apiKey?: string
}

export type SumUpOrderWithCredentials = {
    eventId?: string | { toString(): string } | null
    posDeviceId?: string | { toString(): string } | null
    sumupRefundCredentials?: SumUpRefundCredentialsSnapshot | null
}

export function buildSumUpRefundCredentialsSnapshot(data: SumUpRefundCredentialsSnapshot) {
    const merchantCode = data.merchantCode?.trim()
    const readerId = data.readerId?.trim()
    const apiKey = data.apiKey?.trim()
    if (!merchantCode || !apiKey) return null

    return {
        merchantCode,
        ...(readerId ? { readerId } : {}),
        apiKey: encryptSecret(apiKey)
    }
}

export async function resolveSumUpCredentialsForOrder(order: SumUpOrderWithCredentials): Promise<
    { success: true, apiKey: string, merchantCode: string, readerId?: string }
    | { success: false, error: string }
> {
    if (order.sumupRefundCredentials !== undefined && order.sumupRefundCredentials !== null) {
        const merchantCode = order.sumupRefundCredentials.merchantCode?.trim()
        const encryptedApiKey = order.sumupRefundCredentials.apiKey?.trim()
        const readerId = order.sumupRefundCredentials.readerId?.trim()
        const apiKey = isEncryptedSecret(encryptedApiKey) ? decryptSecret(encryptedApiKey) : undefined
        if (!merchantCode || !encryptedApiKey || !apiKey) {
            return { success: false, error: "Snapshot credenziali SumUp non valido" }
        }
        return { success: true, apiKey, merchantCode, ...(readerId ? { readerId } : {}) }
    }

    const eventId = order.eventId?.toString()
    const posDeviceId = order.posDeviceId?.toString()
    if (!eventId || !posDeviceId) {
        return { success: false, error: "Ordine SumUp senza punto cassa associato" }
    }

    const posDevice = await PosDevice.findOne({ _id: posDeviceId, eventId })
        .populate({ path: "paymentTerminalId", select: "type config" })
        .lean() as (
            {
                paymentTerminalId?: {
                    type?: string
                    config?: { apiKey?: string, merchantCode?: string, readerId?: string }
                } | null
            } | null
        )

    const terminal = posDevice?.paymentTerminalId
    if (!terminal || terminal.type !== "SUMUP") {
        return { success: false, error: "Terminale SumUp non disponibile per l'ordine" }
    }

    const apiKey = decryptSecret(terminal.config?.apiKey)
    const merchantCode = terminal.config?.merchantCode?.trim()
    if (!apiKey || !merchantCode) {
        return { success: false, error: "Configurazione credenziali SumUp mancante" }
    }

    const readerId = terminal.config?.readerId?.trim()
    return { success: true, apiKey, merchantCode, ...(readerId ? { readerId } : {}) }
}
