import { SumUp, Currency } from "@sumup/sdk";

function resolveApiKey(overrideApiKey?: string): string | undefined {
    const explicitApiKey = overrideApiKey?.trim();
    if (explicitApiKey) return explicitApiKey;
    const envApiKey = process.env.SUMUP_API_KEY?.trim();
    return envApiKey || undefined;
}

export async function createSumUpCheckout(amount: number, currency: Currency = "EUR", merchantCode = "M_CODE", apiKey?: string) {
    try {
        const resolvedApiKey = resolveApiKey(apiKey);
        if (!resolvedApiKey) {
            return { success: false, error: "Missing SumUp API key configuration" };
        }

        const client = new SumUp({ apiKey: resolvedApiKey });
        const checkout = await client.checkouts.create({
            merchant_code: merchantCode,
            amount,
            currency,
            checkout_reference: `fantafestando-${Date.now()}`,
            description: "FantaFestando Order",
            // return_url: "http://pos.local/callback" // Used for web-redirect checkouts
        });
        return { success: true, id: checkout.id };
    } catch (error) {
        console.error("SumUp Checkout Error:", error);
        return { success: false, error: "Failed to initiate payment" };
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
        const checkout = await client.checkouts.get(normalizedCheckoutId)
        const transactionId = checkout.transactions?.[0]?.id?.trim()

        if (!transactionId) {
            return { success: false, error: "No transaction id available for this checkout" }
        }

        return { success: true, transactionId }
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
