import { expect, test } from "@playwright/test"
import {
    createAndActivateEvent,
    configureCashPos,
    createCategoryAndProducts,
    openPosAndSelectDevice,
    openCashSession,
    completeCashOrder,
    closeCashSession,
    uniqueSuffix,
    randomIp,
} from "./utils/fixtures"

test.describe("Admin sessioni cassa", () => {
    test.describe.configure({ mode: "serial" })

    test("mostra sessione chiusa e permette download report CSV/XLS", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Cash Sessions Event ${suffix}`
        const printerName = `Cashier ${suffix}`
        const cashBoxName = `CashBox ${suffix}`
        const posName = `POS ${suffix}`
        const categoryName = `Cash Sessions Cat ${suffix}`
        const productName = `Cash Sessions Product ${suffix}`

        await createAndActivateEvent(page, eventName)
        await configureCashPos(page, printerName, randomIp(), cashBoxName, posName)
        await createCategoryAndProducts(page, categoryName, [{ name: productName, price: "6.00" }])

        await openPosAndSelectDevice(page, posName)
        await openCashSession(page, "100")
        await completeCashOrder(page, productName)
        await closeCashSession(page, "106")

        await page.goto("/admin")
        const sessionsTable = page.getByTestId("cash-sessions-table")
        await expect(sessionsTable).toBeVisible({ timeout: 10000 })
        const row = sessionsTable.locator("tr").filter({ hasText: new RegExp(posName) }).first()
        await expect(row).toBeVisible()
        await expect(row).toContainText(/Chiusa/i)
        await expect(row).toContainText(/106,00\s*€/i)

        const csvLink = row.getByRole("link", { name: "CSV", exact: true }).first()
        const xlsLink = row.getByRole("link", { name: "XLS", exact: true }).first()

        const csvHref = await csvLink.getAttribute("href")
        const xlsHref = await xlsLink.getAttribute("href")
        expect(csvHref).toBeTruthy()
        expect(xlsHref).toBeTruthy()

        const csvResponse = await page.request.get(csvHref || "")
        expect(csvResponse.ok()).toBeTruthy()
        expect(csvResponse.headers()["content-type"]).toContain("text/csv")
        const csvPayload = await csvResponse.text()
        expect(csvPayload).toContain("Contante atteso (solo contanti)")
        expect(csvPayload).toContain(posName)
        expect(csvPayload).toContain("106.00")

        const xlsResponse = await page.request.get(xlsHref || "")
        expect(xlsResponse.ok()).toBeTruthy()
        expect(xlsResponse.headers()["content-type"]).toContain("application/vnd.ms-excel")
        const xlsPayload = await xlsResponse.text()
        expect(xlsPayload).toContain("Sezione\tValore")
        expect(xlsPayload).toContain(posName)
    })
})
