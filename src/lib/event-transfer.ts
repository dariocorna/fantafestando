import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dbConnect from "@/lib/mongoose";
import { normalizeAvailableDays } from "@/lib/product-availability";
import { normalizeStockQuantity } from "@/lib/inventory";
import { getAppVersion, getAppVersionLabel } from "@/lib/app-version";
import {
  getManagedUploadConfig,
  resolveManagedUploadPath,
  resolveManagedUploadUrl,
  type ManagedUploadKind,
} from "@/lib/managed-upload";
import Category from "@/models/Category";
import Event from "@/models/Event";
import Ingredient from "@/models/Ingredient";
import Peripheral from "@/models/Peripheral";
import PosDevice from "@/models/PosDevice";
import Printer from "@/models/Printer";
import Product from "@/models/Product";

export const EVENT_TRANSFER_FORMAT = "event-transfer-bundle-v1";
export const EVENT_TRANSFER_PREFIX = "fantafestando-event";

const MANAGED_ASSET_DEFINITIONS = {
  menuHeaderLogoUrl: {
    uploadKind: "menuHeaders",
    bundlePrefix: "menu-header",
    importPrefix: "menu-header-import",
  },
  receiptHeaderLogoUrl: {
    uploadKind: "receiptHeaders",
    bundlePrefix: "receipt-header",
    importPrefix: "receipt-header-import",
  },
  portalEasterEggImageUrl: {
    uploadKind: "easterEggs",
    bundlePrefix: "portal-easter-egg",
    importPrefix: "portal-easter-egg-import",
  },
} as const satisfies Record<string, {
  uploadKind: ManagedUploadKind;
  bundlePrefix: string;
  importPrefix: string;
}>;

type ManagedAssetSettingKey = keyof typeof MANAGED_ASSET_DEFINITIONS;

type ExportedEventSettings = {
  askName: boolean;
  askTable: boolean;
  posCatalogLayout?: "COMPACT_COLUMNS" | "MODERN_TABS";
  menuHeaderLogoUrl?: string;
  menuHeaderLogoAssetPath?: string;
  receiptHeaderLogoUrl?: string;
  receiptHeaderLogoAssetPath?: string;
  portalEasterEggEnabled?: boolean;
  portalEasterEggImageUrl?: string;
  portalEasterEggImageAssetPath?: string;
  portalEasterEggCrop?: {
    centerX: number;
    centerY: number;
    zoom: number;
    aspectRatio: "PORTRAIT_3_4" | "SQUARE_1_1" | "THERMAL_58";
  };
  portalEasterEggProcessing?: {
    autoEnhance: boolean;
    brightnessBoost: number;
    thresholdBase: number;
  };
  defaultCashierPrinterIp?: string;
  timezone?: string;
  quickDiscountPresets?: Array<{
    label: string;
    type: "PERCENT" | "FIXED";
    value: number;
  }>;
  quickStaffDiscountEnabled?: boolean;
  quickStaffDiscountLabel?: string;
  quickStaffDiscountType?: "PERCENT" | "FIXED";
  quickStaffDiscountValue?: number;
};

interface EventTransferManifest {
  format: string;
  exportedAt: string;
  bundleName: string;
  sourceEventId: string;
  sourceEventName: string;
  sourceEventArchived: boolean;
  appVersion: string;
  appRelease: string;
  counts: {
    printers: number;
    peripherals: number;
    categories: number;
    ingredients: number;
    products: number;
    posDevices: number;
  };
}

interface ExportedEventPayload {
  name: string;
  archived: boolean;
  settings: ExportedEventSettings;
  predefinedTables: string[];
}

interface ExportedPrinter {
  bundleId: string;
  name: string;
  ip: string;
  port: number;
  isVirtual: boolean;
  emulatorSlot?: number;
  type: "CASHIER" | "KITCHEN";
}

interface ExportedPeripheral {
  bundleId: string;
  name: string;
  type: "SUMUP" | "CASH_BOX" | "ELECTRONIC_MANUAL" | "OTHER";
  config: Record<string, unknown>;
}

interface ExportedCategory {
  bundleId: string;
  name: string;
  uiColor: string;
  printOrder: number;
  printerBundleId?: string;
  skipKitchenPrint: boolean;
  printKitchenCopyAtCashier: boolean;
  pizzaFlowEnabled: boolean;
  pizzaBarcodeEnabled: boolean;
}

interface ExportedIngredient {
  bundleId: string;
  name: string;
  shortName?: string;
  stockQuantity: number | null;
  sortOrder?: number;
  active: boolean;
}

interface ExportedProductComponent {
  productBundleId: string;
  quantity: number;
}

interface ExportedProductChoiceOption {
  productBundleId: string;
  quantity: number;
}

interface ExportedProduct {
  bundleId: string;
  categoryBundleId: string;
  name: string;
  shortName?: string;
  description?: string;
  basePrice: number;
  volunteerPrice?: number | null;
  kind: "STANDARD" | "FIXED_MENU";
  availableOnlyInMenus: boolean;
  salesChannels: Array<"POS" | "MENU">;
  isSoldOut: boolean;
  stockQuantity: number | null;
  availableDays: string[];
  recipeItems: Array<{
    ingredientBundleId: string;
    quantity: number;
  }>;
  menuComponents: ExportedProductComponent[];
  menuChoiceGroups: Array<{
    id: string;
    name: string;
    minSelections: number;
    maxSelections: number;
    options: ExportedProductChoiceOption[];
  }>;
  variants: Array<{
    optionName: string;
    priceVariation: number;
    stockQuantity?: number | null;
  }>;
}

interface ExportedPosDevice {
  bundleId: string;
  name: string;
  printerBundleId?: string;
  paymentTerminalBundleId?: string;
  cashBoxBundleId?: string;
}

interface EventTransferBundlePayload {
  manifest: EventTransferManifest;
  event: ExportedEventPayload;
  printers: ExportedPrinter[];
  peripherals: ExportedPeripheral[];
  categories: ExportedCategory[];
  ingredients: ExportedIngredient[];
  products: ExportedProduct[];
  posDevices: ExportedPosDevice[];
}

export interface GeneratedEventTransferBundle {
  fileName: string;
  filePath: string;
  manifest: EventTransferManifest;
  cleanup: () => Promise<void>;
}

export interface ImportedEventTransferResult {
  newEventId: string;
  newEventName: string;
  imported: {
    printers: number;
    peripherals: number;
    categories: number;
    ingredients: number;
    products: number;
    posDevices: number;
  };
}

type RestoredManagedAssetResult = {
  url?: string;
  filePath?: string;
};

export function sanitizeTransferFileNameSegment(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "evento";
}

export function getTransferTimestamp(value: Date) {
  const yyyy = value.getFullYear();
  const mm = `${value.getMonth() + 1}`.padStart(2, "0");
  const dd = `${value.getDate()}`.padStart(2, "0");
  const hh = `${value.getHours()}`.padStart(2, "0");
  const min = `${value.getMinutes()}`.padStart(2, "0");
  const sec = `${value.getSeconds()}`.padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

async function pathExists(targetPath: string) {
  try {
    await stat(/* turbopackIgnore: true */ targetPath);
    return true;
  } catch {
    return false;
  }
}

function isPathWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function runTarArchive(bundleRootDir: string, bundleDirName: string, outputFilePath: string) {
  await mkdir(path.dirname(outputFilePath), { recursive: true });

  const child = spawn("tar", ["-czf", outputFilePath, "-C", bundleRootDir, bundleDirName], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = (await once(child, "close")) as [number];
  if (code !== 0) {
    throw new Error(stderr.trim() || "Impossibile creare il bundle della festa.");
  }
}

async function extractTarArchive(bundleFilePath: string, outputDir: string) {
  const child = spawn("tar", ["-xzf", bundleFilePath, "-C", outputDir, "--no-same-owner", "--no-same-permissions"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = (await once(child, "close")) as [number];
  if (code !== 0) {
    throw new Error(stderr.trim() || "Impossibile estrarre il bundle della festa.");
  }
}

async function copyManagedAssetIntoBundle(
  bundleAssetsDir: string,
  settingKey: ManagedAssetSettingKey,
  url: string
) {
  const definition = MANAGED_ASSET_DEFINITIONS[settingKey];
  const source = resolveManagedUploadUrl(url, [definition.uploadKind]);
  if (!source) {
    return { exportedUrl: url };
  }

  if (!(await pathExists(source.filePath))) {
    throw new Error(`Asset mancante sul disco per ${settingKey}: ${url}`);
  }

  const extension = path.extname(source.fileName) || ".bin";
  const targetFileName = `${definition.bundlePrefix}${extension.toLowerCase()}`;
  const bundleAssetPath = path.posix.join("assets", targetFileName);
  const bundleAssetFilePath = path.join(/* turbopackIgnore: true */ bundleAssetsDir, targetFileName);
  await copyFile(
    /* turbopackIgnore: true */ source.filePath,
    /* turbopackIgnore: true */ bundleAssetFilePath
  );

  return {
    exportedAssetPath: bundleAssetPath,
  };
}

async function exportEventSettingsWithAssets(
  bundleAssetsDir: string,
  rawSettings: Record<string, unknown> | null | undefined
): Promise<ExportedEventSettings> {
  const settings = rawSettings || {};
  const exportedSettings: ExportedEventSettings = {
    askName: Boolean(settings.askName),
    askTable: Boolean(settings.askTable),
    posCatalogLayout:
      settings.posCatalogLayout === "MODERN_TABS" ? "MODERN_TABS" : "COMPACT_COLUMNS",
    portalEasterEggEnabled: Boolean(settings.portalEasterEggEnabled),
    portalEasterEggCrop: settings.portalEasterEggCrop as ExportedEventSettings["portalEasterEggCrop"],
    portalEasterEggProcessing:
      settings.portalEasterEggProcessing as ExportedEventSettings["portalEasterEggProcessing"],
    defaultCashierPrinterIp: normalizeOptionalString(settings.defaultCashierPrinterIp),
    timezone: normalizeOptionalString(settings.timezone) || "Europe/Rome",
    quickDiscountPresets: Array.isArray(settings.quickDiscountPresets)
      ? (settings.quickDiscountPresets as ExportedEventSettings["quickDiscountPresets"])
      : [],
    quickStaffDiscountEnabled: Boolean(settings.quickStaffDiscountEnabled),
    quickStaffDiscountLabel: normalizeOptionalString(settings.quickStaffDiscountLabel),
    quickStaffDiscountType:
      settings.quickStaffDiscountType === "FIXED" ? "FIXED" : "PERCENT",
    quickStaffDiscountValue:
      typeof settings.quickStaffDiscountValue === "number" ? settings.quickStaffDiscountValue : undefined,
  };

  for (const settingKey of Object.keys(MANAGED_ASSET_DEFINITIONS) as ManagedAssetSettingKey[]) {
    const currentUrl = normalizeOptionalString(settings[settingKey]);
    if (!currentUrl) continue;

    const exportedAsset = await copyManagedAssetIntoBundle(bundleAssetsDir, settingKey, currentUrl);
    if (settingKey === "menuHeaderLogoUrl") {
      exportedSettings.menuHeaderLogoUrl = exportedAsset.exportedUrl;
      exportedSettings.menuHeaderLogoAssetPath = exportedAsset.exportedAssetPath;
    }
    if (settingKey === "receiptHeaderLogoUrl") {
      exportedSettings.receiptHeaderLogoUrl = exportedAsset.exportedUrl;
      exportedSettings.receiptHeaderLogoAssetPath = exportedAsset.exportedAssetPath;
    }
    if (settingKey === "portalEasterEggImageUrl") {
      exportedSettings.portalEasterEggImageUrl = exportedAsset.exportedUrl;
      exportedSettings.portalEasterEggImageAssetPath = exportedAsset.exportedAssetPath;
    }
  }

  return exportedSettings;
}

async function restoreManagedAssetFromBundle(
  bundleDirPath: string,
  settingKey: ManagedAssetSettingKey,
  bundleAssetPath?: string,
  fallbackUrl?: string
): Promise<RestoredManagedAssetResult> {
  if (!bundleAssetPath) {
    return { url: fallbackUrl };
  }

  const definition = MANAGED_ASSET_DEFINITIONS[settingKey];
  const sourcePath = path.resolve(/* turbopackIgnore: true */ bundleDirPath, bundleAssetPath);
  if (!isPathWithinRoot(bundleDirPath, sourcePath)) {
    throw new Error(`Percorso asset non valido nel bundle per ${settingKey}.`);
  }
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Asset mancante nel bundle per ${settingKey}.`);
  }

  const uploadConfig = getManagedUploadConfig(definition.uploadKind);
  await mkdir(uploadConfig.directoryPath, { recursive: true });
  const extension = path.extname(sourcePath) || ".bin";
  const fileName = `${definition.importPrefix}-${Date.now()}-${randomUUID()}${extension.toLowerCase()}`;
  const target = resolveManagedUploadPath(definition.uploadKind, fileName);
  if (!target) {
    throw new Error(`Nome asset non valido nel bundle per ${settingKey}.`);
  }
  await copyFile(
    /* turbopackIgnore: true */ sourcePath,
    /* turbopackIgnore: true */ target.filePath
  );
  return {
    url: target.url,
    filePath: target.filePath,
  };
}

async function deleteImportedEventCascade(eventId: string) {
  await Promise.all([
    PosDevice.deleteMany({ eventId }),
    Peripheral.deleteMany({ eventId }),
    Printer.deleteMany({ eventId }),
    Product.deleteMany({ eventId }),
    Ingredient.deleteMany({ eventId }),
    Category.deleteMany({ eventId }),
    Event.deleteOne({ _id: eventId }),
  ]);
}

function getMappedIdOrThrow(
  sourceEntityName: string,
  sourceBundleId: string,
  map: Map<string, string>,
  targetEntityName: string
) {
  const mappedId = map.get(sourceBundleId);
  if (!mappedId) {
    throw new Error(
      `Riferimento ${targetEntityName} non risolto per ${sourceEntityName}: ${sourceBundleId}`
    );
  }
  return mappedId;
}

export async function buildEventTransferBundle(eventId: string): Promise<GeneratedEventTransferBundle> {
  await dbConnect();

  const event = (await Event.findById(eventId).lean()) as Record<string, unknown> | null;
  if (!event) {
    throw new Error("Festa non trovata.");
  }

  const [printers, peripherals, categories, ingredients, products, posDevices] = await Promise.all([
    Printer.find({ eventId }).sort({ name: 1 }).lean(),
    Peripheral.find({ eventId }).sort({ name: 1 }).lean(),
    Category.find({ eventId }).sort({ printOrder: 1, name: 1 }).lean(),
    Ingredient.find({ eventId }).sort({ name: 1 }).lean(),
    Product.find({ eventId }).sort({ name: 1 }).lean(),
    PosDevice.find({ eventId }).sort({ name: 1 }).lean(),
  ]);

  const now = new Date();
  const timestamp = getTransferTimestamp(now);
  const fileName = `${EVENT_TRANSFER_PREFIX}-${sanitizeTransferFileNameSegment(String(event.name || "evento"))}-${timestamp}.tar.gz`;
  const bundleDirName = fileName.replace(/\.tar\.gz$/, "");
  const tempRoot = await mkdtemp(path.join(/* turbopackIgnore: true */ tmpdir(), "fantafestando-event-transfer-"));
  const bundleDirPath = path.join(/* turbopackIgnore: true */ tempRoot, bundleDirName);
  const bundleAssetsDir = path.join(/* turbopackIgnore: true */ bundleDirPath, "assets");
  const bundlePayloadPath = path.join(/* turbopackIgnore: true */ bundleDirPath, "event-transfer.json");
  const archiveFilePath = path.join(/* turbopackIgnore: true */ tempRoot, fileName);

  await mkdir(bundleAssetsDir, { recursive: true });

  const payload: EventTransferBundlePayload = {
    manifest: {
      format: EVENT_TRANSFER_FORMAT,
      exportedAt: now.toISOString(),
      bundleName: fileName,
      sourceEventId: String(event._id),
      sourceEventName: String(event.name || "Evento"),
      sourceEventArchived: Boolean(event.archived),
      appVersion: getAppVersion(),
      appRelease: getAppVersionLabel(),
      counts: {
        printers: printers.length,
        peripherals: peripherals.length,
        categories: categories.length,
        ingredients: ingredients.length,
        products: products.length,
        posDevices: posDevices.length,
      },
    },
    event: {
      name: String(event.name || "Evento"),
      archived: Boolean(event.archived),
      settings: await exportEventSettingsWithAssets(
        bundleAssetsDir,
        (event.settings as Record<string, unknown> | undefined) || undefined
      ),
      predefinedTables: Array.isArray(event.predefinedTables)
        ? event.predefinedTables.filter((value): value is string => typeof value === "string")
        : [],
    },
    printers: printers.map((printer) => ({
      bundleId: String(printer._id),
      name: String(printer.name || "Stampante"),
      ip: String(printer.ip || ""),
      port: typeof printer.port === "number" ? printer.port : 9100,
      isVirtual: Boolean(printer.isVirtual),
      emulatorSlot: typeof printer.emulatorSlot === "number" ? printer.emulatorSlot : undefined,
      type: printer.type === "CASHIER" ? "CASHIER" : "KITCHEN",
    })),
    peripherals: peripherals.map((peripheral) => ({
      bundleId: String(peripheral._id),
      name: String(peripheral.name || "Periferica"),
      type:
        peripheral.type === "SUMUP" ||
        peripheral.type === "CASH_BOX" ||
        peripheral.type === "ELECTRONIC_MANUAL"
          ? peripheral.type
          : "OTHER",
      config:
        peripheral.config && typeof peripheral.config === "object"
          ? (peripheral.config as Record<string, unknown>)
          : {},
    })),
    categories: categories.map((category) => ({
      bundleId: String(category._id),
      name: String(category.name || "Categoria"),
      uiColor: String(category.uiColor || "#94a3b8"),
      printOrder: typeof category.printOrder === "number" ? category.printOrder : 0,
      printerBundleId: normalizeOptionalString(category.printerId ? String(category.printerId) : undefined),
      skipKitchenPrint: Boolean(category.skipKitchenPrint),
      printKitchenCopyAtCashier: Boolean(category.printKitchenCopyAtCashier),
      pizzaFlowEnabled: Boolean(category.pizzaFlowEnabled),
      pizzaBarcodeEnabled: Boolean(category.pizzaBarcodeEnabled),
    })),
    ingredients: ingredients.map((ingredient) => ({
      bundleId: String(ingredient._id),
      name: String(ingredient.name || "Ingrediente"),
      shortName: normalizeOptionalString(ingredient.shortName),
      stockQuantity: normalizeStockQuantity((ingredient.stockQuantity as number | null | undefined) ?? null),
      active: Boolean(ingredient.active),
    })),
    products: products.map((product) => ({
      bundleId: String(product._id),
      categoryBundleId: String(product.categoryId),
      name: String(product.name || "Prodotto"),
      shortName: normalizeOptionalString(product.shortName),
      description: normalizeOptionalString(product.description),
      basePrice: typeof product.basePrice === "number" ? product.basePrice : 0,
      volunteerPrice: typeof product.volunteerPrice === "number" ? product.volunteerPrice : null,
      kind: product.kind === "FIXED_MENU" ? "FIXED_MENU" : "STANDARD",
      availableOnlyInMenus: Boolean(product.availableOnlyInMenus),
      salesChannels: Array.isArray(product.salesChannels)
        ? product.salesChannels.filter((value: unknown): value is "POS" | "MENU" => value === "POS" || value === "MENU")
        : ["POS", "MENU"],
      isSoldOut: Boolean(product.isSoldOut),
      stockQuantity: normalizeStockQuantity((product.stockQuantity as number | null | undefined) ?? null),
      availableDays: normalizeAvailableDays((product.availableDays as string[] | undefined) || []),
      recipeItems: Array.isArray(product.recipeItems)
        ? product.recipeItems.map((entry: Record<string, unknown>) => ({
            ingredientBundleId: String(entry.ingredientId),
            quantity: typeof entry.quantity === "number" ? entry.quantity : 1,
          }))
        : [],
      menuComponents: Array.isArray(product.menuComponents)
        ? product.menuComponents.map((component: Record<string, unknown>) => ({
            productBundleId: String(component.productId),
            quantity: typeof component.quantity === "number" ? component.quantity : 1,
          }))
        : [],
      menuChoiceGroups: Array.isArray(product.menuChoiceGroups)
        ? product.menuChoiceGroups.map((group: Record<string, unknown>) => ({
            id: String(group.id || randomUUID()),
            name: String(group.name || "Scelta"),
            minSelections: typeof group.minSelections === "number" ? group.minSelections : 0,
            maxSelections: typeof group.maxSelections === "number" ? group.maxSelections : 1,
            options: Array.isArray(group.options)
              ? group.options.map((option: Record<string, unknown>) => ({
                  productBundleId: String(option.productId),
                  quantity: typeof option.quantity === "number" ? option.quantity : 1,
                }))
              : [],
          }))
        : [],
      variants: Array.isArray(product.variants)
        ? product.variants.map((variant: Record<string, unknown>) => ({
            optionName: String(variant.optionName || "Variante"),
            priceVariation: typeof variant.priceVariation === "number" ? variant.priceVariation : 0,
            stockQuantity: normalizeStockQuantity((variant.stockQuantity as number | null | undefined) ?? null),
          }))
        : [],
    })),
    posDevices: posDevices.map((posDevice) => ({
      bundleId: String(posDevice._id),
      name: String(posDevice.name || "Cassa"),
      printerBundleId: normalizeOptionalString(posDevice.printerId ? String(posDevice.printerId) : undefined),
      paymentTerminalBundleId: normalizeOptionalString(
        posDevice.paymentTerminalId ? String(posDevice.paymentTerminalId) : undefined
      ),
      cashBoxBundleId: normalizeOptionalString(posDevice.cashBoxId ? String(posDevice.cashBoxId) : undefined),
    })),
  };

  await writeFile(
    /* turbopackIgnore: true */ bundlePayloadPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  await runTarArchive(tempRoot, bundleDirName, archiveFilePath);

  return {
    fileName,
    filePath: archiveFilePath,
    manifest: payload.manifest,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

export async function importEventTransferBundle(
  bundleFilePath: string,
  newEventName: string
): Promise<ImportedEventTransferResult> {
  const normalizedNewEventName = newEventName.trim();
  if (!normalizedNewEventName) {
    throw new Error("Nome nuova festa obbligatorio.");
  }

  const extractRoot = await mkdtemp(path.join(/* turbopackIgnore: true */ tmpdir(), "fantafestando-event-import-"));
  let createdEventId: string | null = null;
  const createdAssetPaths: string[] = [];

  try {
    await extractTarArchive(bundleFilePath, extractRoot);
    const bundleDirEntries = await readdir(/* turbopackIgnore: true */ extractRoot, { withFileTypes: true });
    const bundleDir = bundleDirEntries.find((entry) => entry.isDirectory());
    if (!bundleDir) {
      throw new Error("Bundle festa non valido: cartella radice mancante.");
    }

    const bundleDirPath = path.join(/* turbopackIgnore: true */ extractRoot, bundleDir.name);
    const payloadPath = path.join(/* turbopackIgnore: true */ bundleDirPath, "event-transfer.json");
    const payload = JSON.parse(
      await readFile(/* turbopackIgnore: true */ payloadPath, "utf8")
    ) as EventTransferBundlePayload;
    if (payload.manifest?.format !== EVENT_TRANSFER_FORMAT) {
      throw new Error(`Formato bundle non supportato: ${payload.manifest?.format || "sconosciuto"}`);
    }

    const importedSettings = payload.event.settings || { askName: false, askTable: false };
    const menuHeaderLogoAsset = await restoreManagedAssetFromBundle(
      bundleDirPath,
      "menuHeaderLogoUrl",
      importedSettings.menuHeaderLogoAssetPath,
      importedSettings.menuHeaderLogoUrl
    );
    const receiptHeaderLogoAsset = await restoreManagedAssetFromBundle(
      bundleDirPath,
      "receiptHeaderLogoUrl",
      importedSettings.receiptHeaderLogoAssetPath,
      importedSettings.receiptHeaderLogoUrl
    );
    const portalEasterEggImageAsset = await restoreManagedAssetFromBundle(
      bundleDirPath,
      "portalEasterEggImageUrl",
      importedSettings.portalEasterEggImageAssetPath,
      importedSettings.portalEasterEggImageUrl
    );
    if (menuHeaderLogoAsset.filePath) createdAssetPaths.push(menuHeaderLogoAsset.filePath);
    if (receiptHeaderLogoAsset.filePath) createdAssetPaths.push(receiptHeaderLogoAsset.filePath);
    if (portalEasterEggImageAsset.filePath) createdAssetPaths.push(portalEasterEggImageAsset.filePath);

    await dbConnect();

    const newEvent = await Event.create({
      name: normalizedNewEventName,
      active: false,
      archived: false,
      settings: {
        askName: Boolean(importedSettings.askName),
        askTable: Boolean(importedSettings.askTable),
        posCatalogLayout: importedSettings.posCatalogLayout === "MODERN_TABS" ? "MODERN_TABS" : "COMPACT_COLUMNS",
        menuHeaderLogoUrl: menuHeaderLogoAsset.url,
        receiptHeaderLogoUrl: receiptHeaderLogoAsset.url,
        portalEasterEggEnabled: Boolean(importedSettings.portalEasterEggEnabled),
        portalEasterEggImageUrl: portalEasterEggImageAsset.url,
        portalEasterEggCrop: importedSettings.portalEasterEggCrop,
        portalEasterEggProcessing: importedSettings.portalEasterEggProcessing,
        defaultCashierPrinterIp: importedSettings.defaultCashierPrinterIp,
        timezone: importedSettings.timezone || "Europe/Rome",
        quickDiscountPresets: Array.isArray(importedSettings.quickDiscountPresets)
          ? importedSettings.quickDiscountPresets
          : [],
        quickStaffDiscountEnabled: Boolean(importedSettings.quickStaffDiscountEnabled),
        quickStaffDiscountLabel: importedSettings.quickStaffDiscountLabel || "Staff",
        quickStaffDiscountType: importedSettings.quickStaffDiscountType === "FIXED" ? "FIXED" : "PERCENT",
        quickStaffDiscountValue:
          typeof importedSettings.quickStaffDiscountValue === "number"
            ? importedSettings.quickStaffDiscountValue
            : 50,
      },
      predefinedTables: Array.isArray(payload.event.predefinedTables) ? payload.event.predefinedTables : [],
    });
    createdEventId = String(newEvent._id);

    let importedPrinterCount = 0;
    const printerMap = new Map<string, string>();
    for (const printer of payload.printers || []) {
      const createdPrinter = await Printer.create({
        eventId: newEvent._id,
        name: printer.name,
        ip: printer.ip,
        port: typeof printer.port === "number" ? printer.port : 9100,
        isVirtual: Boolean(printer.isVirtual),
        emulatorSlot: typeof printer.emulatorSlot === "number" ? printer.emulatorSlot : undefined,
        type: printer.type === "CASHIER" ? "CASHIER" : "KITCHEN",
      });
      printerMap.set(printer.bundleId, String(createdPrinter._id));
      importedPrinterCount += 1;
    }

    let importedPeripheralCount = 0;
    const peripheralMap = new Map<string, string>();
    for (const peripheral of payload.peripherals || []) {
      const createdPeripheral = await Peripheral.create({
        eventId: newEvent._id,
        name: peripheral.name,
        type: peripheral.type,
        config: peripheral.config || {},
      });
      peripheralMap.set(peripheral.bundleId, String(createdPeripheral._id));
      importedPeripheralCount += 1;
    }

    let importedCategoryCount = 0;
    const categoryMap = new Map<string, string>();
    for (const category of payload.categories || []) {
      const createdCategory = await Category.create({
        eventId: newEvent._id,
        name: category.name,
        uiColor: category.uiColor,
        printOrder: typeof category.printOrder === "number" ? category.printOrder : 0,
        printerId: category.printerBundleId
          ? getMappedIdOrThrow("categoria", category.printerBundleId, printerMap, "stampante")
          : undefined,
        skipKitchenPrint: Boolean(category.skipKitchenPrint),
        printKitchenCopyAtCashier: Boolean(category.printKitchenCopyAtCashier),
        pizzaFlowEnabled: Boolean(category.pizzaFlowEnabled),
        pizzaBarcodeEnabled: Boolean(category.pizzaBarcodeEnabled),
      });
      categoryMap.set(category.bundleId, String(createdCategory._id));
      importedCategoryCount += 1;
    }

    let importedIngredientCount = 0;
    const ingredientMap = new Map<string, string>();
    for (const ingredient of payload.ingredients || []) {
      const createdIngredient = await Ingredient.create({
        eventId: newEvent._id,
        name: ingredient.name,
        shortName: ingredient.shortName,
        stockQuantity: normalizeStockQuantity(ingredient.stockQuantity ?? null),
        active: Boolean(ingredient.active),
      });
      ingredientMap.set(ingredient.bundleId, String(createdIngredient._id));
      importedIngredientCount += 1;
    }

    let importedProductCount = 0;
    const productMap = new Map<string, string>();
    for (const product of payload.products || []) {
      const productStockQuantity = normalizeStockQuantity(product.stockQuantity ?? null);
      const createdProduct = await Product.create({
        eventId: newEvent._id,
        categoryId: getMappedIdOrThrow("prodotto", product.categoryBundleId, categoryMap, "categoria"),
        name: product.name,
        shortName: product.shortName,
        description: product.description,
        basePrice: product.basePrice,
        volunteerPrice: typeof product.volunteerPrice === "number" ? product.volunteerPrice : null,
        kind: product.kind,
        availableOnlyInMenus: Boolean(product.availableOnlyInMenus),
        salesChannels: Array.isArray(product.salesChannels) ? product.salesChannels : ["POS", "MENU"],
        isSoldOut: productStockQuantity !== null ? productStockQuantity <= 0 : Boolean(product.isSoldOut),
        stockQuantity: productStockQuantity,
        availableDays: normalizeAvailableDays(product.availableDays || []),
        recipeItems: Array.isArray(product.recipeItems)
          ? product.recipeItems
              .map((entry) => ({
                ingredientId: getMappedIdOrThrow(
                  "ingrediente prodotto",
                  entry.ingredientBundleId,
                  ingredientMap,
                  "ingrediente"
                ),
                quantity: entry.quantity,
              }))
          : [],
        menuComponents: [],
        menuChoiceGroups: [],
        variants: Array.isArray(product.variants)
          ? product.variants.map((variant) => ({
              optionName: variant.optionName,
              priceVariation: variant.priceVariation,
              stockQuantity: normalizeStockQuantity(variant.stockQuantity ?? null),
            }))
          : [],
      });
      productMap.set(product.bundleId, String(createdProduct._id));
      importedProductCount += 1;
    }

    for (const product of payload.products || []) {
      const mappedProductId = productMap.get(product.bundleId);
      if (!mappedProductId) continue;

      await Product.updateOne(
        { _id: mappedProductId, eventId: newEvent._id },
        {
          $set: {
            menuComponents: Array.isArray(product.menuComponents)
              ? product.menuComponents
                  .map((component) => ({
                    productId: getMappedIdOrThrow(
                      "componente menu",
                      component.productBundleId,
                      productMap,
                      "prodotto"
                    ),
                    quantity: component.quantity,
                  }))
              : [],
            menuChoiceGroups: Array.isArray(product.menuChoiceGroups)
              ? product.menuChoiceGroups.map((group) => ({
                  id: group.id,
                  name: group.name,
                  minSelections: group.minSelections,
                  maxSelections: group.maxSelections,
                  options: Array.isArray(group.options)
                    ? group.options
                        .map((option) => ({
                          productId: getMappedIdOrThrow(
                            "opzione menu",
                            option.productBundleId,
                            productMap,
                            "prodotto"
                          ),
                          quantity: option.quantity,
                        }))
                    : [],
                }))
              : [],
          },
        }
      );
    }

    let importedPosDeviceCount = 0;
    for (const posDevice of payload.posDevices || []) {
      if (!posDevice.printerBundleId) {
        throw new Error(`Cassa senza stampante associata nel bundle: ${posDevice.name}`);
      }

      await PosDevice.create({
        eventId: newEvent._id,
        name: posDevice.name,
        printerId: getMappedIdOrThrow("cassa", posDevice.printerBundleId, printerMap, "stampante"),
        paymentTerminalId: posDevice.paymentTerminalBundleId
          ? getMappedIdOrThrow(
              "cassa",
              posDevice.paymentTerminalBundleId,
              peripheralMap,
              "terminale pagamento"
            )
          : undefined,
        cashBoxId: posDevice.cashBoxBundleId
          ? getMappedIdOrThrow("cassa", posDevice.cashBoxBundleId, peripheralMap, "cassetto")
          : undefined,
      });
      importedPosDeviceCount += 1;
    }

    return {
      newEventId: createdEventId,
      newEventName: normalizedNewEventName,
      imported: {
        printers: importedPrinterCount,
        peripherals: importedPeripheralCount,
        categories: importedCategoryCount,
        ingredients: importedIngredientCount,
        products: importedProductCount,
        posDevices: importedPosDeviceCount,
      },
    };
  } catch (error) {
    if (createdEventId) {
      await deleteImportedEventCascade(createdEventId).catch(() => undefined);
    }
    await Promise.all(createdAssetPaths.map((assetPath) => rm(assetPath, { force: true }).catch(() => undefined)));
    throw error;
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}
