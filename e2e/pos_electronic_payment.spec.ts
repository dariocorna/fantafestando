import { test, expect } from "@playwright/test"
import {
    createAndActivateEvent,
    configureElectronicPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    completeElectronicOrder,
    closeCashSession,
    uniqueSuffix,
    randomIp,
} from "./utils/fixtures"

test.describe("POS - Elaborazione pagamenti manuali elettronici", () => {
    test("consente la creazione di un ordine con pagamento elettronico manuale", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso testato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Epic 14 Event ${suffix}`
        const categoryName = `Bevande ${suffix}`
        const productName = `Acqua ${suffix}`
        const printerName = `Printer ${suffix}`
        const electronicTerminalName = `PosTerminal ${suffix}`
        const posName = `Cassa Elett. ${suffix}`

        await createAndActivateEvent(page, eventName)
        await createCategoryAndProducts(page, categoryName, [
            { name: productName, price: "2.00" },
        ])
        await configureElectronicPos(page, printerName, randomIp(), electronicTerminalName, posName)

        await openPosAndSelectDevice(page, posName)
        await openCashSessionIfRequired(page, "50")

        await completeElectronicOrder(page, productName)

        // Verifica export/sessione
        await closeCashSession(page, "50.00")

        // Admin verifica ordini
        await page.goto("/admin/orders")
        await expect(page.locator("table")).toContainText(productName)
        await expect(page.locator("table")).toContainText("Carta / POS") // Method check

        // Admin verifica incasso nella dashboard
        await page.goto("/admin")
        await expect(page.getByTestId("dashboard-kpi-card")).toContainText("2,00")
        await expect(page.getByTestId("dashboard-kpi-orders")).toContainText("1")
    })
})
