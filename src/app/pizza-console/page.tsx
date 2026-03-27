import { PizzaConsoleClient } from "@/components/pizza-console-client";
import { requireAuthenticatedPageSession } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function PizzaConsolePage() {
    await requireAuthenticatedPageSession();
    return <PizzaConsoleClient />;
}
