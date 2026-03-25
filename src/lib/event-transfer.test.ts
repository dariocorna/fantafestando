import { describe, expect, test } from "vitest";
import { getTransferTimestamp, sanitizeTransferFileNameSegment } from "@/lib/event-transfer";

describe("event transfer helpers", () => {
  test("sanitizes event names into filesystem-safe segments", () => {
    expect(sanitizeTransferFileNameSegment("Sagra dèi Tórtèi 2027!!!")).toBe("Sagra-dei-Tortei-2027");
    expect(sanitizeTransferFileNameSegment("   ")).toBe("evento");
  });

  test("formats timestamps for bundle file names", () => {
    const date = new Date(2026, 2, 25, 14, 5, 9);
    expect(getTransferTimestamp(date)).toBe("20260325-140509");
  });
});
