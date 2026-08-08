import { expect, test } from "@playwright/test"
import mongoose from "mongoose"

import { ensureAdminAuthenticated } from "./utils/auth"
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db"
import { setAdminEventContextCookie, uniqueSuffix } from "./utils/fixtures"
import Event from "../src/models/Event"
import Order from "../src/models/Order"

test.use({ timezoneId: "Europe/Rome" })

test.describe("Storico ordini in ora locale", () => {
    let eventName = ""

    test.afterEach(async () => {
        if (!eventName) return
        await cleanupEventArtifactsByName(eventName)
        eventName = ""
    })

    test("converte UTC in ora locale applicando ora solare e legale", async ({ page }) => {
        await ensureDbConnection()
        await ensureAdminAuthenticated(page, "/admin/orders")

        eventName = `Order Timezone ${uniqueSuffix()}`
        const event = await Event.create({
            name: eventName,
            active: false,
            archived: false,
            settings: { askName: false, askTable: false },
            predefinedTables: []
        })
        const eventId = String(event._id)
        await setAdminEventContextCookie(page, eventId)

        await Order.create([
            {
                eventId,
                status: "PAID",
                createdAt: new Date("2026-01-15T19:30:00.000Z"),
                totalAmount: 5,
                paymentMethod: "CASH",
                cart: [{
                    productId: new mongoose.Types.ObjectId(),
                    snapshotName: "Prodotto inverno",
                    quantity: 1,
                    selectedOptions: []
                }]
            },
            {
                eventId,
                status: "PAID",
                createdAt: new Date("2026-07-15T18:30:00.000Z"),
                totalAmount: 7,
                paymentMethod: "CASH",
                cart: [{
                    productId: new mongoose.Types.ObjectId(),
                    snapshotName: "Prodotto estate",
                    quantity: 1,
                    selectedOptions: []
                }]
            }
        ])

        await page.goto("/admin/orders")

        const winterRow = page.getByRole("row").filter({ hasText: "Prodotto inverno" })
        await expect(winterRow).toContainText("15/01/2026")
        await expect(winterRow).toContainText("20:30")

        const summerRow = page.getByRole("row").filter({ hasText: "Prodotto estate" })
        await expect(summerRow).toContainText("15/07/2026")
        await expect(summerRow).toContainText("20:30")
    })
})
