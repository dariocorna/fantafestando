import { expect, test } from "@playwright/test"
import CashSession from "../src/models/CashSession"
import Order from "../src/models/Order"
import Peripheral from "../src/models/Peripheral"
import PosDevice from "../src/models/PosDevice"
import Product from "../src/models/Product"
import {
    createActiveEventWithCatalogDirect,
    createVirtualPrinterDirect,
    deleteEvent,
    openPosAndSelectDevice,
    setAdminEventContextCookie,
    uniqueSuffix,
} from "./utils/fixtures"

async function seedPaymentPos(options: {
    eventId: string
    printerId: string
    name: string
    terminalType: "SUMUP" | "ELECTRONIC_MANUAL"
    isTest: boolean
    status?: "OPEN" | "CLOSED"
}) {
    const terminal = await Peripheral.create({
        eventId: options.eventId,
        name: `${options.name} terminale`,
        type: options.terminalType,
        config: options.terminalType === "SUMUP" ? {
            merchantCode: "merchant-e2e",
            readerId: "reader-e2e",
            apiKey: "encrypted-e2e",
            affiliateAppId: "app-e2e",
            affiliateKey: "encrypted-e2e",
        } : {},
    })
    const posDevice = await PosDevice.create({
        eventId: options.eventId,
        name: options.name,
        printerId: options.printerId,
        paymentTerminalId: terminal._id,
    })
    const now = new Date()
    const status = options.status ?? "OPEN"
    const cashSession = await CashSession.create({
        eventId: options.eventId,
        posDeviceId: posDevice._id,
        status,
        isTest: options.isTest,
        stockEffectStatus: status === "CLOSED" && options.isTest ? "REVERTED" : "APPLIED",
        openedAt: new Date(now.getTime() - 60_000),
        closedAt: status === "CLOSED" ? now : undefined,
        openingFloatAmount: 0,
        closingCountedCashAmount: status === "CLOSED" ? 0 : undefined,
        paidOrdersCount: 0,
        cashSalesAmount: 0,
        cardSalesAmount: 0,
        otherSalesAmount: 0,
        expectedCashAmount: 0,
        varianceAmount: 0,
    })

    return { posDevice, cashSession }
}

test.describe("SumUp e sessioni TEST", () => {
    test.describe.configure({ mode: "serial" })

    test("nasconde SumUp ma consente un pagamento elettronico manuale", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")

        const suffix = uniqueSuffix()
        const eventName = `SumUp TEST POS ${suffix}`
        const categoryName = `Bevande ${suffix}`
        const productName = `Acqua ${suffix}`
        const normalSumupPosName = `SumUp normale ${suffix}`
        const sumupPosName = `SumUp TEST ${suffix}`
        const manualPosName = `Manuale TEST ${suffix}`

        try {
            const { eventId } = await createActiveEventWithCatalogDirect(eventName, categoryName, [
                { name: productName, price: "2.00" },
            ])
            const { printerId } = await createVirtualPrinterDirect({
                eventName,
                printerName: `Cassa ${suffix}`,
            })
            await seedPaymentPos({ eventId, printerId, name: normalSumupPosName, terminalType: "SUMUP", isTest: false })
            await seedPaymentPos({ eventId, printerId, name: sumupPosName, terminalType: "SUMUP", isTest: true })
            const manual = await seedPaymentPos({ eventId, printerId, name: manualPosName, terminalType: "ELECTRONIC_MANUAL", isTest: true })

            await openPosAndSelectDevice(page, normalSumupPosName)
            await page.getByRole("button").filter({ hasText: productName }).first().click()
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            const normalSumupCheckout = page.getByRole("dialog").filter({ hasText: "Importo Dovuto" })
            await expect(normalSumupCheckout.getByText("CARTA / POS", { exact: true })).toBeVisible()
            await page.keyboard.press("Escape")
            await expect(normalSumupCheckout).toBeHidden()

            await openPosAndSelectDevice(page, sumupPosName)
            await page.getByRole("button").filter({ hasText: productName }).first().click()
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            const sumupCheckout = page.getByRole("dialog").filter({ hasText: "Importo Dovuto" })
            await expect(sumupCheckout).toBeVisible()
            await expect(sumupCheckout.getByText("CARTA / POS", { exact: true })).toHaveCount(0)
            await expect(sumupCheckout).toContainText("non ha metodi di pagamento configurati")
            await page.keyboard.press("Escape")
            await expect(sumupCheckout).toBeHidden()

            await openPosAndSelectDevice(page, manualPosName)
            await page.getByRole("button").filter({ hasText: productName }).first().click()
            await page.getByRole("button", { name: "PAGA ORA", exact: true }).click()
            const manualCheckout = page.getByRole("dialog").filter({ hasText: "Importo Dovuto" })
            await expect(manualCheckout.getByText("CARTA / POS", { exact: true })).toBeVisible()
            await manualCheckout.getByRole("button", { name: "CONFERMA", exact: true }).click()
            await expect(manualCheckout).toBeHidden()

            await expect.poll(async () => Order.countDocuments({
                cashSessionId: manual.cashSession._id,
                status: "PAID",
                paymentMethod: "CARD",
                sumupCheckoutId: { $exists: false },
                sumupPaymentId: { $exists: false },
            })).toBe(1)
        } finally {
            await deleteEvent(page, eventName)
        }
    })

    test("riclassifica il POS manuale ma blocca un pagamento SumUp certificato", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop.")

        const suffix = uniqueSuffix()
        const eventName = `SumUp TEST Admin ${suffix}`
        const manualPosName = `Manuale storico ${suffix}`
        const certifiedPosName = `SumUp certificato ${suffix}`

        try {
            const { eventId } = await createActiveEventWithCatalogDirect(eventName, `Catalogo ${suffix}`, [
                { name: `Prodotto ${suffix}`, price: "5.00" },
            ])
            const product = await Product.findOne({ eventId }).select("_id name").lean<{ _id: string, name: string } | null>()
            expect(product?._id).toBeTruthy()
            const { printerId } = await createVirtualPrinterDirect({
                eventName,
                printerName: `Cassa admin ${suffix}`,
            })
            const manual = await seedPaymentPos({
                eventId,
                printerId,
                name: manualPosName,
                terminalType: "ELECTRONIC_MANUAL",
                isTest: false,
                status: "CLOSED",
            })
            const certified = await seedPaymentPos({
                eventId,
                printerId,
                name: certifiedPosName,
                terminalType: "SUMUP",
                isTest: false,
                status: "CLOSED",
            })
            const commonOrder = {
                eventId,
                status: "PAID",
                paidAt: new Date(),
                totalAmount: 5,
                discountApplied: 0,
                paymentMethod: "CARD",
                customer: {},
                cart: [{
                    productId: product!._id,
                    snapshotName: product!.name,
                    quantity: 1,
                    unitBasePrice: 5,
                    lineTotal: 5,
                    selectedOptions: [],
                }],
                ingredientPlan: [],
                dishTickets: [],
                stockAdjustments: [],
                stockEffectStatus: "APPLIED",
            } as const
            await Promise.all([
                Order.create({ ...commonOrder, cashSessionId: manual.cashSession._id, posDeviceId: manual.posDevice._id }),
                Order.create({
                    ...commonOrder,
                    cashSessionId: certified.cashSession._id,
                    posDeviceId: certified.posDevice._id,
                    sumupPaymentId: `transaction-${suffix}`,
                }),
                CashSession.updateOne({ _id: manual.cashSession._id }, { $set: { paidOrdersCount: 1, cardSalesAmount: 5 } }),
                CashSession.updateOne({ _id: certified.cashSession._id }, { $set: { paidOrdersCount: 1, cardSalesAmount: 5 } }),
            ])

            await setAdminEventContextCookie(page, eventId)
            await page.goto("/admin")

            const manualRow = page.getByTestId(`cash-session-row-${manual.cashSession._id}`)
            await manualRow.getByRole("button", { name: "Segna TEST", exact: true }).click()
            await expect(manualRow.getByRole("button", { name: "Rendi normale", exact: true })).toBeVisible()

            const certifiedRow = page.getByTestId(`cash-session-row-${certified.cashSession._id}`)
            await certifiedRow.getByRole("button", { name: "Segna TEST", exact: true }).click()
            await expect(certifiedRow.getByRole("status")).toContainText("Storna e rimborsa i pagamenti SumUp")
            await expect(certifiedRow.getByRole("button", { name: "Segna TEST", exact: true })).toBeVisible()
        } finally {
            await deleteEvent(page, eventName)
        }
    })
})
