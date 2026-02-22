import { describe, expect, it } from "vitest";
import { getOrderCodeFromOrder, parseOrderNumberInput } from "./order-code";

describe("order-code helpers", () => {
    it("parses numeric order input", () => {
        expect(parseOrderNumberInput("12")).toBe(12);
        expect(parseOrderNumberInput("0012")).toBe(12);
    });

    it("rejects non numeric order input", () => {
        expect(parseOrderNumberInput("AB12")).toBeNull();
        expect(parseOrderNumberInput("")).toBeNull();
        expect(parseOrderNumberInput("0")).toBeNull();
    });

    it("uses incremental pickup number when available", () => {
        expect(getOrderCodeFromOrder({ pickupNumber: 123, _id: "507f1f77bcf86cd799439011" })).toBe("123");
    });

    it("falls back to legacy ObjectId suffix", () => {
        expect(getOrderCodeFromOrder({ _id: "507f1f77bcf86cd799439011" })).toBe("9011");
    });
});
