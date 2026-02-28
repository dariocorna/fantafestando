import { expect, test } from "@playwright/test"
import {
    createAndActivateEvent,
    configureCashPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    completeCashOrder,
    uniqueSuffix,
    randomIp,
} from "./utils/fixtures"

test.describe("POS apertura e chiusura cassa", () => {
    test.describe.configure({ mode: "serial" })

    test("richiede apertura cassa, consente incasso e poi chiusura con riepilogo", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Cash Session Event ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `Cash Session Cat ${suffix}`
        const productName = `Cash Product ${suffix}`

        await createAndActivateEvent(page, eventName)
        await configureCashPos(page, printerName, randomIp(), cashBoxName, posName)
        await createCategoryAndProducts(page, categoryName, [{ name: productName, price: "5.00" }])

        await openPosAndSelectDevice(page, posName)

        await expect(page.getByText(/Chiusa\. Apri la cassa per iniziare gli incassi\./i)).toBeVisible()
        await expect(page.getByRole("button", { name: "PAGA ORA", exact: true })).toBeDisabled()

        // Open cash session
        await page.getByRole("button", { name: /Apri Cassa/i }).click()
        const openDialog = page.getByRole("dialog").filter({ hasText: /Apertura Cassa/i })
        await expect(openDialog).toBeVisible()
        await openDialog.locator("#opening-float-amount").fill("50")
        await openDialog.getByRole("button", { name: "APRI CASSA", exact: true }).click()
        await expect(page.getByRole("button", { name: /Chiudi Cassa/i })).toBeVisible()

        await expect(page.getByText(/Aperta alle/i)).toBeVisible()
        await expect(page.getByText(/Fondo 50\.00 €/i)).toBeVisible()

        await completeCashOrder(page, productName)

        // Close cash session and verify summary
        await page.getByRole("button", { name: /Chiudi Cassa/i }).click()
        const closeDialog = page.getByRole("dialog").filter({ hasText: /Chiusura Cassa/i })
        await expect(closeDialog).toBeVisible()
        await expect(closeDialog.getByText(/Contante atteso/i)).toBeVisible()
        await expect(closeDialog.getByText(/Fondo \+ incassi in contanti \(esclusi pagamenti elettronici\)/i)).toBeVisible()
        await expect(closeDialog.getByText(/55\.00\s*€/i)).toBeVisible()
        await closeDialog.locator("#closing-counted-cash").fill("55")
        await expect(closeDialog.getByRole("button", { name: "CONFERMA CHIUSURA", exact: true })).toBeEnabled()
        await closeDialog.getByRole("button", { name: "CONFERMA CHIUSURA", exact: true }).click()
        await expect(page.getByRole("button", { name: /Apri Cassa/i })).toBeVisible()

        await expect(page.getByText(/Chiusa\. Apri la cassa per iniziare gli incassi\./i)).toBeVisible()
        await expect(page.getByText(/Atteso: 55\.00 € · Contato: 55\.00 €/i)).toBeVisible()
        await expect(page.getByText(/Differenza: 0\.00 €/i)).toBeVisible()
        await expect(page.getByRole("button", { name: "PAGA ORA", exact: true })).toBeDisabled()
    })
})
