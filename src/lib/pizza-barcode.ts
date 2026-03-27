const MONGO_OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const PIZZA_BARCODE_EAN8_PATTERN = /^\d{8}$/;
const PIZZA_BARCODE_MANUAL_NUMBER_PATTERN = /^\d{1,7}$/;

export type ParsedPizzaBarcode =
    | { orderId: string }
    | { pizzaNumber: number };

export function getPizzaBarcodeValue(pizzaNumber: number): string {
    if (!Number.isInteger(pizzaNumber) || pizzaNumber <= 0 || pizzaNumber > 9_999_999) {
        throw new Error("Invalid pizza number for barcode");
    }

    const barcodeBody = String(pizzaNumber).padStart(7, "0");
    return `${barcodeBody}${computeEan8CheckDigit(barcodeBody)}`;
}

export function parsePizzaOrderIdValue(rawValue: string): { orderId: string } | null {
    const orderId = rawValue.trim();
    if (!MONGO_OBJECT_ID_PATTERN.test(orderId)) return null;

    return { orderId };
}

export function parsePizzaBarcodeValue(rawValue: string): ParsedPizzaBarcode | null {
    const normalized = rawValue.trim();
    if (PIZZA_BARCODE_EAN8_PATTERN.test(normalized)) {
        if (!isValidEan8Barcode(normalized)) return null;

        const pizzaNumber = Number.parseInt(normalized.slice(0, 7), 10);
        if (!Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return null;
        return { pizzaNumber };
    }

    if (PIZZA_BARCODE_MANUAL_NUMBER_PATTERN.test(normalized)) {
        const pizzaNumber = Number.parseInt(normalized, 10);
        if (!Number.isInteger(pizzaNumber) || pizzaNumber <= 0) return null;
        return { pizzaNumber };
    }

    if (!normalized.startsWith("PZ:")) return null;

    return parsePizzaOrderIdValue(normalized.slice(3));
}

function computeEan8CheckDigit(barcodeBody: string): string {
    if (!/^\d{7}$/.test(barcodeBody)) {
        throw new Error("Invalid EAN-8 body");
    }

    const weightedSum = barcodeBody
        .split("")
        .map((digit) => Number.parseInt(digit, 10))
        .reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1), 0);

    return String((10 - (weightedSum % 10)) % 10);
}

function isValidEan8Barcode(value: string): boolean {
    return value.length === 8 && computeEan8CheckDigit(value.slice(0, 7)) === value[7];
}
