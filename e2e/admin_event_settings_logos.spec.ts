import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import mongoose from "mongoose";
import {
    normalizeMenuHeaderLogoUpload,
    normalizeReceiptHeaderLogoUpload
} from "../src/lib/header-logo";
import { ensureAdminAuthenticated } from "./utils/auth";
import {
    createAndActivateEvent,
    selectEventContext,
    uniqueSuffix
} from "./utils/fixtures";
import { cleanupEventArtifactsByName, ensureDbConnection } from "./utils/db";

const MENU_VALID_IMAGE = path.join(process.cwd(), "e2e", "fixtures", "images", "menu-valid.png");
const RECEIPT_VALID_IMAGE = path.join(process.cwd(), "e2e", "fixtures", "images", "receipt-valid.jpg");

interface EventSettingsRecord {
    settings?: {
        menuHeaderLogoUrl?: string;
        receiptHeaderLogoUrl?: string;
    };
}

async function findEventByName(eventName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error("Connessione Mongo non disponibile per i test E2E.");
    }

    return await db.collection("events").findOne({ name: eventName }) as (EventSettingsRecord & { _id?: unknown }) | null;
}

async function cleanupEventArtifactsAndManagedUploads(eventName: string) {
    const event = await findEventByName(eventName);
    const managedUploads = [
        event?.settings?.menuHeaderLogoUrl,
        event?.settings?.receiptHeaderLogoUrl
    ].filter((value): value is string => typeof value === "string" && value.startsWith("/uploads/"));

    await cleanupEventArtifactsByName(eventName);

    await Promise.all(managedUploads.map(async (relativePath) => {
        const absolutePath = path.join(process.cwd(), "public", relativePath.replace(/^\//, ""));
        await unlink(absolutePath).catch(() => undefined);
    }));
}

async function seedCanonicalHeaderUploads(eventName: string) {
    await ensureDbConnection();
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error("Connessione Mongo non disponibile per il seed E2E.");
    }

    const event = await db.collection("events").findOne({ name: eventName }) as ({ _id?: unknown } | null);
    if (!event?._id) {
        throw new Error(`Evento di test non trovato: ${eventName}`);
    }

    const [menuSource, receiptSource] = await Promise.all([
        readFile(MENU_VALID_IMAGE),
        readFile(RECEIPT_VALID_IMAGE)
    ]);
    const [menuNormalized, receiptNormalized] = await Promise.all([
        normalizeMenuHeaderLogoUpload(menuSource, "image/png"),
        normalizeReceiptHeaderLogoUpload(receiptSource, "image/jpeg")
    ]);

    if (!menuNormalized.success || !receiptNormalized.success) {
        throw new Error("Impossibile preparare i logo canonici per il seed E2E.");
    }

    const uniqueToken = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const menuRelativePath = `/uploads/menu-headers/e2e-menu-${uniqueToken}.png`;
    const receiptRelativePath = `/uploads/receipt-headers/e2e-receipt-${uniqueToken}.png`;
    const menuAbsolutePath = path.join(process.cwd(), "public", menuRelativePath.replace(/^\//, ""));
    const receiptAbsolutePath = path.join(process.cwd(), "public", receiptRelativePath.replace(/^\//, ""));

    await Promise.all([
        mkdir(path.dirname(menuAbsolutePath), { recursive: true }),
        mkdir(path.dirname(receiptAbsolutePath), { recursive: true })
    ]);
    await Promise.all([
        writeFile(menuAbsolutePath, menuNormalized.pngBuffer),
        writeFile(receiptAbsolutePath, receiptNormalized.pngBuffer)
    ]);

    await db.collection("events").updateOne(
        { _id: event._id },
        {
            $set: {
                "settings.menuHeaderLogoUrl": menuRelativePath,
                "settings.receiptHeaderLogoUrl": receiptRelativePath
            }
        }
    );

    return {
        menuHeaderLogoUrl: menuRelativePath,
        receiptHeaderLogoUrl: receiptRelativePath
    };
}

test.describe("Admin Event Settings Logos", () => {
    test.beforeEach(async ({ page }) => {
        await ensureAdminAuthenticated(page, "/admin/settings");
    });

    test("refreshes the admin settings form correctly when switching event context", async ({ page }) => {
        const suffix = uniqueSuffix();
        const firstEventName = `Switch Festa A ${suffix}`;
        const secondEventName = `Switch Festa B ${suffix}`;

        try {
            await createAndActivateEvent(page, firstEventName, {
                askName: true,
                askTable: false,
                portalEasterEggEnabled: false
            });
            await createAndActivateEvent(page, secondEventName, {
                askName: false,
                askTable: true,
                portalEasterEggEnabled: false
            });

            await page.goto("/admin/settings");
            await expect(page.getByText(new RegExp(`Impostazioni Festa: ${secondEventName}`))).toBeVisible();
            await expect(page.locator('input[name="askName"]')).not.toBeChecked();
            await expect(page.locator('input[name="askTable"]')).toBeChecked();

            await selectEventContext(page, firstEventName);
            await page.goto("/admin/settings");

            await expect(page.getByText(new RegExp(`Impostazioni Festa: ${firstEventName}`))).toBeVisible();
            await expect(page.locator('input[name="askName"]')).toBeChecked();
            await expect(page.locator('input[name="askTable"]')).not.toBeChecked();

            await expect(page.getByRole("button", { name: /Salva Impostazioni/i })).toBeEnabled();
            await page.getByText("Abilita Easter Egg foto").click();
            await expect(page.locator('input[name="portalEasterEggEnabled"]')).toBeChecked();
            await page.getByRole("button", { name: /Salva Impostazioni/i }).click();
            await expect(page.getByText(/Modifiche salvate!/i)).toBeVisible();

            await selectEventContext(page, secondEventName);
            await page.goto("/admin/settings");
            await expect(page.getByText(new RegExp(`Impostazioni Festa: ${secondEventName}`))).toBeVisible();
            await expect(page.locator('input[name="portalEasterEggEnabled"]')).not.toBeChecked();

            await selectEventContext(page, firstEventName);
            await page.goto("/admin/settings");
            await expect(page.locator('input[name="portalEasterEggEnabled"]')).toBeChecked();
        } finally {
            await cleanupEventArtifactsAndManagedUploads(firstEventName);
            await cleanupEventArtifactsAndManagedUploads(secondEventName);
        }
    });

    test("renders persisted header logos and reuses the receipt header in demo print jobs", async ({ page }) => {
        const suffix = uniqueSuffix();
        const eventName = `Logo Hardening ${suffix}`;

        try {
            await createAndActivateEvent(page, eventName);
            const seededHeaders = await seedCanonicalHeaderUploads(eventName);
            await page.goto("/admin/settings");

            const savedMenuHeaderPath = seededHeaders.menuHeaderLogoUrl;
            const savedReceiptHeaderPath = seededHeaders.receiptHeaderLogoUrl;

            expect(savedMenuHeaderPath).toBeTruthy();
            expect(savedReceiptHeaderPath).toBeTruthy();
            expect(existsSync(path.join(process.cwd(), "public", savedMenuHeaderPath!.replace(/^\//, "")))).toBe(true);
            expect(existsSync(path.join(process.cwd(), "public", savedReceiptHeaderPath!.replace(/^\//, "")))).toBe(true);

            await expect(page.getByText(savedMenuHeaderPath!)).toBeVisible();
            await expect(page.getByText(savedReceiptHeaderPath!)).toBeVisible();
            await expect(page.getByAltText(/Anteprima logo header menu/i)).toBeVisible();
            await expect(page.getByAltText(/Anteprima header scontrino/i)).toBeVisible();

            await page.goto("/admin/settings/hardware");
            await page.getByRole("button", { name: "Provisiona 10 virtuali" }).click();
            await expect(page.getByText("Virtual Printer 10")).toBeVisible({ timeout: 15000 });

            await page.getByRole("tab", { name: "Monitor Stampa" }).click();
            await page.getByRole("button", { name: "Genera Ricevuta Demo" }).click();

            await expect.poll(async () => {
                const response = await page.request.get("/api/admin/print-jobs?limit=20");
                if (!response.ok()) {
                    return false;
                }

                const payload = await response.json() as {
                    jobs?: Array<{
                        id: string;
                        status?: string;
                        source?: string;
                        printType?: string;
                        document?: {
                            branding?: {
                                logoPath?: string;
                            };
                        };
                    }>;
                };

                return Boolean((payload.jobs || []).find((job) =>
                    job.source === "MANUAL_TEST"
                    && job.printType === "MANUAL_TEST"
                    && job.status === "SENT"
                    && job.document?.branding?.logoPath === savedReceiptHeaderPath
                ));
            }, { timeout: 30000 }).toBe(true);

            const demoJobButton = page.getByRole("button").filter({ hasText: "Test manuale" }).first();
            await expect(demoJobButton).toContainText("SENT", { timeout: 15000 });
            await demoJobButton.click();
            await expect(page.getByTestId("print-job-preview")).toBeVisible({ timeout: 15000 });
        } finally {
            await cleanupEventArtifactsAndManagedUploads(eventName);
        }
    });
});
