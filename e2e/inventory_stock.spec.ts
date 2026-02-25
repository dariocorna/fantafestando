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

async function createStockProduct(page: Page, categoryName: string, productName: string, stockQuantity: string) {
    await page.goto("/admin/catalog")

    await page.click("#new-category-btn")
    await page.fill("#cat-name", categoryName)
    await page.getByRole("button", { name: "Salva Categoria", exact: true }).click()
    await expect(page.getByText(categoryName)).toBeVisible()

    await page.click("#new-product-btn")
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Nome").fill(productName)
    await dialog.getByLabel("Prezzo Base (€)").fill("8.00")
    await dialog.locator('select[name="categoryId"]').selectOption({ label: categoryName })
    await dialog.getByLabel("Scorte").fill(stockQuantity)
    await dialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click()
    await expect(dialog).toBeHidden()

    const productRow = page.locator("tr").filter({ hasText: productName })
    await expect(productRow).toContainText("Scorte basse")
}

async function openPosAndSelectDevice(page: Page, posName: string) {
    await page.goto("/pos")
    await page.evaluate(() => localStorage.removeItem("osgfest_pos_id"))
    await page.reload()

    await page.waitForResponse(
        response => response.url().includes("/api/pos/init") && response.ok(),
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

async function openCashSessionIfRequired(page: Page, openingFloatAmount = "0") {
    const openButton = page.getByRole("button", { name: /Apri Cassa/i })
    if (!(await openButton.isVisible())) return

    await openButton.click()
    const openDialog = page.getByRole("dialog").filter({ hasText: /Apertura Cassa/i })
    await expect(openDialog).toBeVisible()
    await openDialog.locator("#opening-float-amount").fill(openingFloatAmount)
    await openDialog.getByRole("button", { name: "APRI CASSA", exact: true }).click()
    await expect(page.getByRole("button", { name: /Chiudi Cassa/i })).toBeVisible()
}

async function closeSuccessModalIfVisible(page: Page) {
    const successModal = page.getByRole("dialog").filter({ hasText: /Ordine completato correttamente/i })
    if (!(await successModal.isVisible())) return
    await successModal.getByRole("button", { name: "OK", exact: true }).click()
    await expect(successModal).toBeHidden()
}

test.describe("Magazzino e scorte base", () => {
    test.describe.configure({ mode: "serial" })

    test("gestisce esaurimento menu e override POS con conferma cassiere", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(120000)

        const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
        const eventName = `Stock Event ${suffix}`
        const categoryName = `Stock Cat ${suffix}`
        const productName = `Stock Product ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`

        await createAndActivateEvent(page, eventName)
        await configureCashPos(page, printerName, `192.168.1.${Math.floor(Math.random() * 150) + 50}`, cashBoxName, posName)
        await createStockProduct(page, categoryName, productName, "1")

        await page.goto("/menu")
        await page.waitForResponse(
            response => response.url().includes("/api/pos/init") && response.ok(),
            { timeout: 10000 }
        )
        await expect(page.getByText(productName)).toBeVisible()

        await openPosAndSelectDevice(page, posName)
        await openCashSessionIfRequired(page)

        const productButton = page.locator("button").filter({ hasText: productName }).first()
        await expect(productButton).toContainText(/Scorte basse/i)
        await productButton.click()

        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
        await expect(checkoutDialog).toBeVisible()
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
        await expect(checkoutDialog.getByText(/Stampa in corso/i).first()).toBeVisible()
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
        await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible()
        await closeSuccessModalIfVisible(page)

        await page.goto("/admin/catalog")
        const productRow = page.locator("tr").filter({ hasText: productName })
        await expect(productRow).toContainText("Esaurito")

        await page.goto("/menu")
        await page.waitForResponse(
            response => response.url().includes("/api/pos/init") && response.ok(),
            { timeout: 10000 }
        )
        await expect(page.getByText(productName)).toHaveCount(0)

        await page.goto("/pos")
        await page.waitForResponse(
            response => response.url().includes("/api/pos/init") && response.ok(),
            { timeout: 10000 }
        )
        const soldOutProductButton = page.locator("button").filter({ hasText: productName }).first()
        await expect(soldOutProductButton).toContainText(/Esaurito/i)
        await soldOutProductButton.click()

        await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
        await expect(checkoutDialog).toBeVisible()
        await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()

        await expect(checkoutDialog.getByText(/Scorte insufficienti rilevate/i)).toBeVisible()
        await expect(checkoutDialog.locator("li").filter({ hasText: new RegExp(`^${productName}:`) })).toBeVisible()

        await checkoutDialog.getByRole("button", { name: "Prosegui comunque", exact: true }).click()
        await expect(checkoutDialog.getByText(/Stampa in corso/i).first()).toBeVisible()
        await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
        await expect(page.getByText(/Il carrello è vuoto/i)).toBeVisible()
        await closeSuccessModalIfVisible(page)
    })
})
