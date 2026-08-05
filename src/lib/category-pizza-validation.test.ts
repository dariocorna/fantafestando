import { describe, expect, test } from "vitest";
import { validatePizzaCategoryConfiguration } from "./category-pizza-validation";

describe("validatePizzaCategoryConfiguration", () => {
    test("accetta categorie senza preparazione numerata anche senza stampante reparto", () => {
        expect(validatePizzaCategoryConfiguration({
            pizzaFlowEnabled: false,
            skipKitchenPrint: true
        })).toBeNull();
    });

    test("accetta le categorie numerate anche senza stampante kitchen dedicata", () => {
        expect(validatePizzaCategoryConfiguration({
            pizzaFlowEnabled: true,
            skipKitchenPrint: false
        })).toBeNull();
    });

    test("blocca le categorie numerate che disattivano la stampa comanda", () => {
        expect(validatePizzaCategoryConfiguration({
            pizzaFlowEnabled: true,
            printerId: "printer-1",
            skipKitchenPrint: true
        })).toBe("Una categoria con preparazione numerata non può disattivare la stampa comanda");
    });

    test("accetta le categorie numerate con stampante kitchen e stampa attiva", () => {
        expect(validatePizzaCategoryConfiguration({
            pizzaFlowEnabled: true,
            printerId: "printer-1",
            skipKitchenPrint: false
        })).toBeNull();
    });
});
