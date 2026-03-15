import { CharacterSet } from "node-thermal-printer";

export const DEFAULT_PRINTER_PORT = 9100;
export const DEFAULT_EMULATOR_START_PORT = 19100;
export const MIN_PRINTER_PORT = 1;
export const MAX_PRINTER_PORT = 65535;
export const MAX_VIRTUAL_PRINTER_SLOTS = 10;
export type PrinterCharacterSet = (typeof CharacterSet)[keyof typeof CharacterSet];
export const DEFAULT_PRINTER_CHARACTER_SET: PrinterCharacterSet = CharacterSet.PC858_EURO;

export interface NormalizedPrinterConfig {
    ip: string;
    port: number;
    isVirtual: boolean;
    emulatorSlot?: number;
}

export interface ResolvedPrinterDestination {
    host: string;
    port: number;
    label: string;
}

export interface EasterEggPrinterCandidate {
    _id: unknown;
    ip?: string;
    port?: number;
    isVirtual?: boolean;
    emulatorSlot?: number;
    type?: "CASHIER" | "KITCHEN";
}

type ValidationResult =
    | { success: true; data: NormalizedPrinterConfig }
    | { success: false; error: string };

function stringifyInput(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    return "";
}

export function getPrinterCharacterSet(): PrinterCharacterSet {
    const requested = stringifyInput(process.env.PRINTER_CHARACTER_SET).toUpperCase();
    const supported = new Set<PrinterCharacterSet>(Object.values(CharacterSet));
    if (requested && supported.has(requested as PrinterCharacterSet)) {
        return requested as PrinterCharacterSet;
    }

    return DEFAULT_PRINTER_CHARACTER_SET;
}

export function parsePrinterPort(value: unknown): number | null {
    const raw = stringifyInput(value);
    if (!raw) return DEFAULT_PRINTER_PORT;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < MIN_PRINTER_PORT || parsed > MAX_PRINTER_PORT) {
        return null;
    }

    return parsed;
}

export function parseEmulatorSlot(value: unknown): number | undefined | null {
    const raw = stringifyInput(value);
    if (!raw) return undefined;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_VIRTUAL_PRINTER_SLOTS) {
        return null;
    }

    return parsed;
}

export function formatPrinterDestination(ip: string, port?: number): string {
    const normalizedPort = port ?? DEFAULT_PRINTER_PORT;
    return `${ip}:${normalizedPort}`;
}

export function toTcpPrinterInterface(ip: string, port?: number): string {
    return `tcp://${formatPrinterDestination(ip, port)}`;
}

export function getVirtualPrinterHost(): string {
    const envHost = stringifyInput(process.env.PRINTER_EMULATOR_HOST);
    if (envHost) return envHost;
    return "127.0.0.1";
}

export function getVirtualPrinterStartPort(): number {
    const parsed = Number(process.env.PRINTER_EMULATOR_START_PORT || String(DEFAULT_EMULATOR_START_PORT));
    if (!Number.isInteger(parsed) || parsed < MIN_PRINTER_PORT || parsed > MAX_PRINTER_PORT) {
        return DEFAULT_EMULATOR_START_PORT;
    }
    return parsed;
}

export function resolvePrinterDestination(input: {
    ip?: string;
    port?: number;
    isVirtual?: boolean;
    emulatorSlot?: number;
}): ResolvedPrinterDestination {
    if (input.isVirtual) {
        const host = getVirtualPrinterHost();
        const startPort = getVirtualPrinterStartPort();
        const slotPort = typeof input.emulatorSlot === "number"
            ? startPort + (input.emulatorSlot - 1)
            : undefined;
        const port = slotPort || input.port || startPort;
        return {
            host,
            port,
            label: formatPrinterDestination(host, port)
        };
    }

    const host = (input.ip || "").trim();
    const port = input.port || DEFAULT_PRINTER_PORT;
    return {
        host,
        port,
        label: host ? formatPrinterDestination(host, port) : "missing-destination"
    };
}

export function selectBestEasterEggPrinter(
    printers: EasterEggPrinterCandidate[],
    preferredIp?: string
): EasterEggPrinterCandidate | null {
    const normalizedPreferredIp = stringifyInput(preferredIp);
    if (normalizedPreferredIp) {
        const byPreferredIp = printers.find((printer) => stringifyInput(printer.ip) === normalizedPreferredIp);
        if (byPreferredIp) return byPreferredIp;
    }

    const cashier = printers.find((printer) => printer.type === "CASHIER");
    if (cashier) return cashier;
    return printers[0] || null;
}

export function normalizePrinterConfig(input: {
    ip: unknown;
    port: unknown;
    isVirtual: boolean;
    emulatorSlot: unknown;
}): ValidationResult {
    const ip = stringifyInput(input.ip);
    if (!ip) {
        return { success: false, error: "Indirizzo IP/Host obbligatorio" };
    }

    const port = parsePrinterPort(input.port);
    if (port === null) {
        return { success: false, error: `Porta non valida (${MIN_PRINTER_PORT}-${MAX_PRINTER_PORT})` };
    }

    const parsedSlot = parseEmulatorSlot(input.emulatorSlot);
    if (parsedSlot === null) {
        return { success: false, error: `Slot emulatore non valido (1-${MAX_VIRTUAL_PRINTER_SLOTS})` };
    }

    if (input.isVirtual && typeof parsedSlot === "undefined") {
        return { success: false, error: "Per una stampante virtuale lo slot emulatore è obbligatorio" };
    }

    return {
        success: true,
        data: {
            ip,
            port,
            isVirtual: input.isVirtual,
            emulatorSlot: input.isVirtual ? parsedSlot : undefined
        }
    };
}
