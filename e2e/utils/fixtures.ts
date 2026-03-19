import { expect, type Page } from "@playwright/test";
import dbConnect from "../../src/lib/mongoose";
import Event from "../../src/models/Event";
import Category from "../../src/models/Category";
import Product from "../../src/models/Product";
import Printer from "../../src/models/Printer";
import PosDevice from "../../src/models/PosDevice";
import Peripheral from "../../src/models/Peripheral";
import Order from "../../src/models/Order";

// ---------------------------------------------------------------------------
// Unique suffix for test isolation
// ---------------------------------------------------------------------------
export function uniqueSuffix(): string {
    return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ---------------------------------------------------------------------------
// Event management
// ---------------------------------------------------------------------------
export interface CreateEventOptions {
    askTable?: boolean;
    askName?: boolean;
    predefinedTables?: string[];
    portalEasterEggEnabled?: boolean;
}

const ADMIN_COOKIE_URL = "http://127.0.0.1:3000";

export async function createActiveEventDirect(
    eventName: string,
    options?: CreateEventOptions,
) {
    await dbConnect();

    await Event.updateMany({ active: true }, { $set: { active: false } });

    const event = await Event.create({
        name: eventName,
        active: true,
        archived: false,
        settings: {
            askName: options?.askName ?? false,
            askTable: options?.askTable ?? false,
            portalEasterEggEnabled: options?.portalEasterEggEnabled ?? false,
        },
        predefinedTables: options?.predefinedTables ?? [],
    });

    return {
        eventId: String(event._id),
    };
}

export async function setAdminEventContextCookie(page: Page, eventId: string) {
    await page.context().addCookies([{
        name: "admin_festa_id",
        value: eventId,
        url: ADMIN_COOKIE_URL,
    }]);
}

export async function createAndActivateEvent(
    page: Page,
    eventName: string,
    options?: CreateEventOptions,
) {
    const { eventId } = await createActiveEventDirect(eventName, options);
    await setAdminEventContextCookie(page, eventId);
    await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(new RegExp(`Impostazioni Festa: ${eventName}`))).toBeVisible({ timeout: 15000 });
}

export async function selectEventContext(page: Page, eventName: string) {
    await dbConnect();
    const event = await Event.findOne({ name: eventName, archived: { $ne: true } }).select("_id").lean<{ _id: string } | null>();
    expect(event?._id).toBeTruthy();

    await setAdminEventContextCookie(page, String(event!._id));

    const currentUrl = page.url();
    const targetPath = currentUrl.startsWith(ADMIN_COOKIE_URL)
        ? `${new URL(currentUrl).pathname}${new URL(currentUrl).search}`
        : "/admin";

    await page.goto(targetPath, { waitUntil: "domcontentloaded" });
    const selector = page.getByTestId("admin-event-selector");
    if (await selector.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(selector).toContainText(eventName, { timeout: 15000 });
    }
}


export async function deleteEvent(_page: Page, eventName: string) {
    await dbConnect();

    const event = await Event.findOne({ name: eventName }).select("_id").lean<{ _id: string } | null>();
    if (!event?._id) return;

    const eventId = String(event._id);

    await Order.deleteMany({ eventId });
    await PosDevice.deleteMany({ eventId });
    await Peripheral.deleteMany({ eventId });
    await Printer.deleteMany({ eventId });
    await Product.deleteMany({ eventId });
    await Category.deleteMany({ eventId });
    await Event.findByIdAndDelete(eventId);
}

// ---------------------------------------------------------------------------
// Hardware setup
// ---------------------------------------------------------------------------
export interface ConfigureCashPosOptions {
    printerPort?: string;
}

export interface CreatePrinterOptions {
    printerPort?: string;
    printerType: "CASHIER" | "KITCHEN";
}

export async function createPrinter(
    page: Page,
    printerName: string,
    printerIp: string,
    options: CreatePrinterOptions
) {
    await page.goto("/admin/settings/hardware");

    await page.getByRole("button", { name: /Nuova Stampante/i }).click();
    const printerDialog = page.getByRole("dialog");
    await printerDialog.getByLabel("Nome Stampante").fill(printerName);
    await printerDialog.getByLabel("Indirizzo IP").fill(printerIp);
    const port = options.printerPort || String(19100 + Math.floor(Math.random() * 10));
    await printerDialog.getByLabel("Porta TCP").fill(port);

    await printerDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
    await page.getByRole("option", {
        name: options.printerType === "CASHIER"
            ? "Cassa (Scontrino Cliente)"
            : "Reparto (Comanda Piatto)"
    }).click();
    await printerDialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(printerDialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(printerName)).toBeVisible();
}

export async function createCashBoxPeripheral(page: Page, cashBoxName: string) {
    await page.goto("/admin/settings/hardware");
    await page.getByRole("tab", { name: "Periferiche" }).click();
    await page.getByRole("button", { name: /Nuova Periferica/i }).click();
    const peripheralDialog = page.getByRole("dialog");
    await peripheralDialog.getByLabel("Nome Descrittivo").fill(cashBoxName);
    await peripheralDialog.getByRole("combobox", { name: "Tipo Periferica" }).click();
    await page.getByRole("option", { name: "Cassetta Contanti (Manuale)" }).click();
    await peripheralDialog.getByRole("button", { name: "Aggiungi Periferica", exact: true }).click();
    await expect(peripheralDialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(cashBoxName)).toBeVisible({ timeout: 15000 });
}

export async function createPosDevice(
    page: Page,
    posName: string,
    printerName: string,
    cashBoxName?: string,
) {
    await page.goto("/admin/settings/pos");
    await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
    const posDialog = page.getByRole("dialog");
    await posDialog.getByLabel("Nome Postazione").fill(posName);
    await posDialog.getByRole("combobox", { name: "Stampante Associata" }).click();
    await page.getByRole("option", { name: new RegExp(printerName) }).click();
    if (cashBoxName) {
        await posDialog.getByRole("combobox", { name: "Cassetta Contanti (Manuale)" }).click();
        await page.getByRole("option", { name: new RegExp(cashBoxName) }).click();
    }
    await posDialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(posDialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(posName)).toBeVisible({ timeout: 15000 });
}

export async function createCategoryWithPrinter(
    page: Page,
    categoryName: string,
    kitchenPrinterName?: string,
) {
    await page.goto("/admin/catalog");
    await page.click("#new-category-btn");
    const dialog = page.getByRole("dialog");
    await dialog.locator("#cat-name").fill(categoryName);

    if (kitchenPrinterName) {
        const printerSelect = dialog.getByLabel("Stampante Reparto");
        const printerValue = await printerSelect.evaluate((element, needle) => {
            const select = element as HTMLSelectElement;
            const option = Array.from(select.options).find((item) => item.text.includes(needle));
            return option?.value ?? null;
        }, kitchenPrinterName);
        expect(printerValue).toBeTruthy();
        await printerSelect.selectOption(printerValue!);
    }

    await dialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(categoryName)).toBeVisible();
}

export async function configureCashPos(
    page: Page,
    printerName: string,
    printerIp: string,
    cashBoxName: string,
    posName: string,
    options?: ConfigureCashPosOptions,
) {
    await createPrinter(page, printerName, printerIp, {
        printerType: "CASHIER",
        printerPort: options?.printerPort
    });
    await createCashBoxPeripheral(page, cashBoxName);
    await createPosDevice(page, posName, printerName, cashBoxName);
}

export async function configureElectronicPos(
    page: Page,
    printerName: string,
    printerIp: string,
    electronicTerminalName: string,
    posName: string,
    options?: ConfigureCashPosOptions,
) {
    await page.goto("/admin/settings/hardware");

    await page.getByRole("button", { name: /Nuova Stampante/i }).click();
    const printerDialog = page.getByRole("dialog");
    await printerDialog.getByLabel("Nome Stampante").fill(printerName);
    await printerDialog.getByLabel("Indirizzo IP").fill(printerIp);
    const port = options?.printerPort || String(19100 + Math.floor(Math.random() * 10));
    await printerDialog.getByLabel("Porta TCP").fill(port);

    await printerDialog.getByRole("combobox", { name: "Tipo Stampante" }).click();
    await page.getByRole("option", { name: "Cassa (Scontrino Cliente)" }).click();
    await printerDialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(printerName)).toBeVisible();

    await page.getByRole("tab", { name: "Periferiche" }).click();
    await page.getByRole("button", { name: /Nuova Periferica/i }).click();
    const peripheralDialog = page.getByRole("dialog");
    await peripheralDialog.getByLabel("Nome Descrittivo").fill(electronicTerminalName);
    await peripheralDialog.getByRole("combobox", { name: "Tipo Periferica" }).click();
    await page.getByRole("option", { name: "Pagamento Carta / POS (Manuale)" }).click();
    await peripheralDialog.getByRole("button", { name: "Aggiungi Periferica", exact: true }).click();
    await expect(page.getByText(electronicTerminalName)).toBeVisible();

    await page.goto("/admin/settings/pos");
    await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
    const posDialog = page.getByRole("dialog");
    await posDialog.getByLabel("Nome Postazione").fill(posName);
    await posDialog.getByRole("combobox", { name: "Stampante Associata" }).click();
    await page.getByRole("option", { name: new RegExp(printerName) }).click();
    await posDialog.getByRole("combobox", { name: "Terminale Pagamento (Carta / POS)" }).click();
    await page.getByRole("option", { name: new RegExp(electronicTerminalName) }).click();
    await posDialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(posName)).toBeVisible();
}

export function localPrinterIp(): string {
    return "127.0.0.1";
}


// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
export async function createCategory(page: Page, categoryName: string) {
    await page.goto("/admin/catalog");
    await page.click("#new-category-btn");
    const dialog = page.getByRole("dialog");
    await dialog.locator("#cat-name").fill(categoryName);
    await dialog.getByRole("button", { name: "Salva Categoria", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(categoryName)).toBeVisible();
}

export interface ProductDef {
    name: string;
    price: string;
    stock?: string;
    shortName?: string;
    description?: string;
}

export async function createActiveEventWithCatalogDirect(
    eventName: string,
    categoryName: string,
    products: ProductDef[],
    options?: CreateEventOptions,
) {
    const { eventId } = await createActiveEventDirect(eventName, options);

    const category = await Category.create({
        eventId,
        name: categoryName,
        uiColor: "#2563eb",
        printOrder: 0,
    });

    await Product.insertMany(
        products.map((product) => ({
            eventId,
            categoryId: category._id,
            name: product.name,
            shortName: product.shortName,
            description: product.description,
            basePrice: Number(product.price),
            stockQuantity: product.stock ? Number(product.stock) : null,
            isSoldOut: false,
            availableDays: [],
            variants: [],
        }))
    );

    return {
        eventId,
        categoryId: String(category._id),
    };
}

export async function createVirtualPrinterDirect(options: {
    eventName: string;
    printerName: string;
    type?: "CASHIER" | "KITCHEN";
    emulatorSlot?: number;
}) {
    await dbConnect();

    const event = await Event.findOne({ name: options.eventName }).select("_id").lean<{ _id: string } | null>();
    expect(event?._id).toBeTruthy();

    const emulatorSlot = options.emulatorSlot ?? 1;
    const port = 19100 + (emulatorSlot - 1);

    const printer = await Printer.create({
        eventId: event!._id,
        name: options.printerName,
        ip: "127.0.0.1",
        port,
        isVirtual: true,
        emulatorSlot,
        type: options.type ?? "CASHIER",
    });

    return {
        printerId: String(printer._id),
        eventId: String(event!._id),
    };
}

export async function seedActiveEventWithCatalog(
    eventName: string,
    categoryName: string,
    products: ProductDef[],
    options?: CreateEventOptions,
) {
    return createActiveEventWithCatalogDirect(eventName, categoryName, products, options);
}

export async function createProduct(page: Page, categoryName: string, product: ProductDef) {
    await page.click("#new-product-btn");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome").fill(product.name);
    if (product.shortName) {
        await dialog.getByLabel("Etichetta breve POS/Scontrino (opzionale)").fill(product.shortName);
    }
    if (product.description) {
        await dialog.getByLabel("Descrizione Menu (opzionale)").fill(product.description);
    }
    await dialog.getByLabel("Prezzo Base (€)").fill(product.price);
    await dialog.locator('select[name="categoryId"]').selectOption({ label: categoryName });
    if (product.stock) {
        await dialog.getByLabel("Scorte").fill(product.stock);
    }
    await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(product.name)).toBeVisible();
}

export async function createCategoryAndProducts(
    page: Page,
    categoryName: string,
    products: ProductDef[],
) {
    await createCategory(page, categoryName);
    for (const product of products) {
        await createProduct(page, categoryName, product);
    }
}

// ---------------------------------------------------------------------------
// POS operations
// ---------------------------------------------------------------------------
export async function openPosAndSelectDevice(page: Page, posName: string) {
    await page.goto("/pos");
    await page.evaluate(() => localStorage.removeItem("fantafestando_pos_id"));
    await page.reload();

    await page.waitForResponse(
        (r) => r.url().includes("/api/pos/init") && r.ok(),
        { timeout: 10000 },
    );

    const selectorTitle = page.getByText(/In quale cassa sei\?/i);
    if (await selectorTitle.isVisible()) {
        const posButton = page.getByRole("dialog").locator("button")
            .filter({ hasText: new RegExp(posName) }).first();
        await expect(posButton).toBeVisible();
        await posButton.click();
        await expect(selectorTitle).toBeHidden();
    }
}

export async function openCashSession(page: Page, openingFloatAmount: string) {
    await page.getByRole("button", { name: /Apri Cassa/i }).click();
    const openDialog = page.getByRole("dialog").filter({ hasText: /Apertura Cassa/i });
    await expect(openDialog).toBeVisible();
    await openDialog.locator("#opening-float-amount").fill(openingFloatAmount);
    await openDialog.getByRole("button", { name: "APRI CASSA", exact: true }).click();
    await expect(openDialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /Chiudi Cassa/i })).toBeVisible({ timeout: 15000 });
}

export async function openCashSessionIfRequired(page: Page, openingFloatAmount = "0") {
    const openButton = page.getByRole("button", { name: /Apri Cassa/i });
    if (!(await openButton.isVisible())) return;
    await openCashSession(page, openingFloatAmount);
}

export async function closeCashSession(page: Page, countedCash: string) {
    await page.getByRole("button", { name: /Chiudi Cassa/i }).click();
    const closeDialog = page.getByRole("dialog").filter({ hasText: /Chiusura Cassa/i });
    await expect(closeDialog).toBeVisible();
    await closeDialog.locator("#closing-counted-cash").fill(countedCash);
    await expect(closeDialog.getByRole("button", { name: "CONFERMA CHIUSURA", exact: true })).toBeEnabled();
    await closeDialog.getByRole("button", { name: "CONFERMA CHIUSURA", exact: true }).click();
    await expect(page.getByRole("button", { name: /Apri Cassa/i })).toBeVisible();
}

export async function dismissFeedbackModal(page: Page) {
    const feedbackModal = page.getByRole("dialog")
        .filter({ hasText: /Pagamento registrato|Ordine completato|Errore stampa|stampa ha errori/i });
    if (await feedbackModal.isVisible()) {
        await feedbackModal.getByRole("button", { name: "OK", exact: true }).click();
        await expect(feedbackModal).toBeHidden();
    }
}

export async function completeCashOrder(
    page: Page,
    products: string | Array<{ name: string; quantity: number }>,
) {
    const items = typeof products === "string"
        ? [{ name: products, quantity: 1 }]
        : products;

    for (const item of items) {
        const btn = page.locator("button").filter({ hasText: new RegExp(item.name) }).first();
        for (let i = 0; i < item.quantity; i++) {
            await btn.click();
        }
    }

    await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
    const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
    await expect(checkoutDialog).toBeVisible();

    const confirmButton = checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true });
    await confirmButton.scrollIntoViewIfNeeded();
    await confirmButton.click();

    await expect(checkoutDialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible();
    await dismissFeedbackModal(page);
}

export async function completeElectronicOrder(
    page: Page,
    products: string | Array<{ name: string; quantity: number }>,
) {
    const items = typeof products === "string"
        ? [{ name: products, quantity: 1 }]
        : products;

    for (const item of items) {
        const btn = page.locator("button").filter({ hasText: new RegExp(item.name) }).first();
        for (let i = 0; i < item.quantity; i++) {
            await btn.click();
        }
    }

    await page.getByRole("button", { name: "PAGA ORA", exact: true }).click();
    const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
    await expect(checkoutDialog).toBeVisible();

    await checkoutDialog.getByRole("button", { name: /CARTA \/ POS/i }).click();

    const confirmButton = checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true });
    await confirmButton.scrollIntoViewIfNeeded();
    await confirmButton.click();

    await expect(checkoutDialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible();
    await dismissFeedbackModal(page);
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------
export async function ensureAdminEventContext(page: Page) {
    const selector = page.getByTestId("admin-event-selector");

    // Wait for hydration so the text is not totally empty
    await expect(selector).not.toHaveText("", { timeout: 10000 });

    if (!(await selector.innerText()).includes("Seleziona Festa")) {
        return;
    }

    await page.click('[data-testid="admin-event-selector"]');
    const firstOption = page.getByRole("option").first();
    if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await Promise.all([
            page.waitForResponse(r => r.url().includes("/admin") && r.status() === 200),
            firstOption.click()
        ]);
        await expect(selector).not.toContainText("Seleziona Festa");
        return;
    }


    const eventName = `Auto Event ${uniqueSuffix()}`;
    const { eventId } = await createActiveEventDirect(eventName);
    await setAdminEventContextCookie(page, eventId);
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(selector).not.toContainText("Seleziona Festa");
}
