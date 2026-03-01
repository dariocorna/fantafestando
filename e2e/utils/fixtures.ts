import { expect, type Page } from "@playwright/test";

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
}

export async function createAndActivateEvent(
    page: Page,
    eventName: string,
    options?: CreateEventOptions,
) {
    await page.goto("/admin/settings/events");

    await page.click("#new-event-btn");
    const dialog = page.getByRole("dialog");
    await dialog.locator("#name").fill(eventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(eventName)).toBeVisible();

    await page.click('[data-testid="admin-event-selector"]');

    // Wait for the Server Action response and the subsequent router refresh
    await Promise.all([
        page.waitForResponse(r => r.url().includes("/admin") && r.status() === 200),
        page.getByRole("option", { name: new RegExp(eventName) }).click()
    ]);

    // Wait for the transition to finish by checking if the selector is enabled again
    await expect(page.getByTestId("admin-event-selector")).not.toBeDisabled();
    await expect(page.getByTestId("admin-event-selector")).toContainText(eventName);

    // Give a small buffer and verify the cookie is actually set
    const cookies = await page.context().cookies();
    if (!cookies.some(c => c.name === "admin_festa_id")) {
        await page.waitForTimeout(500);
    }

    await page.goto("/admin/settings");
    const activeCheckbox = page.locator('input[name="active"]');
    await expect(activeCheckbox).toBeVisible();
    if (!(await activeCheckbox.isChecked())) {
        await activeCheckbox.check();
    }


    if (options?.askTable !== undefined) {
        const cb = page.locator('input[name="askTable"]');
        if (options.askTable && !(await cb.isChecked())) await cb.check();
        if (!options.askTable && (await cb.isChecked())) await cb.uncheck();
    }

    if (options?.askName !== undefined) {
        const cb = page.locator('input[name="askName"]');
        if (options.askName && !(await cb.isChecked())) await cb.check();
        if (!options.askName && (await cb.isChecked())) await cb.uncheck();
    }

    if (options?.predefinedTables?.length) {
        await page.getByRole("button", { name: /Importa Elenco/i }).click();
        await page.locator("#bulk-predefined-tables").fill(options.predefinedTables.join("\n"));
        await page.getByRole("button", { name: /Importa in Lista/i }).click();
    }

    await page.getByRole("button", { name: /Salva Impostazioni/i }).click();
    await expect(page.getByText(/Modifiche salvate/i)).toBeVisible();
}

export async function selectEventContext(page: Page, eventName: string) {
    const selector = page.getByTestId("admin-event-selector");
    await selector.click();
    const escapedName = eventName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Wait for the Server Action response and the subsequent router refresh
    await Promise.all([
        page.waitForResponse(r => r.url().includes("/admin") && r.status() === 200),
        page.getByRole("option", { name: new RegExp(`^${escapedName}(\\s+\\(Attiva\\))?$`) }).click()
    ]);

    await expect(selector).not.toBeDisabled();
    await expect(selector).toContainText(eventName);

    // Give a small buffer and verify the cookie is actually set
    const cookies = await page.context().cookies();
    if (!cookies.some(c => c.name === "admin_festa_id")) {
        await page.waitForTimeout(500);
    }
}


export async function deleteEvent(page: Page, eventName: string) {
    await page.goto("/admin/settings/events");

    const eventCard = page.locator("div.p-4.border").filter({ hasText: eventName }).first();
    await expect(eventCard).toBeVisible();

    await eventCard.locator("button.text-red-500").first().click();
    await page.getByRole("button", { name: "Continua", exact: true }).click();
    await expect(eventCard).toBeHidden();
}

// ---------------------------------------------------------------------------
// Hardware setup
// ---------------------------------------------------------------------------
export interface ConfigureCashPosOptions {
    printerPort?: string;
}

export async function configureCashPos(
    page: Page,
    printerName: string,
    printerIp: string,
    cashBoxName: string,
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
    await peripheralDialog.getByLabel("Nome Descrittivo").fill(cashBoxName);
    await peripheralDialog.getByRole("combobox", { name: "Tipo Periferica" }).click();
    await page.getByRole("option", { name: "Cassetta Contanti (Manuale)" }).click();
    await peripheralDialog.getByRole("button", { name: "Aggiungi Periferica", exact: true }).click();
    await expect(page.getByText(cashBoxName)).toBeVisible();

    await page.goto("/admin/settings/pos");
    await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click();
    const posDialog = page.getByRole("dialog");
    await posDialog.getByLabel("Nome Postazione").fill(posName);
    await posDialog.getByRole("combobox", { name: "Stampante Associata" }).click();
    await page.getByRole("option", { name: new RegExp(printerName) }).click();
    await posDialog.getByRole("combobox", { name: "Cassetta Contanti (Manuale)" }).click();
    await page.getByRole("option", { name: new RegExp(cashBoxName) }).click();
    await posDialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page.getByText(posName)).toBeVisible();
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
    await page.evaluate(() => localStorage.removeItem("osgfest_pos_id"));
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
    await expect(page.getByRole("button", { name: /Chiudi Cassa/i })).toBeVisible();
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
    await page.goto("/admin/settings/events");
    await page.click("#new-event-btn");
    const dialog = page.getByRole("dialog");
    await dialog.locator("#name").fill(eventName);
    await dialog.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/admin");
    await page.click('[data-testid="admin-event-selector"]');
    await Promise.all([
        page.waitForResponse(r => r.url().includes("/admin") && r.status() === 200),
        page.getByRole("option", { name: new RegExp(eventName) }).click()
    ]);
    await expect(selector).not.toContainText("Seleziona Festa");
}
