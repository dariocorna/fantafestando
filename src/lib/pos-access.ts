import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensureAuthenticatedSession } from "@/lib/authz";
import { getRemoteAccessSettingsView, type RemoteAccessSettingsView } from "@/lib/remote-access";

function normalizeHostname(value: string | null | undefined) {
  const first = value?.split(",")[0]?.trim().toLowerCase() || "";
  if (!first) return "";
  try {
    return new URL(`http://${first}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isRemotePosRequest(
  requestHeaders: Pick<Headers, "get">,
  settings: Pick<RemoteAccessSettingsView, "posEnabled">,
  env: Record<string, string | undefined> = process.env
) {
  const configuredHostname = normalizeHostname(env.REMOTE_POS_HOSTNAME);
  const requestHostname = normalizeHostname(
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host")
  );
  const markerSecret = env.REMOTE_POS_MARKER_SECRET?.trim() || "";
  const markerMatches = Boolean(
    markerSecret && requestHeaders.get("x-fantafestando-remote-pos") === markerSecret
  );

  if (markerMatches || (configuredHostname && requestHostname === configuredHostname)) {
    return true;
  }

  return settings.posEnabled && (!configuredHostname || !markerSecret);
}

export async function ensurePosAccess(requestHeaders?: Pick<Headers, "get">) {
  const settings = await getRemoteAccessSettingsView();
  const resolvedHeaders = requestHeaders || await headers();
  const authenticationRequired =
    settings.posLanAuthenticationEnabled || isRemotePosRequest(resolvedHeaders, settings);

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
