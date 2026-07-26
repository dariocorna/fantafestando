import dbConnect from "@/lib/mongoose";
import SystemSettings from "@/models/SystemSettings";

export const REMOTE_ACCESS_DEFAULTS = {
  menuEnabled: true,
  adminEnabled: false,
  posEnabled: false,
  sshEnabled: false,
  posLanAuthenticationEnabled: true,
  appliedMenuEnabled: true,
  appliedAdminEnabled: false,
  appliedPosEnabled: false,
  appliedSshEnabled: false,
} as const;

export interface RemoteAccessSettingsView {
  menuEnabled: boolean;
  adminEnabled: boolean;
  posEnabled: boolean;
  sshEnabled: boolean;
  posLanAuthenticationEnabled: boolean;
  appliedMenuEnabled: boolean;
  appliedAdminEnabled: boolean;
  appliedPosEnabled: boolean;
  appliedSshEnabled: boolean;
  requestedBy?: string;
  requestedAt?: string;
  lastControllerAt?: string;
  lastError?: string;
}

type RemoteAccessDocument = Partial<Record<keyof RemoteAccessSettingsView, unknown>>;

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asOptionalIsoDate(value: unknown) {
  if (!value) return undefined;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function normalizeRemoteAccessSettings(value: RemoteAccessDocument | null | undefined): RemoteAccessSettingsView {
  return {
    menuEnabled: asBoolean(value?.menuEnabled, REMOTE_ACCESS_DEFAULTS.menuEnabled),
    adminEnabled: asBoolean(value?.adminEnabled, REMOTE_ACCESS_DEFAULTS.adminEnabled),
    posEnabled: asBoolean(value?.posEnabled, REMOTE_ACCESS_DEFAULTS.posEnabled),
    sshEnabled: asBoolean(value?.sshEnabled, REMOTE_ACCESS_DEFAULTS.sshEnabled),
    posLanAuthenticationEnabled: asBoolean(
      value?.posLanAuthenticationEnabled,
      REMOTE_ACCESS_DEFAULTS.posLanAuthenticationEnabled
    ),
    appliedMenuEnabled: asBoolean(value?.appliedMenuEnabled, REMOTE_ACCESS_DEFAULTS.appliedMenuEnabled),
    appliedAdminEnabled: asBoolean(value?.appliedAdminEnabled, REMOTE_ACCESS_DEFAULTS.appliedAdminEnabled),
    appliedPosEnabled: asBoolean(value?.appliedPosEnabled, REMOTE_ACCESS_DEFAULTS.appliedPosEnabled),
    appliedSshEnabled: asBoolean(value?.appliedSshEnabled, REMOTE_ACCESS_DEFAULTS.appliedSshEnabled),
    requestedBy: asOptionalString(value?.requestedBy),
    requestedAt: asOptionalIsoDate(value?.requestedAt),
    lastControllerAt: asOptionalIsoDate(value?.lastControllerAt),
    lastError: asOptionalString(value?.lastError),
  };
}

export async function getRemoteAccessSettingsView(): Promise<RemoteAccessSettingsView> {
  await dbConnect();
  const settings = await SystemSettings.findOne({ singletonKey: "default" })
    .select("remoteAccess")
    .lean() as { remoteAccess?: RemoteAccessDocument } | null;
  return normalizeRemoteAccessSettings(settings?.remoteAccess);
}

export function getDesiredRemoteAccessState(settings: RemoteAccessSettingsView) {
  return {
    menuEnabled: settings.menuEnabled,
    adminEnabled: settings.adminEnabled,
    posEnabled: settings.posEnabled,
    sshEnabled: settings.sshEnabled,
  };
}

export function getAppliedRemoteAccessState(settings: RemoteAccessSettingsView) {
  return {
    menuEnabled: settings.appliedMenuEnabled,
    adminEnabled: settings.appliedAdminEnabled,
    posEnabled: settings.appliedPosEnabled,
    sshEnabled: settings.appliedSshEnabled,
  };
}
