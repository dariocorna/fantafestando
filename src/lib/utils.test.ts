import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
    it("merges tailwind classes by keeping the latest conflicting class", () => {
        expect(cn("text-sm", "text-lg")).toBe("text-lg");
    });

    it("supports conditional classes", () => {
        expect(cn("px-2", false && "py-2", true && "py-4")).toBe("px-2 py-4");
    });
});
