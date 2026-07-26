import { expect, test } from "@playwright/test";
import SystemSettings from "../src/models/SystemSettings";
import { ensureAdminAuthenticated, loginWithCredentials } from "./utils/auth";
import { ensureDbConnection } from "./utils/db";
import { resolveE2ECredentials } from "./utils/users";

const controllerToken = process.env.ORACLE_TUNNEL_CONTROL_TOKEN || "e2e-tunnel-control-token";
const remotePosMarker = process.env.REMOTE_POS_MARKER_SECRET || "e2e-pos-remote-marker";

async function resetRemoteAccessSettings() {
  await ensureDbConnection();
  await SystemSettings.findOneAndUpdate(
    { singletonKey: "default" },
    {
      $set: {
        singletonKey: "default",
        "remoteAccess.menuEnabled": true,
        "remoteAccess.adminEnabled": false,
        "remoteAccess.posEnabled": false,
        "remoteAccess.sshEnabled": false,
        "remoteAccess.posLanAuthenticationEnabled": true,
        "remoteAccess.appliedMenuEnabled": true,
        "remoteAccess.appliedAdminEnabled": false,
        "remoteAccess.appliedPosEnabled": false,
        "remoteAccess.appliedSshEnabled": false,
      },
      $unset: {
        "remoteAccess.requestedBy": 1,
        "remoteAccess.requestedAt": 1,
        "remoteAccess.lastControllerAt": 1,
        "remoteAccess.lastError": 1,
      },
    },
    { upsert: true }
  );
}

test.describe("Accesso remoto e autenticazione POS", () => {
  test.beforeEach(async ({ page }) => {
    await resetRemoteAccessSettings();
    await ensureAdminAuthenticated(page, "/admin/settings/remote-access");
  });

  test.afterEach(async () => {
    await resetRemoteAccessSettings();
  });

  test("configura i proxy e mantiene obbligatorio il login POS remoto", async ({ page, browser }) => {
    await expect(page.getByRole("heading", { name: "Accesso remoto" })).toBeVisible();
    await expect(page.getByText(/login non può essere disabilitato/i)).toBeVisible();
    await expect(page.getByText(/chiunque raggiunga la board dalla rete locale/i)).toBeVisible();
    await expect(page.getByTestId("remote-access-form")).toHaveAttribute("data-hydrated", "true");
    await expect(page.getByRole("button", { name: "Salva configurazione" })).toBeEnabled();

    await page.locator("#adminEnabled").check();
    await page.locator("#posEnabled").check();
    await page.locator("#sshEnabled").check();
    await page.locator("#posLanAuthenticationEnabled").uncheck();
    await page.getByRole("button", { name: "Salva configurazione" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Conferma e applica" }).click();
    await expect(page.getByRole("status")).toContainText("Configurazione accesso remoto salvata");

    const desired = await page.request.get("/api/internal/remote-access", {
      headers: { authorization: `Bearer ${controllerToken}` },
    });
    expect(desired.ok()).toBeTruthy();
    await expect(desired.json()).resolves.toEqual({
      menuEnabled: true,
      adminEnabled: true,
      posEnabled: true,
      sshEnabled: true,
    });

    const applied = await page.request.post("/api/internal/remote-access", {
      headers: { authorization: `Bearer ${controllerToken}` },
      data: {
        menuEnabled: true,
        adminEnabled: true,
        posEnabled: true,
        sshEnabled: true,
      },
    });
    expect(applied.ok()).toBeTruthy();
    await page.reload();
    await expect(
      page.locator('[data-slot="card"]').filter({ hasText: "Pannello Admin" }).getByText("Applicato: attivo")
    ).toBeVisible();

    const lanContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const lanPage = await lanContext.newPage();
    await lanPage.goto("/pos", { waitUntil: "domcontentloaded" });
    await expect(lanPage).toHaveURL(/\/pos$/);
    await expect(lanPage.getByTestId("pos-brand-shell")).toBeVisible();
    await lanContext.close();

    const remoteContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { "x-fantafestando-remote-pos": remotePosMarker },
    });
    const remotePage = await remoteContext.newPage();
    await remotePage.goto("/pos", { waitUntil: "domcontentloaded" });
    await expect(remotePage).toHaveURL(/\/login\?callbackUrl=(?:%2F|\/)pos/);

    const credentials = resolveE2ECredentials();
    await loginWithCredentials(remotePage, {
      username: credentials.admin.username,
      password: credentials.admin.password,
      targetPath: remotePage.url(),
      expectedPathPrefix: "/pos",
    });
    await expect(remotePage.getByTestId("pos-brand-shell")).toBeVisible();
    await remoteContext.close();
  });
});
