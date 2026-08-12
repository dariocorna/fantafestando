import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  getManagedUploadConfig,
  resolveManagedUploadContentType,
  resolveManagedUploadPath,
  resolveManagedUploadSegments,
  resolveManagedUploadUrl,
} from "@/lib/managed-upload";

describe("managed uploads", () => {
  test.each([
    ["menuHeaders", "menu-headers"],
    ["receiptHeaders", "receipt-headers"],
    ["easterEggs", "easter-eggs"],
  ] as const)("resolves the statically registered %s bucket", (kind, directoryName) => {
    const location = resolveManagedUploadPath(kind, "header-01.png");

    expect(location).toEqual({
      kind,
      fileName: "header-01.png",
      filePath: path.join(process.cwd(), "public", "uploads", directoryName, "header-01.png"),
      url: `/uploads/${directoryName}/header-01.png`,
    });
    expect(getManagedUploadConfig(kind).directoryName).toBe(directoryName);
  });

  test("resolves only registered two-segment upload paths", () => {
    expect(resolveManagedUploadSegments(["receipt-headers", "receipt.jpg"])?.kind).toBe("receiptHeaders");
    expect(resolveManagedUploadSegments(["other", "receipt.jpg"])).toBeUndefined();
    expect(resolveManagedUploadSegments(["menu-headers", "nested", "header.png"])).toBeUndefined();
  });

  test("rejects traversal, nested paths and invalid encoded filenames", () => {
    expect(resolveManagedUploadPath("menuHeaders", "../secret.png")).toBeUndefined();
    expect(resolveManagedUploadUrl("/uploads/menu-headers/../../secret.png")).toBeUndefined();
    expect(resolveManagedUploadUrl("/uploads/menu-headers/%2e%2e%2fsecret.png")).toBeUndefined();
    expect(resolveManagedUploadUrl("/uploads/menu-headers/%E0%A4%A")).toBeUndefined();
    expect(resolveManagedUploadUrl("/uploads/unknown/header.png")).toBeUndefined();
  });

  test("can constrain URL resolution to the expected asset family", () => {
    expect(resolveManagedUploadUrl("/uploads/easter-eggs/photo.jpeg", ["easterEggs"])?.fileName).toBe("photo.jpeg");
    expect(resolveManagedUploadUrl("/uploads/menu-headers/header.png", ["easterEggs"])).toBeUndefined();
  });

  test("preserves the upload route content types", () => {
    expect(resolveManagedUploadContentType("header.PNG")).toBe("image/png");
    expect(resolveManagedUploadContentType("header.jpeg")).toBe("image/jpeg");
    expect(resolveManagedUploadContentType("header.bin")).toBe("application/octet-stream");
  });
});
