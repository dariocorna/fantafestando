import { describe, expect, test } from "vitest";
import {
  REMOTE_ACCESS_DEFAULTS,
  getAppliedRemoteAccessState,
  getDesiredRemoteAccessState,
  normalizeRemoteAccessSettings,
} from "@/lib/remote-access";

describe("remote access settings", () => {
  test("preserves the menu-only compatible defaults", () => {
    const settings = normalizeRemoteAccessSettings(undefined);
    expect(settings).toMatchObject(REMOTE_ACCESS_DEFAULTS);
    expect(getDesiredRemoteAccessState(settings)).toEqual({
      menuEnabled: true,
      adminEnabled: false,
      posEnabled: false,
      sshEnabled: false,
    });
    expect(getAppliedRemoteAccessState(settings)).toEqual({
      menuEnabled: true,
      adminEnabled: false,
      posEnabled: false,
      sshEnabled: false,
    });
  });
});
