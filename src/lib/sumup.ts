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
            checkout_reference: `osgfest-${Date.now()}`,
            description: "OSGFest Order",
            // return_url: "http://pos.local/callback" // Used for web-redirect checkouts
        });
        return { success: true, id: checkout.id };
    } catch (error) {
        console.error("SumUp Checkout Error:", error);
        return { success: false, error: "Failed to initiate payment" };
    }
}
