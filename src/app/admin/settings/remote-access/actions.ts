"use server";

import { revalidatePath } from "next/cache";
import { ensureAdminSession } from "@/lib/authz";
import dbConnect from "@/lib/mongoose";
import { getRemoteAccessSettingsView, type RemoteAccessSettingsView } from "@/lib/remote-access";
import SystemSettings from "@/models/SystemSettings";

export interface RemoteAccessActionState {
  success?: string;
  error?: string;
  settings?: RemoteAccessSettingsView;
}

export async function saveRemoteAccessSettingsAction(formData: FormData): Promise<RemoteAccessActionState> {
  const sessionCheck = await ensureAdminSession();
  if (!sessionCheck.ok) return { error: sessionCheck.error };

  const desired = {
    menuEnabled: formData.get("menuEnabled") === "on",
    adminEnabled: formData.get("adminEnabled") === "on",
    posEnabled: formData.get("posEnabled") === "on",
    sshEnabled: formData.get("sshEnabled") === "on",
    posLanAuthenticationEnabled: formData.get("posLanAuthenticationEnabled") === "on",
  };

  await dbConnect();
  await SystemSettings.findOneAndUpdate(
    { singletonKey: "default" },
    {
      $set: {
        singletonKey: "default",
        "remoteAccess.menuEnabled": desired.menuEnabled,
        "remoteAccess.adminEnabled": desired.adminEnabled,
        "remoteAccess.posEnabled": desired.posEnabled,
        "remoteAccess.sshEnabled": desired.sshEnabled,
        "remoteAccess.posLanAuthenticationEnabled": desired.posLanAuthenticationEnabled,
        "remoteAccess.requestedBy": sessionCheck.user.username,
        "remoteAccess.requestedAt": new Date(),
      },
      $unset: { "remoteAccess.lastError": 1 },
    },
    { upsert: true }
  );

  revalidatePath("/admin/settings/remote-access");
  return {
    success: "Configurazione accesso remoto salvata.",
    settings: await getRemoteAccessSettingsView(),
  };
}
