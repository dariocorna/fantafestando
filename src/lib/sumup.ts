import { SumUp, Currency } from "@sumup/sdk";

// In a real scenario, these would come from environment variables
// and potentially from an OAuth flow if the app is multi-merchant.
// For OSGFest, we assume a single merchant configuration for now.
const SUMUP_API_KEY = process.env.SUMUP_API_KEY || "YOUR_SUMUP_API_KEY";

export const sumupClient = new SumUp({
    apiKey: SUMUP_API_KEY
});

export async function createSumUpCheckout(amount: number, currency: Currency = "EUR", merchantCode = "M_CODE") {
    try {
        const checkout = await sumupClient.checkouts.create({
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
