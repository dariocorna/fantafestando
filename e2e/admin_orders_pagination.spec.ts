import { expect, test } from "@playwright/test"
import mongoose from "mongoose"

import Event from "../src/models/Event"
import { ensureAdminAuthenticated } from "./utils/auth"
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db"
import { setAdminEventContextCookie, uniqueSuffix } from "./utils/fixtures"

test.use({ timezoneId: "Europe/Rome" })

test.describe("Paginazione storico ordini", () => {
    let eventNames: string[] = []

    test.afterEach(async () => {
        for (const eventName of eventNames) await cleanupEventArtifactsByName(eventName)
        eventNames = []
    })

    test("mostra 50 ordini per pagina, il totale evento e normalizza pagine non valide", async ({ page }) => {
        await ensureDbConnection()
        await ensureAdminAuthenticated(page, "/admin/orders")

        const eventName = `Order Pagination ${uniqueSuffix()}`
        const foreignEventName = `Order Pagination Foreign ${uniqueSuffix()}`
        eventNames = [eventName, foreignEventName]
        const event = await Event.create({
            name: eventName,
            active: false,
            archived: false,
            settings: { askName: false, askTable: false, timezone: "Europe/Rome" },
            predefinedTables: []
        })
        const foreignEvent = await Event.create({
            name: foreignEventName,
            active: false,
            archived: false,
            settings: { askName: false, askTable: false, timezone: "Europe/Rome" },
            predefinedTables: []
        })
        await setAdminEventContextCookie(page, String(event._id))

        const db = mongoose.connection.db
        if (!db) throw new Error("DB non disponibile")
        const productId = new mongoose.Types.ObjectId()
        const testCashSessionId = new mongoose.Types.ObjectId()
        const firstCreatedAt = new Date("2026-07-15T18:30:00.000Z").getTime()
        await Promise.all([
            db.collection("cashsessions").insertOne({
                _id: testCashSessionId,
                eventId: event._id,
                isTest: true,
                status: "OPEN",
                createdAt: new Date(),
                updatedAt: new Date()
            }),
            db.collection("orders").insertMany([
                ...Array.from({ length: 51 }, (_, index) => ({
                    eventId: event._id,
                    status: "PAID",
                    createdAt: new Date(firstCreatedAt + index * 60_000),
                    updatedAt: new Date(firstCreatedAt + index * 60_000),
                    totalAmount: 1,
                    discountApplied: 0,
                    paymentMethod: "CASH",
                    cart: [{
                        productId,
                        snapshotName: `Ordine ${String(index + 1).padStart(3, "0")}`,
                        quantity: 1,
                        selectedOptions: []
                    }]
                })),
                {
                    eventId: event._id,
                    cashSessionId: testCashSessionId,
                    status: "PAID",
                    createdAt: new Date(firstCreatedAt + 100 * 60_000),
                    updatedAt: new Date(firstCreatedAt + 100 * 60_000),
                    totalAmount: 500,
                    discountApplied: 0,
                    paymentMethod: "CASH",
                    cart: [{ productId, snapshotName: "Ordine Sessione Test", quantity: 1, selectedOptions: [] }]
                },
                {
                    eventId: foreignEvent._id,
                    status: "PAID",
                    createdAt: new Date(firstCreatedAt + 101 * 60_000),
                    updatedAt: new Date(firstCreatedAt + 101 * 60_000),
                    totalAmount: 1000,
                    discountApplied: 0,
                    paymentMethod: "CASH",
                    cart: [{ productId, snapshotName: "Ordine Evento Estraneo", quantity: 1, selectedOptions: [] }]
                }
            ])
        ])

        await page.goto("/admin/orders?page=non-valida")
        await expect(page).toHaveURL(/\/admin\/orders$/)

        const pagination = page.getByRole("navigation", { name: "Paginazione storico ordini" })
        await expect(page.locator("tbody tr")).toHaveCount(50)
        await expect(page.locator("tbody tr").first()).toContainText("Ordine 051")
        await expect(page.locator("tbody tr").last()).toContainText("Ordine 002")
        await expect(page.getByText("Ordine 001")).toHaveCount(0)
        await expect(page.getByText("Ordine Sessione Test")).toHaveCount(0)
        await expect(page.getByText("Ordine Evento Estraneo")).toHaveCount(0)
        await expect(pagination).toContainText("Ordini 1–50 di 51")
        await expect(pagination.getByText("Pagina 1 di 2")).toHaveAttribute("aria-current", "page")
        await expect(pagination.getByRole("button", { name: "Pagina precedente" })).toBeDisabled()
        await expect(page.getByText("Totale Incasso Netto").locator("..")).toContainText("51.00 €")

        await pagination.getByRole("link", { name: "Pagina successiva" }).click()

        await expect(page).toHaveURL(/\/admin\/orders\?page=2$/)
        await expect(page.locator("tbody tr")).toHaveCount(1)
        const oldestOrderRow = page.getByRole("row").filter({ hasText: "Ordine 001" })
        await expect(oldestOrderRow).toContainText("15/07/2026")
        await expect(oldestOrderRow).toContainText("20:30")
        await expect(oldestOrderRow.getByTitle("Ristampa comanda")).toBeEnabled()
        await expect(oldestOrderRow.getByTitle("Storna ordine")).toBeEnabled()
        await expect(pagination).toContainText("Ordini 51–51 di 51")
        await expect(pagination.getByText("Pagina 2 di 2")).toHaveAttribute("aria-current", "page")
        await expect(pagination.getByRole("button", { name: "Pagina successiva" })).toBeDisabled()
        await expect(page.getByText("Totale Incasso Netto").locator("..")).toContainText("51.00 €")

        await page.goto("/admin/orders?page=999")
        await expect(page).toHaveURL(/\/admin\/orders\?page=2$/)
        await expect(page.locator("tbody tr")).toHaveCount(1)
        await expect(page.getByRole("navigation", { name: "Paginazione storico ordini" })).toContainText("Pagina 2 di 2")

        await db.collection("orders").deleteMany({ eventId: event._id })
        await page.goto("/admin/orders")
        await expect(page.getByText("Nessun ordine trovato.")).toBeVisible()
        await expect(page.getByRole("navigation", { name: "Paginazione storico ordini" })).toHaveCount(0)
        await expect(page.getByText("Totale Incasso Netto").locator("..")).toContainText("0.00 €")
    })
})
