import { afterEach, describe, expect, test, vi } from "vitest";
import {
    DEFAULT_EMULATOR_START_PORT,
    DEFAULT_PRINTER_CHARACTER_SET,
    DEFAULT_PRINTER_PORT,
    formatPrinterDestination,
    getPrinterCharacterSet,
    getVirtualPrinterHost,
    getVirtualPrinterStartPort,
    normalizePrinterConfig,
    parseEmulatorSlot,
    parsePrinterPort,
    resolvePrinterDestination,
    toTcpPrinterInterface
} from "@/lib/printer-config";

describe("printer-config", () => {
    afterEach(() => {
        delete process.env.PRINTER_CHARACTER_SET;
        vi.restoreAllMocks();
    });

    test("parsePrinterPort uses default when empty", () => {
        expect(parsePrinterPort("")).toBe(DEFAULT_PRINTER_PORT);
        expect(parsePrinterPort(null)).toBe(DEFAULT_PRINTER_PORT);
    });

    test("parsePrinterPort rejects invalid values", () => {
        expect(parsePrinterPort("0")).toBeNull();
        expect(parsePrinterPort("65536")).toBeNull();
        expect(parsePrinterPort("abc")).toBeNull();
    });

    test("parseEmulatorSlot supports optional empty value", () => {
        expect(parseEmulatorSlot("")).toBeUndefined();
        expect(parseEmulatorSlot(undefined)).toBeUndefined();
        expect(parseEmulatorSlot("3")).toBe(3);
        expect(parseEmulatorSlot("11")).toBeNull();
    });

    test("normalizePrinterConfig validates virtual slot", () => {
        const missingSlot = normalizePrinterConfig({
            ip: "printer-emulator",
            port: 19100,
            isVirtual: true,
            emulatorSlot: ""
        });

        expect(missingSlot.success).toBe(false);
        if (!missingSlot.success) {
            expect(missingSlot.error).toMatch(/slot emulatore/i);
        }
    });

    test("normalizePrinterConfig returns normalized values", () => {
        const result = normalizePrinterConfig({
            ip: " 192.168.1.20 ",
            port: "9100",
            isVirtual: false,
            emulatorSlot: ""
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({
                ip: "192.168.1.20",
                port: 9100,
                isVirtual: false,
                emulatorSlot: undefined
            });
        }
    });

    test("format and tcp helpers include port", () => {
        expect(formatPrinterDestination("printer-emulator", 19100)).toBe("printer-emulator:19100");
        expect(toTcpPrinterInterface("printer-emulator", 19100)).toBe("tcp://printer-emulator:19100");
    });

    test("virtual destination resolves to emulator host and slot port", () => {
        const destination = resolvePrinterDestination({
            ip: "192.168.1.200",
            port: 9100,
            isVirtual: true,
            emulatorSlot: 3
        });

        expect(destination.host).toBe(getVirtualPrinterHost());
        expect(destination.port).toBe(getVirtualPrinterStartPort() + 2);
    });

    test("non virtual destination keeps configured host and port", () => {
        const destination = resolvePrinterDestination({
            ip: "192.168.1.200",
            port: 9100,
            isVirtual: false
        });

        expect(destination).toEqual({
            host: "192.168.1.200",
            port: 9100,
            label: "192.168.1.200:9100"
        });
    });

    test("emulator start port fallback stays valid", () => {
        expect(getVirtualPrinterStartPort()).toBeGreaterThanOrEqual(DEFAULT_EMULATOR_START_PORT);
    });
});

describe("printer-config character set", () => {
    afterEach(() => {
        delete process.env.PRINTER_CHARACTER_SET;
        vi.restoreAllMocks();
    });

    test("defaults to the western europe esc/pos code page", () => {
        delete process.env.PRINTER_CHARACTER_SET;
        expect(getPrinterCharacterSet()).toBe(DEFAULT_PRINTER_CHARACTER_SET);
    });

    test("accepts a supported override from env", () => {
        process.env.PRINTER_CHARACTER_SET = "WPC1252";
        expect(getPrinterCharacterSet()).toBe("WPC1252");
    });

    test("falls back to default when env contains an unknown code page", () => {
        process.env.PRINTER_CHARACTER_SET = "NOPE";
        expect(getPrinterCharacterSet()).toBe(DEFAULT_PRINTER_CHARACTER_SET);
    });
});
