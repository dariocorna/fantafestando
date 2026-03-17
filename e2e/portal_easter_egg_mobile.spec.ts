import { test, expect, type Locator, type Page, type BrowserContext } from "@playwright/test";
import sharp from "sharp";
import { ensureAdminAuthenticated, ensureCashierAuthenticated } from "./utils/auth";
import {
    createActiveEventWithCatalogDirect,
    createAndActivateEvent,
    createCashBoxPeripheral,
    createCategoryAndProducts,
    createPosDevice,
    deleteEvent,
    dismissFeedbackModal,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix
} from "./utils/fixtures";

interface PrintJobListItem {
    source: string;
    printType: string;
    status: string;
    document?: {
        title?: string;
    };
}

async function setRangeValue(locator: Locator, value: number) {
    await locator.evaluate((element, nextValue) => {
        const input = element as HTMLInputElement;
        input.value = String(nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
}

async function provisionVirtualPrinters(page: Page) {
    await page.goto("/admin/settings/hardware");
    await page.getByRole("button", { name: "Provisiona 10 virtuali" }).click();
    await expect(page.getByText("Virtual Printer 10")).toBeVisible({ timeout: 15000 });
}

async function openPrintMonitor(page: Page) {
    await page.goto("/admin/settings/hardware");
    await page.getByRole("tab", { name: "Monitor Stampa" }).click();
}

async function fetchPrintJobs(page: Page): Promise<PrintJobListItem[] | null> {
    try {
        const response = await page.request.get("/api/admin/print-jobs?limit=100");
        if (!response.ok()) {
            return null;
        }

        const payload = await response.json() as {
            jobs?: PrintJobListItem[];
        };

        return payload.jobs || [];
    } catch {
        return null;
    }
}

async function buildPortraitPhotoBuffer() {
    return sharp({
        create: {
            width: 1200,
            height: 1800,
            channels: 3,
            background: { r: 245, g: 235, b: 218 }
        }
    })
        .composite([
            {
                input: await sharp({
                    create: {
                        width: 420,
                        height: 420,
                        channels: 3,
                        background: { r: 34, g: 34, b: 34 }
                    }
                }).png().toBuffer(),
                left: 380,
                top: 180
            },
            {
                input: await sharp({
                    create: {
                        width: 280,
                        height: 880,
                        channels: 3,
                        background: { r: 64, g: 70, b: 84 }
                    }
                }).png().toBuffer(),
                left: 460,
                top: 620
            },
            {
                input: await sharp({
                    create: {
                        width: 250,
                        height: 250,
                        channels: 3,
                        background: { r: 250, g: 250, b: 250 }
                    }
                }).png().toBuffer(),
                left: 810,
                top: 260
            }
        ])
        .jpeg()
        .toBuffer();
}

async function dragPreview(stage: Locator) {
    const box = await stage.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    const page = stage.page();
    const startX = box.x + (box.width * 0.52);
    const startY = box.y + (box.height * 0.48);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 70, startY + 55, { steps: 8 });
    await page.mouse.up();
}

async function createMenuOrder(page: Page, productName: string) {
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("menu-brand-shell")).toBeVisible({ timeout: 20000 });

    const card = page.locator(".rounded-3xl")
        .filter({ has: page.getByRole("heading", { name: productName, level: 3 }) })
        .first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator("button").first().click();
    await expect(card.locator("button")).toHaveCount(2, { timeout: 5000 });

    const cartButton = page.getByTestId("menu-cart-cta");
    await expect(cartButton).toBeVisible({ timeout: 5000 });
    await expect(cartButton).toContainText("1");
    await cartButton.click();

    const submitButton = page.getByTestId("menu-submit-order");
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    await expect(page).toHaveURL(/\/menu\/success\?code=.*orderId=/, { timeout: 20000 });

    const url = new URL(page.url());
    const code = url.searchParams.get("code");
    const orderId = url.searchParams.get("orderId");
    expect(code).toBeTruthy();
    expect(orderId).toBeTruthy();

    return { code: code || "", orderId: orderId || "" };
}

async function loadPendingOrderOnPos(page: Page, orderCode: string) {
    await page.getByRole("button", { name: /Carica ordine da codice/i }).click();
    const loadDialog = page.getByRole("dialog").filter({ hasText: /Carica ordine da codice/i });
    await loadDialog.getByRole("textbox").fill(orderCode);
    await loadDialog.getByRole("button", { name: /Carica/i, exact: true }).click();
}

test.describe.serial("Portal Easter Egg", () => {
    test("quando la funzione è disabilitata il menu non mostra il form foto", async ({ page, browser }) => {
        const suffix = uniqueSuffix();
        const eventName = `Easter Disabled ${suffix}`;
        const categoryName = `Disabled Cat ${suffix}`;
        const productName = `Prodotto ${suffix}`;
        let eventCreated = false;
        let publicContext: BrowserContext | null = null;

        try {
            await createActiveEventWithCatalogDirect(
                eventName,
                categoryName,
                [{ name: productName, price: "5.00" }],
                { portalEasterEggEnabled: false }
            );
            eventCreated = true;

            publicContext = await browser.newContext();
            const publicPage = await publicContext.newPage();

            await createMenuOrder(publicPage, productName);
            await expect(publicPage.getByText(/Funzione speciale opzionale/i)).toHaveCount(0);
            await expect(publicPage.getByText(/Foto termica per la tua comanda/i)).toHaveCount(0);
            await expect(publicPage.getByText(/Vuoi aggiungere una foto\?/i)).toHaveCount(0);
        } finally {
            if (publicContext) {
                await publicContext.close().catch(() => undefined);
            }
            if (eventCreated && !page.isClosed()) {
                await deleteEvent(page, eventName);
            }
        }
    });

    test("l'area admin resta stateless e invia solo il raster di test", async ({ page }) => {
        const eventName = `Admin Easter ${uniqueSuffix()}`;
        let eventCreated = false;
        const uploadBuffer = await buildPortraitPhotoBuffer();

        await ensureAdminAuthenticated(page, "/admin/easter-egg");

        try {
            await createAndActivateEvent(page, eventName, { portalEasterEggEnabled: true });
            eventCreated = true;
            await provisionVirtualPrinters(page);

            await page.goto("/admin/easter-egg");
            await expect(page.getByText("Nessuna foto caricata")).toBeVisible({ timeout: 15000 });

            await page.getByTestId("portal-easter-egg-file-input").setInputFiles({
                name: "admin-easter-egg.jpg",
                mimeType: "image/jpeg",
                buffer: uploadBuffer
            });

            await expect(page.getByTestId("portal-easter-egg-thermal-preview")).toBeVisible({ timeout: 15000 });
            await dragPreview(page.getByTestId("portal-easter-egg-preview-stage"));

            const brightnessSlider = page.locator("#portal-easter-egg-brightness");
            await setRangeValue(brightnessSlider, 56);
            await expect(brightnessSlider).toHaveValue("56");

            await expect(page.getByTestId("portal-easter-egg-state-banner")).toContainText("Foto confermata", { timeout: 15000 });
            await expect(page.getByTestId("portal-easter-egg-autosave-banner")).toContainText("Salvata automaticamente");
            await expect(page.getByText("Stampa easter egg inviata.")).toBeVisible({ timeout: 15000 });

            await expect.poll(async () => {
                const jobs = await fetchPrintJobs(page);
                if (!jobs) return false;
                return jobs.some((job) =>
                    job.source === "MANUAL_TEST"
                    && job.printType === "EASTER_EGG_IMAGE"
                    && job.status === "SENT"
                );
            }, {
                timeout: 15000
            }).toBe(true);

            await page.goto("/admin/easter-egg", { waitUntil: "domcontentloaded" });
            await expect(page.getByText("Nessuna foto caricata")).toBeVisible({ timeout: 15000 });
            await expect(page.getByTestId("portal-easter-egg-thermal-preview")).toHaveCount(0);
        } finally {
            if (eventCreated && !page.isClosed()) {
                await deleteEvent(page, eventName);
            }
        }
    });

    test("il cliente allega la foto dal menu e il POS la stampa in chiusura ordine", async ({ page, browser }) => {
        test.setTimeout(120000);

        const suffix = uniqueSuffix();
        const eventName = `Menu Easter ${suffix}`;
        const cashBoxName = `CashBox ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `Photo Cat ${suffix}`;
        const productName = `Panino ${suffix}`;
        const uploadBuffer = await buildPortraitPhotoBuffer();
        let eventCreated = false;
        let cashierContext: BrowserContext | null = null;
        let publicContext: BrowserContext | null = null;

        await ensureAdminAuthenticated(page, "/admin");

        try {
            await createAndActivateEvent(page, eventName, { portalEasterEggEnabled: true });
            eventCreated = true;
            await provisionVirtualPrinters(page);
            await createCashBoxPeripheral(page, cashBoxName);
            await createPosDevice(page, posName, "Virtual Printer 01", cashBoxName);
            await createCategoryAndProducts(page, categoryName, [
                { name: productName, price: "8.00" }
            ]);

            publicContext = await browser.newContext();
            const publicPage = await publicContext.newPage();

            const { code } = await createMenuOrder(publicPage, productName);

            await expect(publicPage.getByText(/Vuoi aggiungere una foto\?/i)).toBeVisible({ timeout: 15000 });
            await expect(publicPage.getByText(/Aggiungi una foto alla comanda/i)).toBeVisible({ timeout: 15000 });

            await publicPage.getByTestId("menu-easter-egg-file-input").setInputFiles({
                name: "menu-easter-egg.jpg",
                mimeType: "image/jpeg",
                buffer: uploadBuffer
            });

            await expect(publicPage.getByTestId("menu-easter-egg-thermal-preview")).toBeVisible({ timeout: 15000 });
            await dragPreview(publicPage.getByTestId("menu-easter-egg-preview-stage"));

            await expect(publicPage.getByTestId("menu-easter-egg-state-banner")).toContainText("Foto confermata", { timeout: 15000 });
            await expect(publicPage.getByTestId("menu-easter-egg-autosave-banner")).toContainText("Salvata automaticamente");
            await expect(publicPage.getByText(/Foto allegata all'ordine/i)).toBeVisible({ timeout: 15000 });

            await ensureAdminAuthenticated(page, "/admin/settings/hardware");

            await expect.poll(async () => {
                const jobs = await fetchPrintJobs(page);
                if (!jobs) return -1;
                return jobs.filter((job) => job.source === "ORDER").length;
            }, {
                timeout: 5000
            }).toBe(0);

            cashierContext = await browser.newContext();
            const cashierPage = await cashierContext.newPage();
            await ensureCashierAuthenticated(cashierPage, "/pos");
            await openPosAndSelectDevice(cashierPage, posName);
            await openCashSessionIfRequired(cashierPage);

            await loadPendingOrderOnPos(cashierPage, code);
            await expect(cashierPage.getByText(new RegExp(`Codice ${code}`, "i"))).toBeVisible({ timeout: 15000 });
            await expect(cashierPage.getByText(/Foto allegata/i)).toBeVisible({ timeout: 15000 });

            await cashierPage.getByRole("button", { name: "PAGA ORA", exact: true }).click();
            const checkoutDialog = cashierPage.getByRole("dialog").filter({ hasText: /Importo Dovuto/i });
            await expect(checkoutDialog).toBeVisible({ timeout: 15000 });
            await expect(checkoutDialog.getByText(/Foto allegata pronta per la stampa cassa/i)).toBeVisible({ timeout: 15000 });

            const confirmButton = checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true });
            await confirmButton.scrollIntoViewIfNeeded();
            await confirmButton.click();
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 });
            await dismissFeedbackModal(cashierPage);

            await expect.poll(async () => {
                const jobs = await fetchPrintJobs(page);
                if (!jobs) {
                    return {
                        customerOrderPrinted: false,
                        easterEggPrinted: false
                    };
                }
                return {
                    customerOrderPrinted: jobs.some((job) =>
                        job.source === "ORDER"
                        && job.printType === "CUSTOMER_ORDER"
                        && job.status === "SENT"
                    ),
                    easterEggPrinted: jobs.some((job) =>
                        job.printType === "EASTER_EGG_IMAGE"
                        && job.status === "SENT"
                        && job.document?.title === "Easter Egg Cliente"
                    )
                };
            }, {
                timeout: 15000
            }).toEqual({
                customerOrderPrinted: true,
                easterEggPrinted: true
            });

            await openPrintMonitor(page);

            const customerEasterEggJob = page.getByRole("button")
                .filter({ hasText: "Easter egg" })
                .filter({ hasText: "ORDER" })
                .first();
            await expect(customerEasterEggJob).toBeVisible({ timeout: 15000 });
            await customerEasterEggJob.click();
            await expect(page.getByTestId("print-job-preview")).toBeVisible({ timeout: 15000 });
            await expect(page.getByText(/Anteprima ESC\/POS raw non disponibile/i)).toHaveCount(0);
        } finally {
            if (publicContext) {
                await publicContext.close().catch(() => undefined);
            }
            if (cashierContext) {
                await cashierContext.close().catch(() => undefined);
            }
            if (eventCreated && !page.isClosed()) {
                await ensureAdminAuthenticated(page, "/admin");
                await deleteEvent(page, eventName);
            }
        }
    });
});
