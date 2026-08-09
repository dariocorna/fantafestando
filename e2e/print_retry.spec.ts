import { test, expect } from "@playwright/test"
import dbConnect from "../src/lib/mongoose"
import Event from "../src/models/Event"
import Printer from "../src/models/Printer"
import PrintJob from "../src/models/PrintJob"
import {
    createAndActivateEvent,
    configureCashPos,
    deleteEvent,
    openPosAndSelectDevice,
    openCashSessionIfRequired,
    uniqueSuffix,
} from "./utils/fixtures"

interface OrderPrintJob {
    _id: { toString(): string } | string
    status: "QUEUED" | "SENT" | "FAILED"
    printType: string
    destinationHost: string
    destinationPort: number
    copies: number
}

async function listOrderPrintJobs(eventName: string, itemName: string): Promise<OrderPrintJob[]> {
    await dbConnect()
    const event = await Event.findOne({ name: eventName }).select("_id").lean() as { _id: unknown } | null
    if (!event?._id) return []

    return await PrintJob.find({
        eventId: event._id,
        source: "ORDER",
        "document.items.name": itemName
    })
        .sort({ createdAt: 1 })
        .select("status printType destinationHost destinationPort copies")
        .lean() as unknown as OrderPrintJob[]
}

async function restorePrinter(eventName: string, printerName: string, port = 19100) {
    await dbConnect()
    const event = await Event.findOne({ name: eventName }).select("_id").lean() as { _id: unknown } | null
    if (!event?._id) throw new Error(`Evento non trovato: ${eventName}`)
    const result = await Printer.updateOne(
        { eventId: event._id, name: printerName },
        { $set: { ip: "127.0.0.1", port } }
    )
    if (result.matchedCount !== 1) throw new Error(`Stampante non trovata: ${printerName}`)
}

function printFingerprint(job: OrderPrintJob) {
    return `${job.printType}|${job.destinationHost}:${job.destinationPort}|${job.copies}`
}

async function createCatalogProduct(
    page: import("@playwright/test").Page,
    categoryName: string,
    productName: string,
    kitchenPrinterName?: string,
    shortName = "RTR-SHORT"
) {
    await page.goto("/admin/catalog")
    await page.click("#new-category-btn")
    const categoryDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Categoria/i }).first()
    await categoryDialog.locator("#cat-name").fill(categoryName)
    if (kitchenPrinterName) {
        const printerSelect = categoryDialog.getByLabel("Stampante Reparto")
        const printerValue = await printerSelect.evaluate((element, needle) => {
            const select = element as HTMLSelectElement
            const option = Array.from(select.options).find((item) => item.text.includes(needle))
            return option?.value ?? null
        }, kitchenPrinterName)
        expect(printerValue).toBeTruthy()
        await printerSelect.selectOption(printerValue!)
    }
    await categoryDialog.getByRole("button", { name: "Salva Categoria", exact: true }).click()
    await expect(page.getByRole("row").filter({ hasText: categoryName }).first()).toBeVisible()

    await page.click("#new-product-btn")
    const productDialog = page.getByRole("dialog").filter({ hasText: /Aggiungi Prodotto/i }).first()
    await productDialog.locator("#prod-name").fill(productName)
    await productDialog.getByLabel("Etichetta breve POS/Scontrino (opzionale)").fill(shortName)
    await productDialog.locator('input[name="basePrice"]').fill("5.00")
    await productDialog.locator('select[name="categoryId"]').selectOption({ label: categoryName })
    await productDialog.getByRole("button", { name: "Salva Prodotto", exact: true }).click()
    await expect(page.getByText(productName)).toBeVisible()
}

test.describe("Print Retry Flows", () => {
    test("admin monitor supports retry flow for failed jobs", async ({ page }) => {
        test.setTimeout(90000)
        const suffix = uniqueSuffix()
        const eventName = `Retry Admin ${suffix}`
        const printerName = `A Retry Printer ${suffix}`
        const cashBoxName = `A Retry CashBox ${suffix}`
        const posName = `A Retry POS ${suffix}`
        const categoryName = `A Retry Cat ${suffix}`
        const productName = `A Retry Product ${suffix}`
        const shortName = "RTR-SHORT"

        try {
            await createAndActivateEvent(page, eventName)
            await configureCashPos(page, printerName, "127.0.0.1", cashBoxName, posName, { printerPort: "19199" })
            await createCatalogProduct(page, categoryName, productName, undefined, shortName)

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)
            await page.locator("button").filter({ hasText: shortName }).first().click()
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 })

            const feedbackModal = page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i })
            const feedbackOkButton = feedbackModal.getByRole("button", { name: "OK", exact: true }).first()
            if (await feedbackOkButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await feedbackOkButton.click()
            }

            await expect.poll(async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=20")
                if (!response.ok()) return 0
                const payload = await response.json() as {
                    jobs?: Array<{
                        source?: string
                        printType?: string
                        document?: { items?: Array<{ name?: string }>, copyLabel?: string, schemaVersion?: number }
                    }>
                }
                const orderJobs = (payload.jobs || []).filter((job) =>
                    job.source === "ORDER"
                    && ["CUSTOMER_ORDER", "CASHIER_SUMMARY"].includes(job.printType || "")
                )
                if (orderJobs.length < 2) return 0
                const allShortName = orderJobs.every((job) =>
                    Array.isArray(job.document?.items)
                    && job.document!.items!.some((item) => item.name === shortName)
                    && typeof job.document?.copyLabel === "string"
                    && job.document?.schemaVersion === 2
                )
                return allShortName ? orderJobs.length : 0
            }, {
                timeout: 30000
            }).toBeGreaterThanOrEqual(2)

            await page.goto("/admin/settings/hardware")
            await page.getByRole("tab", { name: "Monitor Stampa" }).click()
            await expect(page.locator("span", { hasText: "FAILED" }).first()).toBeVisible({ timeout: 15000 })

            const failedJobButton = page.locator("button").filter({ hasText: /FAILED/ }).first()
            await failedJobButton.click()
            await page.getByRole("button", { name: "Reinvia job fallito" }).click()
            await expect(page.getByText("Invio stampa fallito")).toBeVisible({ timeout: 15000 })

            // Ripristina la stampante cassa verso emulatore raggiungibile e ritenta il retry
            await page.getByRole("tab", { name: "Stampanti" }).click()
            const printerCard = page.locator('[data-slot="card"]', { hasText: printerName }).first()
            await printerCard.getByRole("button", { name: "Modifica" }).click()
            const editDialog = page.getByRole("dialog")
            await editDialog.getByLabel("Indirizzo IP").fill("127.0.0.1")
            await editDialog.getByLabel("Porta TCP").fill("19100")
            await editDialog.getByRole("button", { name: "Salva Modifiche", exact: true }).click()
            await expect(printerCard).toContainText("127.0.0.1:19100", { timeout: 15000 })
            if (await editDialog.isVisible().catch(() => false)) {
                await editDialog.getByRole("button", { name: /close/i }).click()
                await expect(editDialog).not.toBeVisible({ timeout: 5000 })
            }

            await page.getByRole("tab", { name: "Monitor Stampa" }).click()
            await page.locator("button").filter({ hasText: /FAILED/ }).first().click()
            await page.getByRole("button", { name: "Reinvia job fallito" }).click()
            await expect(page.getByRole("button", { name: /^SENT / }).first()).toBeVisible()
            await expect(page.getByText(/Errore:.*Printer not reachable/)).not.toBeVisible()
        } finally {
            await deleteEvent(page, eventName)
        }
    })

    test("pos error modal exposes cashier-triggered retry action", async ({ page }) => {
        test.setTimeout(90000);

        const suffix = uniqueSuffix();
        const eventName = `Print Retry Event ${suffix}`;
        const printerName = `KitchenPrinter ${suffix}`;
        const cashBoxName = `MainCash ${suffix}`;
        const posName = `POS ${suffix}`;
        const categoryName = `POS Cat ${suffix}`
        const productName = `POS Product ${suffix}`
        const shortName = "RTR-SHORT"

        try {
            await createAndActivateEvent(page, eventName)
            await configureCashPos(page, printerName, "127.0.0.1", cashBoxName, posName, { printerPort: "19199" })
            await createCatalogProduct(page, categoryName, productName, undefined, shortName)

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)

            await page.locator("button").filter({ hasText: shortName }).first().click()
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
            await expect(checkoutDialog).toBeVisible()
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 })

            const feedbackModal = page.getByRole("dialog").filter({ hasText: /Errore stampa|stampa ha errori/i })
            await expect(feedbackModal).toBeVisible({ timeout: 15000 })
            const retryButton = feedbackModal.getByRole("button", { name: new RegExp(`Riprova — ${printerName}`) })
            await expect(retryButton).toBeVisible()
            await restorePrinter(eventName, printerName)
            await retryButton.click()
            const successModal = page.getByRole("dialog").filter({ hasText: "Stampe inviate" })
            await expect(successModal).toBeVisible({ timeout: 15000 })
            await expect(successModal.getByText(/Reinvio completato: \d+\/\d+ job inviati/)).toBeVisible()
            await expect(page.getByText(/Pagamento registrato, ma/)).not.toBeVisible()
            await expect(successModal.getByRole("button", { name: /Riprova/ })).toHaveCount(0)
            await expect.poll(async () => {
                const jobs = await listOrderPrintJobs(eventName, shortName)
                return jobs.length > 0 && jobs.every((job) => job.status === "SENT")
            }).toBe(true)
        } finally {
            await deleteEvent(page, eventName)
        }
    })

    test("admin order summary reprints the original routed copies", async ({ page }) => {
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Order Reprint ${suffix}`
        const printerName = `Reprint Printer ${suffix}`
        const cashBoxName = `Reprint Cash ${suffix}`
        const posName = `Reprint POS ${suffix}`
        const categoryName = `Reprint Cat ${suffix}`
        const productName = `Reprint Product ${suffix}`
        const shortName = "REPRINT-SHORT"

        try {
            await createAndActivateEvent(page, eventName)
            await configureCashPos(page, printerName, "127.0.0.1", cashBoxName, posName, { printerPort: "19100" })
            await createCatalogProduct(page, categoryName, productName, undefined, shortName)

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)
            await page.locator("button").filter({ hasText: shortName }).first().click()
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 })

            const completionDialog = page.getByRole("dialog").filter({ hasText: /Ordine completato|Operazione completata/i })
            if (await completionDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
                await completionDialog.getByRole("button", { name: "OK", exact: true }).click()
            }

            await expect.poll(
                async () => (await listOrderPrintJobs(eventName, shortName)).length,
                { timeout: 15000 }
            ).toBe(2)
            const originalJobs = await listOrderPrintJobs(eventName, shortName)
            const originalIds = new Set(originalJobs.map((job) => job._id.toString()))

            await page.goto("/admin/orders")
            const orderRow = page.getByRole("row").filter({ hasText: shortName }).first()
            const alertPromise = page.waitForEvent("dialog")
            await orderRow.getByTitle("Ristampa comanda").click()
            const alert = await alertPromise
            expect(alert.message()).toBe("Ristampa inviata correttamente")
            await alert.accept()

            await expect.poll(async () => {
                const jobs = await listOrderPrintJobs(eventName, shortName)
                return jobs.filter((job) => !originalIds.has(job._id.toString())).length
            }, { timeout: 15000 }).toBe(originalJobs.length)

            const allJobs = await listOrderPrintJobs(eventName, shortName)
            const reprintJobs = allJobs.filter((job) => !originalIds.has(job._id.toString()))
            expect(reprintJobs.every((job) => job.status === "SENT")).toBe(true)
            expect(reprintJobs.map(printFingerprint).sort()).toEqual(originalJobs.map(printFingerprint).sort())
        } finally {
            await deleteEvent(page, eventName)
        }
    })

    test("admin order summary retries only failed copies after a partial reprint", async ({ page }) => {
        test.setTimeout(90000)

        const suffix = uniqueSuffix()
        const eventName = `Partial Reprint ${suffix}`
        const cashierPrinterName = `Partial Cashier ${suffix}`
        const kitchenPrinterName = `Partial Kitchen ${suffix}`
        const cashBoxName = `Partial Cash ${suffix}`
        const posName = `Partial POS ${suffix}`
        const categoryName = `Partial Cat ${suffix}`
        const productName = `Partial Product ${suffix}`
        const shortName = "PARTIAL-REPRINT"

        try {
            await createAndActivateEvent(page, eventName)
            await configureCashPos(page, cashierPrinterName, "127.0.0.1", cashBoxName, posName, { printerPort: "19100" })

            await dbConnect()
            const event = await Event.findOne({ name: eventName }).select("_id").lean() as { _id: unknown } | null
            expect(event?._id).toBeTruthy()
            await Printer.create({
                eventId: event!._id,
                name: kitchenPrinterName,
                ip: "127.0.0.1",
                port: 19101,
                type: "KITCHEN"
            })
            await createCatalogProduct(page, categoryName, productName, kitchenPrinterName, shortName)

            await openPosAndSelectDevice(page, posName)
            await openCashSessionIfRequired(page)
            await page.locator("button").filter({ hasText: shortName }).first().click()
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            const checkoutDialog = page.getByRole("dialog").filter({ hasText: /Importo Dovuto/i })
            await checkoutDialog.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(checkoutDialog).toBeHidden({ timeout: 15000 })

            const completionDialog = page.getByRole("dialog").filter({ hasText: /Ordine completato|Operazione completata/i })
            if (await completionDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
                await completionDialog.getByRole("button", { name: "OK", exact: true }).click()
            }

            await expect.poll(async () => {
                const jobs = await listOrderPrintJobs(eventName, shortName)
                return jobs.length >= 3 && jobs.every((job) => job.status === "SENT")
            }, { timeout: 15000 }).toBe(true)
            const originalJobs = await listOrderPrintJobs(eventName, shortName)
            const originalIds = new Set(originalJobs.map((job) => job._id.toString()))

            await restorePrinter(eventName, kitchenPrinterName, 19199)
            await page.goto("/admin/orders")
            const orderRow = page.getByRole("row").filter({ hasText: shortName }).first()

            const partialAlertPromise = page.waitForEvent("dialog")
            await orderRow.getByTitle("Ristampa comanda").click()
            const partialAlert = await partialAlertPromise
            expect(partialAlert.message()).toContain("verranno reinviate solo le copie fallite")
            await partialAlert.accept()

            await expect.poll(async () => {
                const jobs = await listOrderPrintJobs(eventName, shortName)
                return jobs.filter((job) => !originalIds.has(job._id.toString())).length
            }, { timeout: 30000 }).toBe(originalJobs.length)
            const afterPartial = await listOrderPrintJobs(eventName, shortName)
            const reprintJobs = afterPartial.filter((job) => !originalIds.has(job._id.toString()))
            expect(reprintJobs.some((job) => job.status === "FAILED")).toBe(true)
            expect(reprintJobs.some((job) => job.status === "SENT")).toBe(true)
            const reprintIds = reprintJobs.map((job) => job._id.toString()).sort()

            await restorePrinter(eventName, kitchenPrinterName, 19101)
            const successAlertPromise = page.waitForEvent("dialog")
            await orderRow.getByTitle("Ristampa comanda").click()
            const successAlert = await successAlertPromise
            expect(successAlert.message()).toBe("Ristampa inviata correttamente")
            await successAlert.accept()

            await expect.poll(async () => {
                const jobs = await listOrderPrintJobs(eventName, shortName)
                const retriedJobs = jobs.filter((job) => reprintIds.includes(job._id.toString()))
                return retriedJobs.length === reprintIds.length && retriedJobs.every((job) => job.status === "SENT")
            }, { timeout: 15000 }).toBe(true)
            const finalJobs = await listOrderPrintJobs(eventName, shortName)
            expect(finalJobs).toHaveLength(afterPartial.length)
            expect(finalJobs.filter((job) => !originalIds.has(job._id.toString())).map((job) => job._id.toString()).sort()).toEqual(reprintIds)
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
