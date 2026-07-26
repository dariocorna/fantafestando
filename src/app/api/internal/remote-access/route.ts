import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongoose";
import {
  getDesiredRemoteAccessState,
  getRemoteAccessSettingsView,
} from "@/lib/remote-access";
import SystemSettings from "@/models/SystemSettings";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const expected = process.env.ORACLE_TUNNEL_CONTROL_TOKEN?.trim() || "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function unauthorized() {
  return NextResponse.json({ error: "Accesso non autorizzato" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized();
  const settings = await getRemoteAccessSettingsView();
  return NextResponse.json(getDesiredRemoteAccessState(settings));
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized();

  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ error: "Payload non valido" }, { status: 400 });
  }

  const applied = {
    menuEnabled: payload.menuEnabled === true,
    adminEnabled: payload.adminEnabled === true,
    posEnabled: payload.posEnabled === true,
    sshEnabled: payload.sshEnabled === true,
  };
  const lastError = typeof payload.error === "string" ? payload.error.trim().slice(0, 500) : "";

  await dbConnect();
  await SystemSettings.findOneAndUpdate(
    { singletonKey: "default" },
    {
      $set: {
        singletonKey: "default",
        "remoteAccess.appliedMenuEnabled": applied.menuEnabled,
        "remoteAccess.appliedAdminEnabled": applied.adminEnabled,
        "remoteAccess.appliedPosEnabled": applied.posEnabled,
        "remoteAccess.appliedSshEnabled": applied.sshEnabled,
        "remoteAccess.lastControllerAt": new Date(),
        ...(lastError ? { "remoteAccess.lastError": lastError } : {}),
      },
      ...(!lastError ? { $unset: { "remoteAccess.lastError": 1 } } : {}),
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true });
}
