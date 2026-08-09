import { expect, test, type Page } from "@playwright/test"
import Peripheral from "../src/models/Peripheral"
import PosDevice from "../src/models/PosDevice"
import {
    createActiveEventWithCatalogDirect,
    createVirtualPrinterDirect,
    deleteEvent,
    dismissFeedbackModal,
    openCashSessionIfRequired,
    openPosAndSelectDevice,
    uniqueSuffix,
} from "./utils/fixtures"

async function openCheckout(page: Page, productName: string) {
    await page.locator("button").filter({ hasText: new RegExp(productName) }).first().click()
    const payButton = page.getByRole("button", { name: "PAGA ORA", exact: true })
    await expect(payButton).toBeEnabled()
    await payButton.click()
    const dialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
    await expect(dialog).toBeVisible()
    return dialog
}

test.describe("POS - ultimo metodo di pagamento", () => {
    test("ricorda il metodo per postazione e usa il fallback se non è disponibile", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso testato su desktop.")

        const suffix = uniqueSuffix()
        const eventName = `Payment Preference ${suffix}`
        const categoryName = `Payment Category ${suffix}`
        const productName = `Payment Product ${suffix}`
        const printerName = `Payment Printer ${suffix}`
        const cashBoxName = `Payment CashBox ${suffix}`
        const terminalName = `Payment Terminal ${suffix}`
        const posName = `Payment POS ${suffix}`

        try {
            const { eventId } = await createActiveEventWithCatalogDirect(
                eventName,
                categoryName,
                [{ name: productName, price: "2.00" }],
            )
            const { printerId } = await createVirtualPrinterDirect({ eventName, printerName, type: "CASHIER" })
            const [cashBox, terminal] = await Promise.all([
                Peripheral.create({ eventId, name: cashBoxName, type: "CASH_BOX", config: {} }),
                Peripheral.create({ eventId, name: terminalName, type: "ELECTRONIC_MANUAL", config: {} }),
            ])
            const posDevice = await PosDevice.create({
                eventId,
                name: posName,
                printerId,
                cashBoxId: cashBox._id,
                paymentTerminalId: terminal._id,
            })

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)

            const firstCheckout = await openCheckout(page, productName)
            await expect(firstCheckout.getByRole("button", { name: "CONTANTI", exact: true })).toHaveAttribute("aria-pressed", "true")
            await firstCheckout.getByRole("button", { name: "CARTA / POS", exact: true }).click()
            await firstCheckout.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(firstCheckout).toBeHidden()
            await dismissFeedbackModal(page)
            expect(await page.evaluate(
                (id) => localStorage.getItem(`fantafestando_pos_payment_method:${id}`),
                String(posDevice!._id),
            )).toBe("CARD")

            await PosDevice.updateOne({ _id: posDevice!._id }, { $unset: { paymentTerminalId: 1 } })
            await page.reload()
            const fallbackCheckout = await openCheckout(page, productName)
            await expect(fallbackCheckout.getByRole("button", { name: "CONTANTI", exact: true })).toHaveAttribute("aria-pressed", "true")
            await expect(fallbackCheckout.getByRole("button", { name: "CARTA / POS", exact: true })).toHaveCount(0)

            await PosDevice.updateOne({ _id: posDevice!._id }, { $set: { paymentTerminalId: terminal._id } })
            await page.reload()
            const rememberedCardCheckout = await openCheckout(page, productName)
            await expect(rememberedCardCheckout.getByRole("button", { name: "CARTA / POS", exact: true })).toHaveAttribute("aria-pressed", "true")
            await rememberedCardCheckout.getByRole("button", { name: "CONTANTI", exact: true }).click()
            await rememberedCardCheckout.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(rememberedCardCheckout).toBeHidden()
            await dismissFeedbackModal(page)

            const rememberedCashCheckout = await openCheckout(page, productName)
            await expect(rememberedCashCheckout.getByRole("button", { name: "CONTANTI", exact: true })).toHaveAttribute("aria-pressed", "true")
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
