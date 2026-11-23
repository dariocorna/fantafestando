import { test, expect } from "@playwright/test"
import { cleanupEventArtifactsByName } from "./utils/db"
import {
    createAndActivateEvent,
    configureElectronicPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    completeElectronicOrder,
    closeCashSession,
    uniqueSuffix,
    localPrinterIp,
} from "./utils/fixtures"

test.describe("POS - Elaborazione pagamenti manuali elettronici", () => {
    test("incassa e storna un ordine con pagamento elettronico manuale", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso testato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Epic 14 Event ${suffix}`
        const categoryName = `Bevande ${suffix}`
        const productName = `Acqua ${suffix}`
        const printerName = `Printer ${suffix}`
        const electronicTerminalName = `PosTerminal ${suffix}`
        const posName = `Cassa Elett. ${suffix}`

        try {
            await createAndActivateEvent(page, eventName)
            await createCategoryAndProducts(page, categoryName, [
                { name: productName, price: "2.00", stock: "1" },
            ])
            await configureElectronicPos(page, printerName, localPrinterIp(), electronicTerminalName, posName)

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

            await page.goto("/admin/catalog")
            const productRow = page.getByRole("row").filter({ hasText: productName })
            await expect(productRow).toContainText("Esaurito")

            await page.goto("/admin/orders")
            const orderRow = page.getByRole("row").filter({ hasText: productName })
            const alerts: string[] = []
            page.on("dialog", async (dialog) => {
                if (dialog.type() === "alert") alerts.push(dialog.message())
                await dialog.accept(dialog.type() === "prompt" ? "Storno elettronico manuale" : undefined)
            })
            await orderRow.getByTitle("Storna ordine").click()
            await expect(orderRow).toContainText("Stornato")
            await expect.poll(() => alerts).toContainEqual(expect.stringMatching(/manualmente sul terminale fisico/i))

            await page.goto("/admin")
            await expect(page.getByTestId("dashboard-kpi-card")).toContainText("0,00")
            await expect(page.getByTestId("dashboard-kpi-orders")).toContainText("0")

            await page.goto("/admin/catalog")
            await expect(productRow).toContainText("Scorte basse (1)")
        } finally {
            await cleanupEventArtifactsByName(eventName)
        }
    })
})
