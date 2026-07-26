import { describe, expect, test } from "vitest";
// @ts-expect-error The production controller intentionally stays dependency-free JavaScript.
import {
  DEFAULT_REMOTE_ACCESS,
  buildRemoteSpecs,
  buildSshArgs,
  normalizeRemoteAccess,
} from "../../scripts/oracle-tunnel-controller.mjs";

const env = {
  ORACLE_TUNNEL_HOST: "oracle.example",
  ORACLE_TUNNEL_USER: "tunnel",
  ORACLE_TUNNEL_KEY_PATH: "/run/key",
  ORACLE_TUNNEL_REMOTE_BIND_ADDRESS: "127.0.0.1",
};

describe("oracle tunnel controller", () => {
  test("keeps the existing menu-only default", () => {
    expect(normalizeRemoteAccess({})).toEqual(DEFAULT_REMOTE_ACCESS);
    expect(buildRemoteSpecs({}, env)).toEqual([
      "127.0.0.1:3302:fantafestando-menu:3000",
    ]);
  });

  test("builds only the selected predefined forwards", () => {
    const specs = buildRemoteSpecs({
      menuEnabled: false,
      adminEnabled: true,
      posEnabled: false,
      sshEnabled: true,
    }, env);

    expect(specs).toEqual([
      "127.0.0.1:3304:fantafestando-backoffice:3000",
      "127.0.0.1:3322:host.docker.internal:22",
    ]);
    expect(buildSshArgs(specs, env)).toEqual(expect.arrayContaining([
      "-R",
      "127.0.0.1:3304:fantafestando-backoffice:3000",
      "127.0.0.1:3322:host.docker.internal:22",
      "tunnel@oracle.example",
    ]));
  });
});
