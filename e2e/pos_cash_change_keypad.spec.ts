import { expect, test } from "@playwright/test"
import {
    configureCashPos,
    configureElectronicPos,
    createAndActivateEvent,
    createCategoryAndProducts,
    deleteEvent,
    localPrinterIp,
    openCashSession,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures"

test.describe("POS calcolo resto contanti", () => {
    test("calcola resto, blocca importi insufficienti e completa il pagamento contanti", async ({ page, isMobile }) => {
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Cash Change Event ${suffix}`
        const printerName = `Cash Change Printer ${suffix}`
        const cashBoxName = `Cash Change Box ${suffix}`
        const posName = `Cash Change POS ${suffix}`
        const categoryName = `Cash Change Cat ${suffix}`
        const productName = `Cash Change Product ${suffix}`

        try {
            await createAndActivateEvent(page, eventName)
            await configureCashPos(page, printerName, localPrinterIp(), cashBoxName, posName)
            await createCategoryAndProducts(page, categoryName, [{ name: productName, price: "18.50" }])

            await openPosAndSelectDevice(page, posName)
            await openCashSession(page, "50")

            await page.getByRole("button", { name: "Scorte", exact: true }).click()
            await expect(page.getByTestId("pos-stock-mode-banner")).toBeVisible()
            const stockEditor = page.getByRole("region", { name: `Modifica scorte ${productName}` })
            await stockEditor.getByRole("spinbutton", { name: `Scorta ${productName}`, exact: true }).fill("5")
            await stockEditor.getByRole("button", { name: `Salva scorta ${productName}`, exact: true }).click()
            await expect(stockEditor.getByRole("status")).toHaveText(`Scorta ${productName} aggiornata a 5`)
            await page.getByRole("button", { name: "Termina scorte", exact: true }).click()

            await page.locator("button").filter({ hasText: new RegExp(productName) }).first().click()
            if (isMobile) await page.getByTestId("pos-mobile-cart-bar").click()
            await page.getByTestId("pos-pay-cta").click()

            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
            await expect(checkoutDialog).toBeVisible()
            const changeCard = checkoutDialog.getByTestId("cash-change-card")
            await expect(changeCard).toBeVisible()

            await changeCard.getByRole("button", { name: "20.00 €", exact: true }).click()
            await expect(changeCard.getByTestId("cash-change-due")).toContainText("Resto 1.50 €")

            await page.keyboard.press("c")
            await page.keyboard.press("2")
            await page.keyboard.press("0")
            await expect(changeCard.getByTestId("cash-change-due")).toContainText("Resto 1.50 €")

            await changeCard.getByRole("button", { name: "Cancella importo ricevuto" }).click()
            await expect(changeCard.getByRole("button", { name: "1", exact: true })).toHaveCount(0)
            await changeCard.getByRole("button", { name: "Tastierino manuale", exact: true }).click()
            await expect(changeCard.getByRole("button", { name: "00", exact: true })).toBeVisible()
            await expect(checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true })).toBeInViewport()
            await changeCard.getByRole("button", { name: "1", exact: true }).click()
            await changeCard.getByRole("button", { name: "0", exact: true }).click()
            await expect(changeCard.getByTestId("cash-change-missing")).toContainText("Mancano 8.50 €")
            await expect(checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true })).toBeDisabled()

            await changeCard.getByRole("button", { name: "Cancella importo ricevuto" }).click()
            await changeCard.getByRole("button", { name: "2", exact: true }).click()
            await changeCard.getByRole("button", { name: "0", exact: true }).click()
            await expect(changeCard.getByTestId("cash-change-due")).toContainText("Resto 1.50 €")

            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
        } finally {
            await deleteEvent(page, eventName)
        }
    })

    test("non mostra il calcolo resto nel pagamento carta", async ({ page, isMobile }) => {
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Card No Change Event ${suffix}`
        const printerName = `Card No Change Printer ${suffix}`
        const terminalName = `Card No Change Terminal ${suffix}`
        const posName = `Card No Change POS ${suffix}`
        const categoryName = `Card No Change Cat ${suffix}`
        const productName = `Card No Change Product ${suffix}`

        try {
            await createAndActivateEvent(page, eventName)
            await createCategoryAndProducts(page, categoryName, [{ name: productName, price: "3.00" }])
            await configureElectronicPos(page, printerName, localPrinterIp(), terminalName, posName)

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page, "50")

            await page.locator("button").filter({ hasText: new RegExp(productName) }).first().click()
            if (isMobile) await page.getByTestId("pos-mobile-cart-bar").click()
            await page.getByTestId("pos-pay-cta").click()

            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
            await expect(checkoutDialog).toBeVisible()
            await expect(checkoutDialog.getByTestId("cash-change-card")).toHaveCount(0)
            await expect(checkoutDialog.getByTestId("card-payment-guide")).toContainText(
                "Completa il pagamento sul terminale POS, poi premi Conferma.",
            )

            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 })
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
