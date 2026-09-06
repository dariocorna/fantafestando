import { APIError, SumUp, type Currency, type TransactionFull } from "@sumup/sdk";

type CreateSumUpCheckoutInput = {
    amount: number
    currency?: Currency
    merchantCode: string
    readerId: string
    apiKey?: string
    affiliateAppId: string
    affiliateKey: string
    foreignTransactionId: string
    returnUrl?: string
}

type SumUpTransactionLookupInput = {
    clientTransactionId: string
    merchantCode: string
    apiKey?: string
}

type SumUpForeignTransactionLookupInput = {
    foreignTransactionId: string
    merchantCode: string
    apiKey?: string
}

type SumUpReaderInput = {
    merchantCode: string
    readerId: string
    apiKey?: string
}

function resolveApiKey(overrideApiKey?: string): string | undefined {
    return overrideApiKey?.trim() || undefined;
}

function normalizeAmountToMinorUnits(amount: number) {
    return Math.round(Number(amount.toFixed(2)) * 100)
}

function resolveWebhookReturnUrl(foreignTransactionId: string, explicitReturnUrl?: string) {
    const configuredUrl = explicitReturnUrl?.trim() || process.env.SUMUP_WEBHOOK_URL?.trim()

    let returnUrl: URL
    try {
        if (configuredUrl) {
            returnUrl = new URL(configuredUrl)
        } else {
            const menuBaseUrl = process.env.NEXTAUTH_URL_MENU?.trim()
            if (!menuBaseUrl) {
                return { success: false as const, error: "Missing NEXTAUTH_URL_MENU for SumUp webhook callback" }
            }
            returnUrl = new URL("/api/sumup/webhook", menuBaseUrl)
        }
    } catch {
        return { success: false as const, error: "Invalid SumUp webhook callback URL" }
    }

    if (returnUrl.pathname !== "/api/sumup/webhook") {
        return { success: false as const, error: "SumUp webhook callback must target /api/sumup/webhook" }
    }

    returnUrl.searchParams.set("orderId", foreignTransactionId)

    if (returnUrl.protocol === "https:") {
        return { success: true as const, returnUrl: returnUrl.toString() }
    }

    const isLocalHttp = returnUrl.protocol === "http:"
        && ["localhost", "127.0.0.1", "::1"].includes(returnUrl.hostname)
        && process.env.NODE_ENV !== "production"

    if (isLocalHttp) {
        return { success: true as const, returnUrl: returnUrl.toString() }
    }

    return { success: false as const, error: "SumUp webhook callback must use HTTPS" }
}

export async function createSumUpCheckout(data: CreateSumUpCheckoutInput) {
    try {
        const resolvedApiKey = resolveApiKey(data.apiKey);
        if (!resolvedApiKey) {
            return { success: false, error: "Missing SumUp API key configuration" };
        }

        const normalizedMerchantCode = data.merchantCode?.trim()
        const normalizedReaderId = data.readerId?.trim()
        const normalizedAffiliateAppId = data.affiliateAppId?.trim()
        const normalizedAffiliateKey = data.affiliateKey?.trim()
        const normalizedCurrency = data.currency || "EUR"
        const foreignTransactionId = data.foreignTransactionId?.trim()
        const minorAmount = normalizeAmountToMinorUnits(data.amount)

        if (!normalizedMerchantCode || !normalizedReaderId || !normalizedAffiliateAppId || !normalizedAffiliateKey || !foreignTransactionId) {
            return { success: false, error: "Missing SumUp reader configuration" }
        }

        const webhookUrl = resolveWebhookReturnUrl(foreignTransactionId, data.returnUrl)
        if (!webhookUrl.success) {
            return { success: false, error: webhookUrl.error }
        }

        if (!Number.isFinite(data.amount) || data.amount <= 0 || minorAmount <= 0) {
            return { success: false, error: "Invalid SumUp payment amount" }
        }

        const client = new SumUp({ apiKey: resolvedApiKey });
        const checkout = await client.readers.createCheckout(normalizedMerchantCode, normalizedReaderId, {
            affiliate: {
                app_id: normalizedAffiliateAppId,
                key: normalizedAffiliateKey,
                foreign_transaction_id: foreignTransactionId
            },
            description: "FantaFestando Order",
            return_url: webhookUrl.returnUrl,
            total_amount: {
                currency: normalizedCurrency,
                minor_unit: 2,
                value: minorAmount
            }
        });
        const clientTransactionId = checkout.data?.client_transaction_id?.trim()
        if (!clientTransactionId) {
            return {
                success: false,
                error: "Missing SumUp client transaction id",
                uncertain: true
            }
        }
        return { success: true, id: clientTransactionId };
    } catch (error) {
        console.error("SumUp Checkout Error:", error);
        const definiteClientError = error instanceof APIError
            && error.status >= 400
            && error.status < 500
            && error.status !== 408
        return {
            success: false,
            error: "Failed to initiate payment",
            uncertain: !definiteClientError
        };
    }
}

export async function getSumUpTransactionByClientTransactionId(data: SumUpTransactionLookupInput) {
    try {
        const normalizedTransactionId = data.clientTransactionId?.trim()
        const normalizedMerchantCode = data.merchantCode?.trim()
        if (!normalizedTransactionId) {
            return { success: false as const, error: "Missing client transaction id" }
        }
        if (!normalizedMerchantCode) {
            return { success: false as const, error: "Missing merchant code" }
        }

        const resolvedApiKey = resolveApiKey(data.apiKey)
        if (!resolvedApiKey) {
            return { success: false as const, error: "Missing SumUp API key configuration" }
        }

        const client = new SumUp({ apiKey: resolvedApiKey })
        const transaction = await client.transactions.get(normalizedMerchantCode, {
            client_transaction_id: normalizedTransactionId
        })

        return { success: true as const, transaction }
    } catch (error) {
        console.error("SumUp Transaction Lookup Error:", error)
        if (error instanceof APIError && error.status === 404) {
            return {
                success: false as const,
                notFound: true as const,
                error: "Transaction not found with SumUp"
            }
        }
        return { success: false as const, error: "Unable to verify transaction with SumUp" }
    }
}

export async function getSumUpTransactionByForeignTransactionId(data: SumUpForeignTransactionLookupInput) {
    try {
        const foreignTransactionId = data.foreignTransactionId?.trim()
        const merchantCode = data.merchantCode?.trim()
        const apiKey = resolveApiKey(data.apiKey)
        if (!foreignTransactionId || !merchantCode || !apiKey) {
            return { success: false as const, error: "Missing SumUp transaction lookup configuration" }
        }

        const client = new SumUp({ apiKey })
        const transaction = await client.transactions.get(merchantCode, {
            foreign_transaction_id: foreignTransactionId
        })
        return { success: true as const, transaction }
    } catch (error) {
        console.error("SumUp Foreign Transaction Lookup Error:", error)
        if (error instanceof APIError && error.status === 404) {
            return {
                success: false as const,
                notFound: true as const,
                error: "Transaction not found with SumUp"
            }
        }
        return { success: false as const, error: "Unable to reconcile transaction with SumUp" }
    }
}

export async function getSumUpReaderStatus(data: SumUpReaderInput) {
    try {
        const merchantCode = data.merchantCode?.trim()
        const readerId = data.readerId?.trim()
        if (!merchantCode || !readerId) {
            return { success: false as const, error: "Missing SumUp reader configuration" }
        }

        const apiKey = resolveApiKey(data.apiKey)
        if (!apiKey) {
            return { success: false as const, error: "Missing SumUp API key configuration" }
        }

        const readerStatus = await new SumUp({ apiKey }).readers.getStatus(merchantCode, readerId)
        return {
            success: true as const,
            state: readerStatus.data.state,
            status: readerStatus.data.status
        }
    } catch (error) {
        console.error("SumUp Reader Status Error:", error)
        return { success: false as const, error: "Unable to get SumUp reader status" }
    }
}

export async function resolveSumUpTransactionIdByCheckout(checkoutId: string, apiKey?: string) {
    try {
        const normalizedCheckoutId = checkoutId?.trim()
        if (!normalizedCheckoutId) {
            return { success: false, error: "Missing checkout id" }
        }

        const resolvedApiKey = resolveApiKey(apiKey)
        if (!resolvedApiKey) {
            return { success: false, error: "Missing SumUp API key configuration" }
        }

        const client = new SumUp({ apiKey: resolvedApiKey })

        try {
            const checkout = await client.checkouts.get(normalizedCheckoutId)
            const transactionId = checkout.transactions?.[0]?.id?.trim()

            if (!transactionId) {
                return { success: false, error: "No transaction id available for this checkout" }
            }

            return { success: true, transactionId }
        } catch (legacyCheckoutError) {
            const merchantProfile = await client.merchant.getMerchantProfile()
            const merchantCode = merchantProfile.merchant_code?.trim()
            if (!merchantCode) {
                console.error("SumUp Resolve Transaction Error: missing merchant code", legacyCheckoutError)
                return { success: false, error: "Missing merchant code for transaction lookup" }
            }

            const transaction = await client.transactions.get(merchantCode, {
                client_transaction_id: normalizedCheckoutId
            }) as TransactionFull
            const transactionId = transaction.id?.trim()
            if (!transactionId) {
                return { success: false, error: "No transaction id available for this checkout" }
            }

            return { success: true, transactionId }
        }
    } catch (error) {
        console.error("SumUp Resolve Transaction Error:", error)
        return { success: false, error: "Unable to resolve transaction from checkout" }
    }
}

export async function refundSumUpTransaction(data: {
    transactionId: string
    apiKey?: string
    amount?: number
}) {
    try {
        const normalizedTransactionId = data.transactionId?.trim()
        if (!normalizedTransactionId) {
            return { success: false, error: "Missing transaction id" }
        }

        const resolvedApiKey = resolveApiKey(data.apiKey)
        if (!resolvedApiKey) {
            return { success: false, error: "Missing SumUp API key configuration" }
        }

        const client = new SumUp({ apiKey: resolvedApiKey })
        const normalizedAmount = Number(data.amount)

        if (Number.isFinite(normalizedAmount) && normalizedAmount > 0) {
            await client.transactions.refund(normalizedTransactionId, {
                amount: Number(normalizedAmount.toFixed(2))
            })
        } else {
            await client.transactions.refund(normalizedTransactionId)
        }

        return { success: true }
    } catch (error) {
        console.error("SumUp Refund Error:", error)
        return { success: false, error: "Failed to refund transaction" }
    }
}
