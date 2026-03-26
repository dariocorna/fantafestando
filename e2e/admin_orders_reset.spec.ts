import { expect, test } from "@playwright/test"
import mongoose from "mongoose"

import { ensureAdminAuthenticated } from "./utils/auth"
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db"
import { setAdminEventContextCookie, uniqueSuffix } from "./utils/fixtures"
import Event from "../src/models/Event"
import Printer from "../src/models/Printer"
import PosDevice from "../src/models/PosDevice"
import CashSession from "../src/models/CashSession"
import Order from "../src/models/Order"
import OrderCounter from "../src/models/OrderCounter"
import PrintJob from "../src/models/PrintJob"

test.describe("Admin reset ordini festa", () => {
    let eventName = ""

    test.afterEach(async () => {
        if (!eventName) return
        await cleanupEventArtifactsByName(eventName)
        eventName = ""
    })

    test("richiede token di conferma ed elimina i dati ordini della festa", async ({ page, isMobile }) => {
        test.skip(isMobile, "Flusso validato su desktop")

        await ensureDbConnection()
        await ensureAdminAuthenticated(page, "/admin/orders")

        eventName = `Reset Orders Event ${uniqueSuffix()}`
        const event = await Event.create({
            name: eventName,
            active: false,
            archived: false,
            settings: {
                askName: false,
                askTable: false
            },
            predefinedTables: []
        })
        const eventId = String(event._id)

        await setAdminEventContextCookie(page, eventId)

        const printer = await Printer.create({
            eventId,
            name: `Reset Printer ${uniqueSuffix()}`,
            ip: "127.0.0.1",
            port: 9100,
            isVirtual: false,
            type: "CASHIER"
        })

        const posDevice = await PosDevice.create({
            eventId,
            name: `Reset POS ${uniqueSuffix()}`,
            printerId: printer._id
        })

        const cashSession = await CashSession.create({
            eventId,
            posDeviceId: posDevice._id,
            status: "CLOSED",
            openedAt: new Date(Date.now() - 60 * 60 * 1000),
            closedAt: new Date(),
            openingFloatAmount: 20,
            paidOrdersCount: 1,
            cashSalesAmount: 10,
            cardSalesAmount: 0,
            otherSalesAmount: 0,
            expectedCashAmount: 30,
            closingCountedCashAmount: 30,
            varianceAmount: 0
        })

        const pendingOrder = await Order.create({
            eventId,
            pickupNumber: 101,
            status: "PENDING",
            customer: { name: "Mario", table: "A1" },
            totalAmount: 5,
            discountApplied: 0,
            paymentMethod: "CASH",
            cart: [{
                productId: new mongoose.Types.ObjectId(),
                snapshotName: "Panino",
                quantity: 1,
                selectedOptions: []
            }]
        })

        const paidOrder = await Order.create({
            eventId,
            cashSessionId: cashSession._id,
            pickupNumber: 102,
            status: "PAID",
            customer: { name: "Luigi", table: "B2" },
            totalAmount: 10,
            discountApplied: 0,
            paymentMethod: "CASH",
            cart: [{
                productId: new mongoose.Types.ObjectId(),
                snapshotName: "Patatine",
                quantity: 2,
                selectedOptions: []
            }]
        })

        await OrderCounter.create({ eventId, scope: "PUBLIC_ORDER", seq: 88 })
        await OrderCounter.create({ eventId, scope: "PIZZA_ORDER", seq: 12 })

        await PrintJob.create({
            eventId,
            printerId: printer._id,
            orderId: paidOrder._id,
            source: "ORDER",
            printType: "CUSTOMER_ORDER",
            status: "SENT",
            destinationHost: "127.0.0.1",
            destinationPort: 9100,
            isVirtual: false,
            copies: 1,
            automaticRetryCount: 0,
            document: { title: "Order print" }
        })

        await PrintJob.create({
            eventId,
            printerId: printer._id,
            source: "CASH_SESSION",
            printType: "CASH_SESSION_SUMMARY",
            status: "SENT",
            destinationHost: "127.0.0.1",
            destinationPort: 9100,
            isVirtual: false,
            copies: 1,
            automaticRetryCount: 0,
            document: { title: "Session print" }
        })

        await page.goto("/admin/orders")
        await expect(page.getByText("Patatine")).toBeVisible({ timeout: 10000 })

        await page.getByTestId("admin-reset-orders-trigger").click()
        await page.getByTestId("admin-reset-orders-token-input").fill("NOPE")
        await page.getByTestId("admin-reset-orders-confirm").click()

        await expect(page.getByTestId("admin-reset-orders-error")).toContainText("Token di conferma non valido")

        await expect.poll(async () => Order.countDocuments({ eventId })).toBe(2)
        await expect.poll(async () => OrderCounter.countDocuments({ eventId })).toBe(2)
        await expect.poll(async () => CashSession.countDocuments({ eventId })).toBe(1)
        await expect.poll(async () => PrintJob.countDocuments({ eventId, source: { $in: ["ORDER", "CASH_SESSION"] } })).toBe(2)

        await page.getByTestId("admin-reset-orders-trigger").click()
        await page.getByTestId("admin-reset-orders-token-input").fill("RESET")
        await page.getByTestId("admin-reset-orders-confirm").click()

        await expect(page.getByTestId("admin-reset-orders-success")).toContainText("Reset completato")
        await expect(page.getByText("Nessun ordine trovato.")).toBeVisible()

        await expect.poll(async () => Order.countDocuments({ eventId })).toBe(0)
        await expect.poll(async () => OrderCounter.countDocuments({ eventId })).toBe(0)
        await expect.poll(async () => CashSession.countDocuments({ eventId })).toBe(0)
        await expect.poll(async () => PrintJob.countDocuments({ eventId, source: { $in: ["ORDER", "CASH_SESSION"] } })).toBe(0)

        await expect(Order.findById(pendingOrder._id).lean()).resolves.toBeNull()
        await expect(Order.findById(paidOrder._id).lean()).resolves.toBeNull()
    })
})
