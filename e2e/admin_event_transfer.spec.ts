import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import mongoose from "mongoose";
import Category from "../src/models/Category";
import Event from "../src/models/Event";
import Ingredient from "../src/models/Ingredient";
import Order from "../src/models/Order";
import Peripheral from "../src/models/Peripheral";
import PosDevice from "../src/models/PosDevice";
import Printer from "../src/models/Printer";
import Product from "../src/models/Product";
import { ensureAdminAuthenticated } from "./utils/auth";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";
import { uniqueSuffix } from "./utils/fixtures";

const MENU_VALID_IMAGE = path.join(process.cwd(), "e2e", "fixtures", "images", "menu-valid.png");
const RECEIPT_VALID_IMAGE = path.join(process.cwd(), "e2e", "fixtures", "images", "receipt-valid.jpg");

type SeededEventTransferFixture = {
  sourceEventId: string;
  sourceAssetUrls: string[];
  sourceProductIds: {
    panino: string;
    patatine: string;
    combo: string;
  };
};

async function seedManagedUpload(relativeUrl: string, sourceFilePath: string) {
  const absolutePath = path.join(process.cwd(), "public", relativeUrl.replace(/^\//, ""));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, await readFile(sourceFilePath));
  return absolutePath;
}

async function cleanupEventTransferArtifacts(eventNames: string[]) {
  const uploadPaths = new Set<string>();

  await ensureDbConnection();
  for (const eventName of eventNames) {
    const event = await Event.findOne({ name: eventName }).lean<{
      settings?: {
        menuHeaderLogoUrl?: string;
        receiptHeaderLogoUrl?: string;
        portalEasterEggImageUrl?: string;
      };
    } | null>();

    const urls = [
      event?.settings?.menuHeaderLogoUrl,
      event?.settings?.receiptHeaderLogoUrl,
      event?.settings?.portalEasterEggImageUrl,
    ].filter((value): value is string => typeof value === "string" && value.startsWith("/uploads/"));

    urls.forEach((relativeUrl) => {
      uploadPaths.add(path.join(process.cwd(), "public", relativeUrl.replace(/^\//, "")));
    });
  }

  await Promise.all(eventNames.map((eventName) => cleanupEventArtifactsByName(eventName)));
  await Promise.all([...uploadPaths].map((absolutePath) => unlink(absolutePath).catch(() => undefined)));
}

async function seedEventTransferFixture(sourceEventName: string, token: string): Promise<SeededEventTransferFixture> {
  await ensureDbConnection();
  const menuHeaderLogoUrl = `/uploads/menu-headers/e2e-transfer-menu-${token}.png`;
  const receiptHeaderLogoUrl = `/uploads/receipt-headers/e2e-transfer-receipt-${token}.jpg`;
  const portalEasterEggImageUrl = `/uploads/easter-eggs/e2e-transfer-egg-${token}.png`;

  await Promise.all([
    seedManagedUpload(menuHeaderLogoUrl, MENU_VALID_IMAGE),
    seedManagedUpload(receiptHeaderLogoUrl, RECEIPT_VALID_IMAGE),
    seedManagedUpload(portalEasterEggImageUrl, MENU_VALID_IMAGE),
  ]);

  const sourceEvent = await Event.create({
    name: sourceEventName,
    active: false,
    archived: false,
    settings: {
      askName: true,
      askTable: true,
      posCatalogLayout: "MODERN_TABS",
      menuHeaderLogoUrl,
      receiptHeaderLogoUrl,
      portalEasterEggEnabled: true,
      portalEasterEggImageUrl,
      portalEasterEggCrop: {
        centerX: 48,
        centerY: 52,
        zoom: 1.8,
        aspectRatio: "PORTRAIT_3_4",
      },
      portalEasterEggProcessing: {
        autoEnhance: true,
        brightnessBoost: 16,
        thresholdBase: 134,
      },
      defaultCashierPrinterIp: "127.0.0.21",
      timezone: "America/New_York",
      quickDiscountPresets: [
        { label: "Happy Hour", type: "PERCENT", value: 15 },
      ],
      quickStaffDiscountEnabled: true,
      quickStaffDiscountLabel: "Crew",
      quickStaffDiscountType: "FIXED",
      quickStaffDiscountValue: 2,
    },
    predefinedTables: ["A1", "B2", "C3"],
  });

  const sourceEventId = String(sourceEvent._id);

  const cashierPrinter = await Printer.create({
    eventId: sourceEventId,
    name: `Cassa 1 ${token}`,
    ip: "127.0.0.21",
    port: 19101,
    isVirtual: true,
    emulatorSlot: 1,
    type: "CASHIER",
  });
  const kitchenPrinter = await Printer.create({
    eventId: sourceEventId,
    name: `Cucina 1 ${token}`,
    ip: "127.0.0.22",
    port: 19102,
    isVirtual: true,
    emulatorSlot: 2,
    type: "KITCHEN",
  });

  const paymentPeripheral = await Peripheral.create({
    eventId: sourceEventId,
    name: `SumUp ${token}`,
    type: "SUMUP",
    config: {
      merchantCode: `merchant-${token}`,
      readerId: `reader-${token}`,
      apiKey: `encrypted-api-${token}`,
      affiliateAppId: `app-${token}`,
      affiliateKey: `encrypted-affiliate-${token}`,
    },
  });
  const cashBoxPeripheral = await Peripheral.create({
    eventId: sourceEventId,
    name: `CashBox ${token}`,
    type: "CASH_BOX",
    config: { mode: "manual" },
  });

  const category = await Category.create({
    eventId: sourceEventId,
    name: `Panini ${token}`,
    uiColor: "#1d4ed8",
    printOrder: 7,
    printerId: kitchenPrinter._id,
    skipKitchenPrint: false,
    printKitchenCopyAtCashier: true,
    pizzaFlowEnabled: true,
  });

  await Ingredient.create({
    eventId: sourceEventId,
    name: `Patate ${token}`,
    shortName: "PATA",
    stockQuantity: 40,
    active: true,
  });

  const panino = await Product.create({
    eventId: sourceEventId,
    categoryId: category._id,
    name: `Panino ${token}`,
    shortName: "PAN",
    description: "Panino principale",
    basePrice: 6.5,
    kind: "STANDARD",
    availableOnlyInMenus: false,
    salesChannels: ["POS", "MENU"],
    isSoldOut: false,
    stockQuantity: 20,
    availableDays: ["FRI", "SAT"],
    menuComponents: [],
    menuChoiceGroups: [],
    variants: [{ optionName: "XL", priceVariation: 1.5, stockQuantity: 5 }],
  });

  const patatine = await Product.create({
    eventId: sourceEventId,
    categoryId: category._id,
    name: `Patatine ${token}`,
    shortName: "PAT",
    description: "Contorno",
    basePrice: 3,
    kind: "STANDARD",
    availableOnlyInMenus: false,
    salesChannels: ["POS", "MENU"],
    isSoldOut: false,
    stockQuantity: 50,
    availableDays: ["FRI", "SAT"],
    menuComponents: [],
    menuChoiceGroups: [],
    variants: [],
  });

  const combo = await Product.create({
    eventId: sourceEventId,
    categoryId: category._id,
    name: `Menu Combo ${token}`,
    shortName: "COMBO",
    description: "Menu fisso",
    basePrice: 10,
    kind: "FIXED_MENU",
    availableOnlyInMenus: false,
    salesChannels: ["MENU"],
    isSoldOut: false,
    stockQuantity: null,
    availableDays: ["FRI", "SAT"],
    menuComponents: [{ productId: panino._id, quantity: 1 }],
    menuChoiceGroups: [
      {
        id: `side-${token}`,
        name: "Contorno",
        minSelections: 1,
        maxSelections: 1,
        options: [{ productId: patatine._id, quantity: 1 }],
      },
    ],
    variants: [],
  });

  const posDevice = await PosDevice.create({
    eventId: sourceEventId,
    name: `Cassa Centrale ${token}`,
    printerId: cashierPrinter._id,
    paymentTerminalId: paymentPeripheral._id,
    cashBoxId: cashBoxPeripheral._id,
  });

  await Order.create({
    eventId: sourceEventId,
    posDeviceId: posDevice._id,
    pickupNumber: 401,
    status: "PAID",
    customer: { name: "Mario", table: "A1" },
    totalAmount: 6.5,
    discountApplied: 0,
    paymentMethod: "CASH",
    cart: [
      {
        productId: panino._id,
        snapshotName: panino.name,
        quantity: 1,
        selectedOptions: [],
      },
    ],
  });

  return {
    sourceEventId,
    sourceAssetUrls: [menuHeaderLogoUrl, receiptHeaderLogoUrl, portalEasterEggImageUrl],
    sourceProductIds: {
      panino: String(panino._id),
      patatine: String(patatine._id),
      combo: String(combo._id),
    },
  };
}

test.describe("Admin event export/import", () => {
  let sourceEventName = "";
  let importedEventName = "";

  test.beforeEach(async ({ page }) => {
    await ensureAdminAuthenticated(page, "/admin/settings/events");
  });

  test.afterEach(async () => {
    const names = [sourceEventName, importedEventName].filter(Boolean);
    if (names.length > 0) {
      await cleanupEventTransferArtifacts(names);
    }
    sourceEventName = "";
    importedEventName = "";
  });

  test("exports an event bundle and imports it as a new inactive event with remapped data", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Flusso validato su desktop");

    const suffix = uniqueSuffix();
    sourceEventName = `Transfer Source ${suffix}`;
    importedEventName = `Transfer Imported ${suffix}`;
    const expectedCashierPrinterName = `Cassa 1 ${suffix}`;
    const expectedKitchenPrinterName = `Cucina 1 ${suffix}`;
    const expectedPaymentPeripheralName = `SumUp ${suffix}`;
    const expectedCashBoxPeripheralName = `CashBox ${suffix}`;
    const expectedCategoryName = `Panini ${suffix}`;
    const expectedPaninoName = `Panino ${suffix}`;
    const expectedPatatineName = `Patatine ${suffix}`;
    const expectedComboName = `Menu Combo ${suffix}`;
    const expectedPosDeviceName = `Cassa Centrale ${suffix}`;

    const seeded = await seedEventTransferFixture(sourceEventName, suffix);

    await page.goto("/admin/settings/events");
    const sourceCard = page.locator("div.p-4.border").filter({ hasText: sourceEventName }).first();
    await expect(sourceCard).toBeVisible({ timeout: 15000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      sourceCard.getByRole("link", { name: /Esporta/i }).click(),
    ]);

    const exportedBundlePath = testInfo.outputPath(`event-transfer-${suffix}.tar.gz`);
    await download.saveAs(exportedBundlePath);
    expect(existsSync(exportedBundlePath)).toBe(true);

    const exportedBundleListing = execFileSync("tar", ["-tzf", exportedBundlePath], { encoding: "utf8" });
    expect(exportedBundleListing).toContain("event-transfer.json");
    expect(exportedBundleListing).toContain("assets/menu-header.png");
    expect(exportedBundleListing).toContain("assets/receipt-header.jpg");
    expect(exportedBundleListing).toContain("assets/portal-easter-egg.png");

    await page.getByRole("button", { name: /Importa Festa/i }).click();
    const importDialog = page.getByRole("dialog");
    await expect(importDialog).toBeVisible();
    await importDialog.locator("#event-transfer-file").setInputFiles(exportedBundlePath);
    await importDialog.locator("#event-transfer-name").fill(importedEventName);
    await importDialog.getByRole("button", { name: /Avvia Import/i }).click();

    await expect(page.locator("div.p-4.border").filter({ hasText: importedEventName }).first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("div.p-4.border").filter({ hasText: importedEventName }).getByText(/Inattiva/i)).toBeVisible();

    await expect.poll(async () => {
      await ensureDbConnection();
      return await Event.exists({ name: importedEventName });
    }, { timeout: 30000 }).not.toBeNull();

    const importedEvent = await Event.findOne({ name: importedEventName }).lean<{
      _id: mongoose.Types.ObjectId;
      active: boolean;
      archived: boolean;
      predefinedTables?: string[];
      settings?: {
        askName?: boolean;
        askTable?: boolean;
        posCatalogLayout?: string;
        menuHeaderLogoUrl?: string;
        receiptHeaderLogoUrl?: string;
        portalEasterEggEnabled?: boolean;
        portalEasterEggImageUrl?: string;
        defaultCashierPrinterIp?: string;
        timezone?: string;
        quickDiscountPresets?: Array<{ label: string; value: number }>;
        quickStaffDiscountEnabled?: boolean;
        quickStaffDiscountLabel?: string;
        quickStaffDiscountType?: string;
        quickStaffDiscountValue?: number;
      };
    } | null>();

    expect(importedEvent).not.toBeNull();
    expect(importedEvent!.active).toBe(false);
    expect(importedEvent!.archived).toBe(false);
    expect(importedEvent!.predefinedTables).toEqual(["A1", "B2", "C3"]);
    expect(importedEvent!.settings).toMatchObject({
      askName: true,
      askTable: true,
      posCatalogLayout: "MODERN_TABS",
      portalEasterEggEnabled: true,
      defaultCashierPrinterIp: "127.0.0.21",
      timezone: "America/New_York",
      quickStaffDiscountEnabled: true,
      quickStaffDiscountLabel: "Crew",
      quickStaffDiscountType: "FIXED",
      quickStaffDiscountValue: 2,
    });
    expect(importedEvent!.settings?.quickDiscountPresets).toMatchObject([
      { label: "Happy Hour", value: 15 },
    ]);

    const importedAssetUrls = [
      importedEvent!.settings?.menuHeaderLogoUrl,
      importedEvent!.settings?.receiptHeaderLogoUrl,
      importedEvent!.settings?.portalEasterEggImageUrl,
    ];
    importedAssetUrls.forEach((relativeUrl, index) => {
      expect(relativeUrl).toBeTruthy();
      expect(relativeUrl).not.toBe(seeded.sourceAssetUrls[index]);
      expect(relativeUrl).toMatch(/^\/uploads\//);
      expect(existsSync(path.join(process.cwd(), "public", relativeUrl!.replace(/^\//, "")))).toBe(true);
    });

    const importedEventId = importedEvent!._id;
    const [
      importedPrinters,
      importedPeripherals,
      importedCategories,
      importedIngredients,
      importedProducts,
      importedPosDevices,
      importedOrderCount,
      importedCounts,
    ] = await Promise.all([
      Printer.find({ eventId: importedEventId }).lean(),
      Peripheral.find({ eventId: importedEventId }).lean(),
      Category.find({ eventId: importedEventId }).lean(),
      Ingredient.find({ eventId: importedEventId }).lean(),
      Product.find({ eventId: importedEventId }).lean(),
      PosDevice.find({ eventId: importedEventId }).lean(),
      Order.countDocuments({ eventId: importedEventId }),
      Promise.all([
        Printer.countDocuments({ eventId: importedEventId }),
        Peripheral.countDocuments({ eventId: importedEventId }),
        Category.countDocuments({ eventId: importedEventId }),
        Ingredient.countDocuments({ eventId: importedEventId }),
        Product.countDocuments({ eventId: importedEventId }),
        PosDevice.countDocuments({ eventId: importedEventId }),
      ]),
    ]);

    expect(importedCounts).toEqual([2, 2, 1, 1, 3, 1]);
    expect(importedOrderCount).toBe(0);

    expect(importedPrinters.map((printer) => printer.name)).toEqual(
      expect.arrayContaining([expectedCashierPrinterName, expectedKitchenPrinterName])
    );
    expect(importedPeripherals.map((peripheral) => peripheral.name)).toEqual(
      expect.arrayContaining([expectedPaymentPeripheralName, expectedCashBoxPeripheralName])
    );
    expect(importedPosDevices.map((posDevice) => posDevice.name)).toEqual(
      expect.arrayContaining([expectedPosDeviceName])
    );

    const importedCashierPrinter = importedPrinters.find((printer) => printer.type === "CASHIER") || null;
    const importedKitchenPrinter = importedPrinters.find((printer) => printer.type === "KITCHEN") || null;
    const importedPaymentPeripheral = importedPeripherals.find((peripheral) => peripheral.type === "SUMUP") || null;
    const importedCashBoxPeripheral = importedPeripherals.find((peripheral) => peripheral.type === "CASH_BOX") || null;
    const importedCategory = importedCategories.find((category) => category.name === expectedCategoryName) || importedCategories[0] || null;
    const importedIngredient = importedIngredients.find((ingredient) => ingredient.shortName === "PATA") || null;
    const importedPanino = importedProducts.find((product) => product.name === expectedPaninoName) || null;
    const importedPatatine = importedProducts.find((product) => product.name === expectedPatatineName) || null;
    const importedCombo = importedProducts.find((product) => product.name === expectedComboName) || null;
    const importedPosDevice = importedPosDevices[0] || null;

    expect(importedCategory).toMatchObject({
      printOrder: 7,
      skipKitchenPrint: false,
      printKitchenCopyAtCashier: true,
      pizzaFlowEnabled: true,
    });
    expect(importedIngredient).toMatchObject({
      shortName: "PATA",
      stockQuantity: 40,
      active: true,
    });
    expect(String(importedCategory!.printerId)).toBe(String(importedKitchenPrinter!._id));

    expect(importedPanino).toMatchObject({
      shortName: "PAN",
      basePrice: 6.5,
      kind: "STANDARD",
      stockQuantity: 20,
    });
    expect(importedPatatine).toMatchObject({
      shortName: "PAT",
      basePrice: 3,
      stockQuantity: 50,
    });
    expect(importedCombo).toMatchObject({
      shortName: "COMBO",
      basePrice: 10,
      kind: "FIXED_MENU",
    });
    expect(String(importedCombo!.categoryId)).toBe(String(importedCategory!._id));
    expect(String(importedCombo!.menuComponents[0].productId)).toBe(String(importedPanino!._id));
    expect(String(importedCombo!.menuComponents[0].productId)).not.toBe(seeded.sourceProductIds.panino);
    expect(String(importedCombo!.menuChoiceGroups[0].options[0].productId)).toBe(String(importedPatatine!._id));
    expect(String(importedCombo!.menuChoiceGroups[0].options[0].productId)).not.toBe(seeded.sourceProductIds.patatine);

    expect(String(importedPosDevice!.printerId)).toBe(String(importedCashierPrinter!._id));
    expect(String(importedPosDevice!.paymentTerminalId)).toBe(String(importedPaymentPeripheral!._id));
    expect(String(importedPosDevice!.cashBoxId)).toBe(String(importedCashBoxPeripheral!._id));
    expect(importedPaymentPeripheral!.config).toMatchObject({
      merchantCode: `merchant-${suffix}`,
      readerId: `reader-${suffix}`,
      apiKey: `encrypted-api-${suffix}`,
      affiliateAppId: `app-${suffix}`,
      affiliateKey: `encrypted-affiliate-${suffix}`,
    });
  });
});
