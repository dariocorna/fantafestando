export function validatePizzaCategoryConfiguration(input: {
    pizzaFlowEnabled: boolean;
    printerId?: string;
    skipKitchenPrint: boolean;
}) {
    if (!input.pizzaFlowEnabled) return null;
    if (input.skipKitchenPrint) {
        return "Una categoria pizza non può disattivare la stampa comanda";
    }
    if (!input.printerId) {
        return "Una categoria pizza richiede una stampante reparto kitchen";
    }
    return null;
}
