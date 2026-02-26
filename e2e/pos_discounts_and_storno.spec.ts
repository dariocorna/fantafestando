import { expect, test, type Page } from "@playwright/test"

async function createAndActivateEvent(page: Page, eventName: string) {
    await page.goto("/admin/settings/events")

    await page.click("#new-event-btn")
    const dialog = page.getByRole("dialog")
    await dialog.locator("#name").fill(eventName)
    await dialog.getByRole("button", { name: "Salva", exact: true }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByText(eventName)).toBeVisible()

    await page.click('[data-testid="admin-event-selector"]')
    await page.getByRole("option", { name: new RegExp(eventName) }).click()
    await expect(page.getByTestId("admin-event-selector")).toContainText(eventName)

    await page.goto("/admin/settings")
    const activeCheckbox = page.locator('input[name="active"]')
    if (!(await activeCheckbox.isChecked())) {
        await activeCheckbox.check()
    }
    await page.locator("#quick-discount-add-preset").click()
    await page.getByTestId("quick-discount-label-0").fill("Staff")
    await page.getByTestId("quick-discount-type-0").selectOption("PERCENT")
    await page.getByTestId("quick-discount-value-0").fill("50")

    await page.locator("#quick-discount-add-preset").click()
    await page.getByTestId("quick-discount-label-1").fill("Promo Cassa")
    await page.getByTestId("quick-discount-type-1").selectOption("FIXED")
    await page.getByTestId("quick-discount-value-1").fill("2")
    await page.getByRole("button", { name: /Salva Impostazioni/i }).click()
    await expect(page.getByText(/Modifiche salvate/i)).toBeVisible()
}

async function configureCashPos(
    page: Page,
    printerName: string,
    printerIp: string,
    cashBoxName: string,
    posName: string
) {
    await page.goto("/admin/settings/hardware")

    await page.getByRole("button", { name: /Nuova Stampante/i }).click()
    const printerDialog = page.getByRole("dialog")
    await printerDialog.getByLabel("Nome Stampante").fill(printerName)
    await printerDialog.getByLabel("Indirizzo IP").fill(printerIp)
    await printerDialog.getByRole("combobox", { name: "Tipo Stampante" }).click()
    await page.getByRole("option", { name: "Cassa (Scontrino Cliente)" }).click()
    await printerDialog.getByRole("button", { name: "Salva", exact: true }).click()
    await expect(page.getByText(printerName)).toBeVisible()

    await page.getByRole("tab", { name: "Periferiche" }).click()
    await page.getByRole("button", { name: /Nuova Periferica/i }).click()
    const peripheralDialog = page.getByRole("dialog")
    await peripheralDialog.getByLabel("Nome Descrittivo").fill(cashBoxName)
    await peripheralDialog.getByRole("combobox", { name: "Tipo Periferica" }).click()
    await page.getByRole("option", { name: "Cassetta Contanti (Manuale)" }).click()
    await peripheralDialog.getByRole("button", { name: "Aggiungi Periferica", exact: true }).click()
    await expect(page.getByText(cashBoxName)).toBeVisible()

    await page.goto("/admin/settings/pos")
    await page.getByRole("button", { name: /Nuovo Dispositivo/i }).click()
    const posDialog = page.getByRole("dialog")
    await posDialog.getByLabel("Nome Postazione").fill(posName)
    await posDialog.getByRole("combobox", { name: "Stampante Associata" }).click()
    await page.getByRole("option", { name: new RegExp(printerName) }).click()
    await posDialog.getByRole("combobox", { name: "Cassetta Contanti (Manuale)" }).click()
    await page.getByRole("option", { name: new RegExp(cashBoxName) }).click()
    await posDialog.getByRole("button", { name: "Salva", exact: true }).click()
    await expect(page.getByText(posName)).toBeVisible()
}

async function createCategoryAndProducts(
    page: Page,
    categoryName: string,
    products: Array<{ name: string, price: string }>
) {
    await page.goto("/admin/catalog")

    await page.click("#new-category-btn")
    await page.fill("#cat-name", categoryName)
    await page.getByRole("button", { name: "Salva Categoria", exact: true }).click()
    await expect(page.getByText(categoryName)).toBeVisible()

    for (const product of products) {
        await page.click("#new-product-btn")
        const dialog = page.getByRole("dialog")
        await dialog.getByLabel("Nome").fill(product.name)
        await dialog.getByLabel("Prezzo Base (€)").fill(product.price)
        await dialog.locator('select[name="categoryId"]').selectOption({ label: categoryName })
        await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click()
        await expect(dialog).toBeHidden()
        await expect(page.getByText(product.name)).toBeVisible()
    }
}

async function openPosAndSelectDevice(page: Page, posName: string) {
    await page.goto("/pos")
    await page.evaluate(() => localStorage.removeItem("osgfest_pos_id"))
    await page.reload()

    await page.waitForResponse(
        (response) => response.url().includes("/api/pos/init") && response.ok(),
        { timeout: 10000 }
    )

    const selectorTitle = page.getByText(/In quale cassa sei\?/i)
    if (await selectorTitle.isVisible()) {
        const posButton = page.getByRole("dialog").locator("button").filter({ hasText: new RegExp(posName) }).first()
        await expect(posButton).toBeVisible()
        await posButton.click()
        await expect(selectorTitle).toBeHidden()
    }
}

async function openCashSession(page: Page, openingFloatAmount: string) {
    await page.getByRole("button", { name: /Apri Cassa/i }).click()
    const openDialog = page.getByRole("dialog").filter({ hasText: /Apertura Cassa/i })
    await expect(openDialog).toBeVisible()
    await openDialog.locator("#opening-float-amount").fill(openingFloatAmount)
    await openDialog.getByRole("button", { name: "APRI CASSA", exact: true }).click()
    await expect(page.getByRole("button", { name: /Chiudi Cassa/i })).toBeVisible()
}

async function addProductsToCart(page: Page, categoryName: string, productNames: string[]) {
    const firstProductName = productNames[0]
    const firstProductButton = page.locator("button").filter({ hasText: new RegExp(firstProductName) }).first()

    for (let attempt = 0; attempt < 4; attempt++) {
        const categoryButton = page.getByRole("button", { name: categoryName, exact: true })
        if (await categoryButton.isVisible().catch(() => false)) {
            await categoryButton.click()
        }

        if (await firstProductButton.isVisible().catch(() => false)) {
            break
        }

        if (attempt === 3) {
            throw new Error(`Catalogo POS non pronto: categoria/prodotto non trovati (${categoryName}, ${firstProductName})`)
        }

        await page.reload()
        await page.waitForResponse(
            (response) => response.url().includes("/api/pos/init") && response.ok(),
            { timeout: 10000 }
        )
    }

    for (const name of productNames) {
        await page.locator("button").filter({ hasText: new RegExp(name) }).first().click()
    }
}

async function completeCheckout(page: Page) {
    const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
    await expect(checkoutDialog).toBeVisible()
    const confirmButton = checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true })
    await confirmButton.scrollIntoViewIfNeeded()
    await confirmButton.click()
    await expect(checkoutDialog).toBeHidden({ timeout: 15000 })

    const successModal = page.getByRole("dialog").filter({ hasText: /Ordine completato correttamente/i })
    if (await successModal.isVisible()) {
        await successModal.getByRole("button", { name: "OK", exact: true }).click()
        await expect(successModal).toBeHidden()
    }
}

test.describe("POS sconti e storno ordine", () => {
    test.describe.configure({ mode: "serial" })

    test("applica sconto ordine e riga, poi storna in admin", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(150000)

        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
        const eventName = `Discount Event ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `Discount Cat ${suffix}`
        const productA = `Discount Product A ${suffix}`
        const productB = `Discount Product B ${suffix}`

        await createAndActivateEvent(page, eventName)
        await configureCashPos(page, printerName, `192.168.1.${Math.floor(Math.random() * 150) + 50}`, cashBoxName, posName)
        await createCategoryAndProducts(page, categoryName, [
            { name: productA, price: "8.00" },
            { name: productB, price: "4.00" }
        ])

        await openPosAndSelectDevice(page, posName)
        await openCashSession(page, "50")

        // Ordine 1: sconto rapido configurato in admin (Staff 50%)
        await addProductsToCart(page, categoryName, [productA, productB])
        await page.locator("#discounts-tab-trigger").click()
        await expect(page.locator("#discount-preset-card-0")).toBeVisible()
        await expect(page.locator("#discount-preset-card-1")).toBeVisible()
        await page.locator("#discount-preset-card-0").click()
        await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/6\.00\s*€/i)
        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        await completeCheckout(page)

        // Ordine 2: preset fisso Promo Cassa (-2€)
        await addProductsToCart(page, categoryName, [productA, productB])
        await page.locator("#discounts-tab-trigger").click()
        await page.locator("#discount-preset-card-1").click()
        await expect(page.getByText(/Totale da Pagare/i).locator("..")).toContainText(/10\.00\s*€/i)
        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        await completeCheckout(page)

        await page.goto("/admin/orders")
        const rows = page.locator("tbody tr")
        await expect(rows.first()).toContainText(/2\.00\s*€/i)
        await expect(rows.first()).toContainText(/10\.00\s*€/i)
        await expect(rows.nth(1)).toContainText(/6\.00\s*€/i)
        await expect(rows.nth(1)).toContainText(/6\.00\s*€/i)

        const dialogHandler = async (dialog: { type: () => string; accept: (promptText?: string) => Promise<void> }) => {
            if (dialog.type() === "confirm") {
                await dialog.accept()
                return
            }
            if (dialog.type() === "prompt") {
                await dialog.accept("Storno test E2E")
                return
            }
            await dialog.accept()
        }
        page.on("dialog", dialogHandler)
        await rows.first().locator('button[title="Storna ordine"]').click()
        await expect(rows.first()).toContainText(/Stornato/i)
        await expect(rows.first()).toContainText(/Motivo storno:\s*Storno test E2E/i)
        page.off("dialog", dialogHandler)

        const revenueCard = page.locator("div").filter({ hasText: /Totale Incasso Netto/i }).first()
        await expect(revenueCard).toContainText(/6\.00\s*€/i)
    })
})
