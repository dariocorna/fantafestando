import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensureAuthenticatedSession } from "@/lib/authz";
import { normalizeHostname } from "@/lib/request-host";
import { getRemoteAccessSettingsView, type RemoteAccessSettingsView } from "@/lib/remote-access";

type PosExposureSettings = Pick<
  RemoteAccessSettingsView,
  "posEnabled" | "adminEnabled" | "appliedPosEnabled" | "appliedAdminEnabled"
>;

function parseHostnameList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => normalizeHostname(entry))
    .filter(Boolean);
}

function isBackofficePublished(settings: Partial<PosExposureSettings>): boolean {
  return Boolean(
    settings.posEnabled
    || settings.adminEnabled
    || settings.appliedPosEnabled
    || settings.appliedAdminEnabled
  );
}

/**
 * Anonymous POS is a LAN-only concession, so an unrecognized request is never
 * treated as LAN: it has to match `POS_LAN_HOSTNAMES` positively. Without that
 * allow-list the concession holds only while no remote forward can reach this
 * container at all.
 */
export function isTrustedLanPosRequest(
  requestHeaders: Pick<Headers, "get">,
  settings: Partial<PosExposureSettings>,
  env: Record<string, string | undefined> = process.env
) {
  const markerSecret = env.REMOTE_POS_MARKER_SECRET?.trim() || "";
  if (markerSecret && requestHeaders.get("x-fantafestando-remote-pos") === markerSecret) {
    return false;
  }

  const requestHostname = normalizeHostname(
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host")
  );
  if (!requestHostname) return false;

  const publicHostnames = [
    ...parseHostnameList(env.REMOTE_POS_HOSTNAME),
    ...parseHostnameList(env.REMOTE_ADMIN_HOSTNAME),
  ];
  if (publicHostnames.includes(requestHostname)) return false;

  const lanHostnames = parseHostnameList(env.POS_LAN_HOSTNAMES);
  if (lanHostnames.length > 0) {
    return lanHostnames.includes(requestHostname);
  }

  return !isBackofficePublished(settings);
}

export async function ensurePosAccess(requestHeaders?: Pick<Headers, "get">) {
  const settings = await getRemoteAccessSettingsView();
  const resolvedHeaders = requestHeaders || await headers();
  const authenticationRequired =
    settings.posLanAuthenticationEnabled || !isTrustedLanPosRequest(resolvedHeaders, settings);

  if (!authenticationRequired) {
    return { ok: true as const, user: null, authenticationRequired: false };
  }

  const sessionCheck = await ensureAuthenticatedSession();
  if (!sessionCheck.ok) {
    return { ...sessionCheck, authenticationRequired: true };
  }

  return { ...sessionCheck, authenticationRequired: true };
}

export async function requirePosPageAccess() {
  const access = await ensurePosAccess();
  if (access.ok) return access;
  redirect("/login?callbackUrl=/pos");
}
