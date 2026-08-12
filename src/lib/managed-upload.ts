import path from "node:path";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");
const SAFE_FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const MANAGED_UPLOADS = {
  menuHeaders: {
    directoryName: "menu-headers",
    directoryPath: path.join(UPLOADS_ROOT, "menu-headers"),
    urlPrefix: "/uploads/menu-headers",
    resolveFilePath: (fileName: string) =>
      path.join(process.cwd(), "public", "uploads", "menu-headers", fileName),
  },
  receiptHeaders: {
    directoryName: "receipt-headers",
    directoryPath: path.join(UPLOADS_ROOT, "receipt-headers"),
    urlPrefix: "/uploads/receipt-headers",
    resolveFilePath: (fileName: string) =>
      path.join(process.cwd(), "public", "uploads", "receipt-headers", fileName),
  },
  easterEggs: {
    directoryName: "easter-eggs",
    directoryPath: path.join(UPLOADS_ROOT, "easter-eggs"),
    urlPrefix: "/uploads/easter-eggs",
    resolveFilePath: (fileName: string) =>
      path.join(process.cwd(), "public", "uploads", "easter-eggs", fileName),
  },
} as const;

export type ManagedUploadKind = keyof typeof MANAGED_UPLOADS;

export interface ManagedUploadLocation {
  kind: ManagedUploadKind;
  fileName: string;
  filePath: string;
  url: string;
}

const MANAGED_UPLOAD_KINDS = Object.keys(MANAGED_UPLOADS) as ManagedUploadKind[];

export function getManagedUploadConfig(kind: ManagedUploadKind) {
  return MANAGED_UPLOADS[kind];
}

export function resolveManagedUploadPath(
  kind: ManagedUploadKind,
  fileName: string
): ManagedUploadLocation | undefined {
  if (!SAFE_FILE_NAME.test(fileName)) return undefined;

  const config = MANAGED_UPLOADS[kind];
  const filePath = config.resolveFilePath(fileName);
  const relativePath = path.relative(config.directoryPath, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return undefined;

  return {
    kind,
    fileName,
    filePath,
    url: `${config.urlPrefix}/${fileName}`,
  };
}

export function resolveManagedUploadSegments(
  segments: readonly string[]
): ManagedUploadLocation | undefined {
  if (segments.length !== 2) return undefined;

  const [directoryName, fileName] = segments;
  const kind = MANAGED_UPLOAD_KINDS.find(
    (candidate) => MANAGED_UPLOADS[candidate].directoryName === directoryName
  );
  return kind ? resolveManagedUploadPath(kind, fileName) : undefined;
}

export function resolveManagedUploadUrl(
  value: unknown,
  allowedKinds: readonly ManagedUploadKind[] = MANAGED_UPLOAD_KINDS
): ManagedUploadLocation | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    // Keep the original value so the filename validation below rejects it.
  }

  for (const kind of allowedKinds) {
    const prefix = `${MANAGED_UPLOADS[kind].urlPrefix}/`;
    if (!decoded.startsWith(prefix)) continue;
    return resolveManagedUploadPath(kind, decoded.slice(prefix.length));
  }

  return undefined;
}

export function resolveManagedUploadContentType(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
