import { expect, test, type Page } from "@playwright/test";
import type { Types } from "mongoose";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    completeCashOrder,
    createVirtualPrinterDirect,
    openCashSessionIfRequired,
    seedActiveEventWithCatalog,
    setAdminEventContextCookie,
    uniqueSuffix,
} from "./utils/fixtures";
import { cleanupEventArtifactsByName } from "./utils/db";
import Category from "../src/models/Category";
import Peripheral from "../src/models/Peripheral";
import PosDevice from "../src/models/PosDevice";
import PrintJob from "../src/models/PrintJob";
import Product from "../src/models/Product";

async function savePosCatalogLayout(page: Page, layout: "COMPACT_COLUMNS" | "MODERN_TABS") {
    await page.goto("/admin/settings");
    const save = page.getByRole("button", { name: /Salva Impostazioni/i });
    await expect(save).toBeEnabled();
    const activeCheckbox = page.locator('input[name="active"]');
    if (!(await activeCheckbox.isChecked())) await activeCheckbox.check();

    const layoutSelect = page.locator("#posCatalogLayout");
    await layoutSelect.selectOption(layout);
    await expect(layoutSelect).toHaveValue(layout);
    await save.click();
    await expect(page.getByText(/Modifiche salvate/i)).toBeVisible();
}

async function closePosSelectorIfVisible(page: Page) {
    const selectorTitle = page.getByText(/In quale cassa sei\?/i);
    if (!(await selectorTitle.isVisible().catch(() => false))) return;

    const firstDevice = page.getByRole("dialog").locator("button").filter({ hasText: /Stampante:/i }).first();
    if (await firstDevice.isVisible().catch(() => false)) {
        await firstDevice.click();
        await expect(selectorTitle).toBeHidden();
        return;
    }
    await page.keyboard.press("Escape");
}

async function openPos(page: Page) {
    await page.goto("/pos");
    await page.waitForResponse(
        (r) => r.url().includes("/api/pos/init?channel=pos") && r.ok(),
        { timeout: 15000 },
    ).catch(() => null);
    await closePosSelectorIfVisible(page);
}

test.describe("Layout catalogo POS da impostazioni admin", () => {
    test("divide i dolci a video e stampa una comanda per prodotto con la quantità completa", async ({ page, isMobile }) => {
        test.skip(isMobile, "Layout compatto desktop.");
        const suffix = uniqueSuffix();
        const eventName = `POS catalogo e stampa ${suffix}`;
        const posName = `Cassa ${suffix}`;
        const names = Array.from({ length: 9 }, (_, index) => `Dolce ${index + 1}`);

        try {
            const { eventId } = await seedActiveEventWithCatalog(eventName, "Dolci", names.map((name) => ({ name, price: "2.50" })));
            const categories: Array<{ _id: Types.ObjectId; name: string }> = await Category.create([
                { eventId, name: "Bevande", uiColor: "#2563eb", printOrder: -1 },
                { eventId, name: "Gastronomia", uiColor: "#16a34a", printOrder: 1 },
            ]);
            await Product.insertMany(categories.flatMap((category, index) =>
                Array.from({ length: index === 0 ? 4 : 2 }, (_, product) => ({
                    eventId, categoryId: category._id, name: `${category.name} ${product}`, basePrice: 2,
                })),
            ));
            await Product.updateMany({ eventId, name: { $in: names } }, { splitKitchenPrintPerUnit: true });
            const { printerId } = await createVirtualPrinterDirect({ eventName, printerName: posName });
            const cashBox = await Peripheral.create({ eventId, name: posName, type: "CASH_BOX", config: {} });
            await PosDevice.create({ eventId, name: posName, printerId, cashBoxId: cashBox._id });
            await setAdminEventContextCookie(page, eventId);
            await ensureAdminAuthenticated(page, "/admin/settings");

            const save = page.getByRole("button", { name: /Salva Impostazioni/i });
            await expect(save).toBeEnabled();
            const summary = page.getByLabel("Riepilogo ordine in cassa");
            const grouping = page.getByLabel("Raggruppamento comande");
            await expect(summary).toHaveValue("false");
            await expect(grouping).toHaveValue("false");
            await summary.selectOption("true");
            await grouping.selectOption("true");
            await save.click();
            await expect(page.getByText(/Modifiche salvate/i)).toBeVisible();
            await page.reload();
            await expect(summary).toHaveValue("true");
            await expect(grouping).toHaveValue("true");

            await page.setViewportSize({ width: 1024, height: 768 });
            await page.goto("/pos");
            await page.getByRole("dialog", { name: /In quale cassa sei/i })
                .getByRole("button", { name: new RegExp(posName) }).click();
            await expect(page.getByRole("dialog", { name: /In quale cassa sei/i })).toBeHidden();
            await openCashSessionIfRequired(page, "0");
            const catalog = page.getByTestId("pos-all-categories-catalog");
            const desserts = catalog.locator("article").filter({ has: page.getByRole("heading", { name: "Dolci", exact: true }) });
            const productButtons = '[data-testid^="pos-product-"]';
            await expect(desserts).toHaveCount(2);
            await expect(desserts.first().locator(productButtons)).toHaveCount(5);
            await expect(desserts.last().locator(productButtons)).toHaveCount(4);
            await expect(desserts.locator(productButtons)).toHaveText(names);
            for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 800 }]) {
                await page.setViewportSize(viewport);
                await expect(desserts.last()).toBeInViewport({ ratio: 1 });
                await expect.poll(() => catalog.evaluate((element) => {
                    const scrollContainer = element.closest(".overflow-y-auto");
                    return scrollContainer ? scrollContainer.scrollHeight - scrollContainer.clientHeight : null;
                })).toBe(0);
            }

            await completeCashOrder(page, [{ name: names[0], quantity: 3 }, { name: names[5], quantity: 2 }]);
            const jobs = await PrintJob.find({ eventId, source: "ORDER" }).lean();
            expect(jobs.map(({ printType, status, document }) => ({
                printType, status, items: document.items,
            }))).toEqual(expect.arrayContaining([
                { printType: "CUSTOMER_ORDER", status: "SENT", items: [expect.objectContaining({ name: names[0], quantity: 3 })] },
                { printType: "CUSTOMER_ORDER", status: "SENT", items: [expect.objectContaining({ name: names[5], quantity: 2 })] },
            ]));
            expect(jobs).toHaveLength(2);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });

    test("mantiene il layout selezionato anche dopo reload POS", async ({ page, isMobile }) => {
        test.skip(isMobile, "Scenario validato su desktop.");

        const suffix = uniqueSuffix();
        const eventName = `POS Layout ${suffix}`;
        const categoryName = `Layout Cat ${suffix}`;
        const productName = `Layout Product ${suffix}`;
        const productShortName = `LYT-${suffix}`;

        try {
            await seedActiveEventWithCatalog(eventName, categoryName, [
                { name: productName, shortName: productShortName, price: "3.50" }
            ]);

            await ensureAdminAuthenticated(page, "/admin");

            await savePosCatalogLayout(page, "MODERN_TABS");

            const response = await page.request.get("/api/pos/init?channel=pos");
            expect(response.ok()).toBeTruthy();
            const payload = await response.json();
            expect(payload?.event?.settings?.posCatalogLayout).toBe("MODERN_TABS");

            await openPos(page);
            await expect(page.getByText(/Categoria attiva/i)).toBeVisible();
            await page.getByRole("button").filter({ hasText: categoryName }).first().click();
            await expect(page.getByRole("button").filter({ hasText: productShortName }).first()).toBeVisible();

            await page.reload();
            await page.waitForResponse(
                (r) => r.url().includes("/api/pos/init?channel=pos") && r.ok(),
                { timeout: 15000 },
            ).catch(() => null);
            await closePosSelectorIfVisible(page);
            await expect(page.getByText(/Categoria attiva/i)).toBeVisible();
            await page.getByRole("button").filter({ hasText: categoryName }).first().click();

            await savePosCatalogLayout(page, "COMPACT_COLUMNS");

            const response2 = await page.request.get("/api/pos/init?channel=pos");
            expect(response2.ok()).toBeTruthy();
            const payload2 = await response2.json();
            expect(payload2?.event?.settings?.posCatalogLayout).toBe("COMPACT_COLUMNS");

            await openPos(page);
            await expect(page.getByText(/Categoria attiva/i)).toHaveCount(0);
            await expect(page.getByRole("button").filter({ hasText: productShortName }).first()).toBeVisible();

            await page.reload();
            await page.waitForResponse(
                (r) => r.url().includes("/api/pos/init?channel=pos") && r.ok(),
                { timeout: 15000 },
            ).catch(() => null);
            await closePosSelectorIfVisible(page);
            await expect(page.getByText(/Categoria attiva/i)).toHaveCount(0);
        } finally {
            await cleanupEventArtifactsByName(eventName);
        }
    });
});
