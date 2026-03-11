function parsePort(value: string | undefined, fallback: number): number {
    const normalized = Number.parseInt((value || "").trim(), 10);
    return Number.isInteger(normalized) && normalized > 0 && normalized <= 65535
        ? normalized
        : fallback;
}

function readTrimmedEnv(name: string): string {
    return (process.env[name] || "").trim();
}

export interface RealPrintConfig {
    enabled: boolean;
    skipReason?: string;
    cashierHost: string;
    cashierPort: number;
    kitchenHost: string;
    kitchenPort: number;
    timeoutMs: number;
}

export function getRealPrintConfig(): RealPrintConfig {
    const enabledFlag = readTrimmedEnv("ENABLE_REAL_PRINT_TESTS");
    const cashierHost = readTrimmedEnv("REAL_PRINT_CASHIER_HOST");
    const kitchenHost = readTrimmedEnv("REAL_PRINT_KITCHEN_HOST");

    const hasRequiredHosts = cashierHost.length > 0 && kitchenHost.length > 0;
    const enabled = enabledFlag === "1" && hasRequiredHosts;

    let skipReason: string | undefined;
    if (enabledFlag !== "1") {
        skipReason = "Suite reale disabilitata: imposta ENABLE_REAL_PRINT_TESTS=1.";
    } else if (!hasRequiredHosts) {
        skipReason = "Suite reale disabilitata: imposta REAL_PRINT_CASHIER_HOST e REAL_PRINT_KITCHEN_HOST.";
    }

    return {
        enabled,
        skipReason,
        cashierHost,
        cashierPort: parsePort(process.env.REAL_PRINT_CASHIER_PORT, 9100),
        kitchenHost,
        kitchenPort: parsePort(process.env.REAL_PRINT_KITCHEN_PORT, 9100),
        timeoutMs: parsePort(process.env.REAL_PRINT_TIMEOUT_MS, 30000)
    };
}
